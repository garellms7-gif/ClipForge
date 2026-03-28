import os
import shutil
import uuid
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, Any

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import uvicorn

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="ClipForge API", version="0.1.0")

# CORS: read comma-separated origins from env, always include localhost:3000
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000")
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if "http://localhost:3000" not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append("http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job store
jobs: Dict[str, Dict[str, Any]] = {}

TEMP_DIR = Path(tempfile.gettempdir()) / "clipforge"
TEMP_DIR.mkdir(exist_ok=True)


class ProcessRequest(BaseModel):
    threshold_db: float = -35.0
    min_silence_duration: float = 0.5


# ---------------------------------------------------------------------------
# ffmpeg availability check (runs once at startup)
# ---------------------------------------------------------------------------

def _check_ffmpeg() -> None:
    """Raise RuntimeError if ffmpeg or ffprobe are not on PATH."""
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise RuntimeError(
                f"'{tool}' was not found on PATH. "
                "Please install ffmpeg: https://ffmpeg.org/download.html"
            )


@app.on_event("startup")
async def startup_event() -> None:
    try:
        _check_ffmpeg()
    except RuntimeError as exc:
        # Log prominently — the server will still start but processing will fail
        import sys
        print(f"\n[ClipForge] WARNING: {exc}\n", file=sys.stderr)


# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Accept a video file, save to temp storage, return job_id."""
    try:
        _check_ffmpeg()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    job_id = str(uuid.uuid4())
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename).suffix or ".mp4"
    input_path = job_dir / f"input{suffix}"

    try:
        with open(input_path, "wb") as f:
            content = await file.read()
            if not content:
                raise HTTPException(status_code=400, detail="Uploaded file is empty.")
            f.write(content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save uploaded file: {exc}",
        )

    jobs[job_id] = {
        "status": "pending",
        "input_path": str(input_path),
        "output_path": None,
        "error": None,
        "filename": file.filename,
    }

    return {"job_id": job_id}


@app.post("/process/{job_id}")
async def process_video(job_id: str, req: ProcessRequest):
    """Run dead space removal on the uploaded video."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found. The job may have expired — please upload your video again.")

    job = jobs[job_id]
    if job["status"] == "processing":
        raise HTTPException(status_code=400, detail="This job is already being processed.")
    if job["status"] == "done":
        raise HTTPException(status_code=400, detail="This job has already been processed. Download your video or start a new one.")
    if job["status"] not in ("pending", "error"):
        raise HTTPException(status_code=400, detail=f"Unexpected job state: {job['status']}")

    try:
        _check_ffmpeg()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    job["status"] = "processing"
    job["error"] = None
    input_path = job["input_path"]
    job_dir = Path(input_path).parent
    output_path = job_dir / f"{job_id}_processed.mp4"

    try:
        silence_segments = detect_silence(input_path, req.threshold_db, req.min_silence_duration)
        duration = get_video_duration(input_path)
        keep_intervals = invert_silence_segments(silence_segments, duration)

        if not keep_intervals:
            raise ValueError(
                "No audio was found above the silence threshold. "
                "Try lowering the threshold (e.g. -40 dB) or reducing the minimum duration."
            )

        concat_video(input_path, keep_intervals, str(output_path))

        job["status"] = "done"
        job["output_path"] = str(output_path)
        return {"status": "done", "job_id": job_id}

    except HTTPException:
        raise
    except Exception as exc:
        job["status"] = "error"
        job["error"] = str(exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    """Return current job status: pending | processing | done | error."""
    if job_id not in jobs:
        raise HTTPException(
            status_code=404,
            detail="Job not found. The job may have expired — please upload your video again.",
        )
    job = jobs[job_id]
    return {
        "job_id": job_id,
        "status": job["status"],
        "error": job.get("error"),
    }


@app.get("/download/{job_id}")
async def download_video(job_id: str):
    """Stream the processed file back as an attachment."""
    if job_id not in jobs:
        raise HTTPException(
            status_code=404,
            detail="Job not found. The job may have expired — please upload and process your video again.",
        )

    job = jobs[job_id]

    if job["status"] == "processing":
        raise HTTPException(status_code=400, detail="Your video is still being processed. Please wait.")
    if job["status"] == "error":
        raise HTTPException(status_code=400, detail="This job encountered an error. Please try processing again.")
    if job["status"] != "done":
        raise HTTPException(status_code=400, detail=f"Job is not ready for download (status: {job['status']}).")

    output_path = job["output_path"]
    if not output_path or not Path(output_path).exists():
        raise HTTPException(
            status_code=404,
            detail="Processed file not found on disk. It may have been cleaned up — please process again.",
        )

    original_name = Path(job.get("filename", "output.mp4")).stem
    download_name = f"{original_name}_clipped.mp4"

    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename=download_name,
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


# ---------------------------------------------------------------------------
# FFmpeg helpers
# ---------------------------------------------------------------------------

def detect_silence(
    input_path: str, threshold_db: float, min_duration: float
) -> list[tuple[float, float]]:
    """Run ffmpeg silencedetect; return (start, end) tuples of silent segments."""
    cmd = [
        "ffmpeg", "-i", input_path,
        "-af", f"silencedetect=noise={threshold_db}dB:d={min_duration}",
        "-f", "null", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    # silencedetect output always goes to stderr even on success
    stderr = result.stderr

    if result.returncode != 0 and "silencedetect" not in stderr:
        raise RuntimeError(
            f"ffmpeg failed to read the video file. "
            f"Make sure it is a valid video. Details: {stderr[-500:]}"
        )

    segments: list[tuple[float, float]] = []
    current_start: float | None = None

    for line in stderr.splitlines():
        if "silence_start" in line:
            parts = line.split("silence_start:")
            if len(parts) == 2:
                try:
                    current_start = float(parts[1].strip().split()[0])
                except ValueError:
                    pass
        elif "silence_end" in line and current_start is not None:
            parts = line.split("silence_end:")
            if len(parts) == 2:
                try:
                    end_val = float(parts[1].strip().split()[0])
                    segments.append((current_start, end_val))
                    current_start = None
                except ValueError:
                    pass

    if current_start is not None:
        duration = get_video_duration(input_path)
        segments.append((current_start, duration))

    return segments


def get_video_duration(input_path: str) -> float:
    """Use ffprobe to get video duration in seconds."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        input_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Could not read video metadata. "
            f"Make sure the file is a valid video format. Details: {result.stderr[-300:]}"
        )
    try:
        data = json.loads(result.stdout)
        return float(data["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not determine video duration: {exc}")


def invert_silence_segments(
    silence_segments: list[tuple[float, float]], total_duration: float
) -> list[tuple[float, float]]:
    """Convert silent intervals to kept intervals with a small boundary pad."""
    PAD = 0.05
    keep: list[tuple[float, float]] = []
    cursor = 0.0

    for s_start, s_end in sorted(silence_segments):
        seg_end = max(cursor, s_start - PAD)
        if seg_end > cursor + 0.01:
            keep.append((cursor, seg_end))
        cursor = min(total_duration, s_end + PAD)

    if cursor < total_duration - 0.01:
        keep.append((cursor, total_duration))

    return keep


def concat_video(
    input_path: str,
    intervals: list[tuple[float, float]],
    output_path: str,
) -> None:
    """Trim and concatenate non-silent segments using ffmpeg filter_complex."""
    if len(intervals) == 1:
        start, end = intervals[0]
        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-ss", str(start),
            "-t", str(end - start),
            "-c:v", "libx264", "-c:a", "aac",
            "-movflags", "+faststart",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg failed while building the output file. Details: {result.stderr[-1000:]}"
            )
        return

    filter_parts: list[str] = []
    for i, (start, end) in enumerate(intervals):
        filter_parts.append(
            f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{i}];"
            f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{i}]"
        )

    n = len(intervals)
    video_inputs = "".join(f"[v{i}]" for i in range(n))
    audio_inputs = "".join(f"[a{i}]" for i in range(n))
    filter_parts.append(f"{video_inputs}concat=n={n}:v=1:a=0[outv]")
    filter_parts.append(f"{audio_inputs}concat=n={n}:v=0:a=1[outa]")

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-filter_complex", ";".join(filter_parts),
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264", "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed while building the output file. Details: {result.stderr[-1000:]}"
        )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
