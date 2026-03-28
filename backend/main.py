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


class RespawnRequest(BaseModel):
    black_threshold: float = 0.1   # 0.0 (pure black) – 1.0 (white)
    min_duration: float = 1.5      # seconds of black+silent to qualify


# ---------------------------------------------------------------------------
# ffmpeg availability check (runs once at startup)
# ---------------------------------------------------------------------------

MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB


def _check_ffmpeg() -> None:
    """Raise RuntimeError if ffmpeg or ffprobe are not on PATH."""
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise RuntimeError("ffmpeg is not installed on the server. Contact support.")


def _check_cv2() -> None:
    """Raise RuntimeError if opencv-python is not importable."""
    try:
        import cv2  # noqa: F401
    except ImportError:
        raise RuntimeError("opencv-python is not installed on the server. Contact support.")


@app.on_event("startup")
async def startup_event() -> None:
    import sys
    for check in (_check_ffmpeg, _check_cv2):
        try:
            check()
        except RuntimeError as exc:
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
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File exceeds the maximum allowed size.")
        with open(input_path, "wb") as f:
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
        # respawn fields (populated by /process/respawn/{job_id})
        "respawn_status": "idle",
        "respawn_output_path": None,
        "respawn_stats": None,
        "respawn_error": None,
    }

    return {"job_id": job_id}


@app.post("/process/{job_id}")
async def process_video(job_id: str, req: ProcessRequest):
    """Run dead space removal on the uploaded video."""
    if job_id not in jobs:
        raise HTTPException(
            status_code=404,
            detail="Job not found. It may have expired — please re-upload your video.",
        )

    job = jobs[job_id]
    if job["status"] == "processing":
        raise HTTPException(status_code=400, detail="This job is already being processed.")
    if job["status"] == "done":
        raise HTTPException(
            status_code=400,
            detail="This job has already been processed. Download your video or start a new one.",
        )
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
                "Processing failed. Try adjusting your settings and running again."
            )

        concat_video(input_path, keep_intervals, str(output_path))

        job["status"] = "done"
        job["output_path"] = str(output_path)
        return {"status": "done", "job_id": job_id}

    except HTTPException:
        raise
    except Exception as exc:
        job["status"] = "error"
        job["error"] = "Processing failed. Try adjusting your settings and running again."
        raise HTTPException(
            status_code=500,
            detail="Processing failed. Try adjusting your settings and running again.",
        )


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    """Return current job status: pending | processing | done | error."""
    if job_id not in jobs:
        raise HTTPException(
            status_code=404,
            detail="Job not found. It may have expired — please re-upload your video.",
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
            detail="Job not found. It may have expired — please re-upload your video.",
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


@app.post("/process/respawn/{job_id}")
async def process_respawn(job_id: str, req: RespawnRequest):
    """
    Detect and remove respawn-wait segments: frames that are black AND silent
    for at least req.min_duration seconds.
    """
    if job_id not in jobs:
        raise HTTPException(
            status_code=404,
            detail="Job not found. It may have expired — please re-upload your video.",
        )

    job = jobs[job_id]
    if job.get("respawn_status") == "processing":
        raise HTTPException(status_code=400, detail="Respawn processing is already in progress.")

    try:
        _check_ffmpeg()
        _check_cv2()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    job["respawn_status"] = "processing"
    job["respawn_error"] = None

    input_path = job["input_path"]
    job_dir = Path(input_path).parent
    output_path = job_dir / f"{job_id}_respawn_processed.mp4"

    try:
        # Detect black-frame segments
        black_segs = detect_black_frames(input_path, req.black_threshold, job_dir)

        # Detect silence with a lenient threshold so short dips register
        silence_segs = detect_silence(input_path, -35.0, 0.3)

        # Find segments where BOTH conditions overlap >= min_duration
        respawn_segs = find_respawn_segments(black_segs, silence_segs, req.min_duration)

        if not respawn_segs:
            job["respawn_status"] = "done"
            job["respawn_output_path"] = None
            job["respawn_stats"] = {"segments_removed": 0, "time_saved_seconds": 0.0}
            return {"status": "done", "segments_removed": 0, "time_saved_seconds": 0.0}

        duration = get_video_duration(input_path)
        keep_intervals = invert_silence_segments(respawn_segs, duration)
        concat_video(input_path, keep_intervals, str(output_path))

        time_saved = round(sum(e - s for s, e in respawn_segs), 1)
        stats = {"segments_removed": len(respawn_segs), "time_saved_seconds": time_saved}

        job["respawn_status"] = "done"
        job["respawn_output_path"] = str(output_path)
        job["respawn_stats"] = stats

        return {"status": "done", **stats}

    except HTTPException:
        raise
    except Exception:
        job["respawn_status"] = "error"
        job["respawn_error"] = "Processing failed. Try adjusting your settings and running again."
        raise HTTPException(
            status_code=500,
            detail="Processing failed. Try adjusting your settings and running again.",
        )


@app.get("/download/respawn/{job_id}")
async def download_respawn_video(job_id: str):
    """Stream the respawn-processed file back as an attachment."""
    if job_id not in jobs:
        raise HTTPException(
            status_code=404,
            detail="Job not found. It may have expired — please re-upload your video.",
        )

    job = jobs[job_id]
    respawn_status = job.get("respawn_status", "idle")

    if respawn_status == "processing":
        raise HTTPException(status_code=400, detail="Respawn processing is still in progress.")
    if respawn_status == "error":
        raise HTTPException(status_code=400, detail="Respawn processing encountered an error. Please try again.")
    if respawn_status != "done":
        raise HTTPException(status_code=400, detail="Respawn processing has not been run yet.")

    output_path = job.get("respawn_output_path")
    if not output_path:
        raise HTTPException(status_code=400, detail="No respawn waits were detected — nothing to download.")
    if not Path(output_path).exists():
        raise HTTPException(
            status_code=404,
            detail="Processed file not found on disk. It may have been cleaned up — please process again.",
        )

    original_name = Path(job.get("filename", "output.mp4")).stem
    download_name = f"{original_name}_respawn_removed.mp4"

    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename=download_name,
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


# ---------------------------------------------------------------------------
# Respawn detection helpers
# ---------------------------------------------------------------------------

def detect_black_frames(
    input_path: str,
    threshold: float,
    job_dir: Path,
) -> list[tuple[float, float]]:
    """
    Extract 1fps JPEG frames via ffmpeg, measure average greyscale brightness
    using cv2, and return (start, end) segments in seconds where brightness < threshold.
    threshold is normalised to [0.0, 1.0].
    """
    import cv2

    frames_dir = job_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-vf", "fps=1",
        str(frames_dir / "frame_%04d.jpg"),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Failed to extract frames for black-frame detection. "
            f"Details: {result.stderr[-500:]}"
        )

    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    black_seconds: list[int] = []

    for i, frame_path in enumerate(frame_files):
        img = cv2.imread(str(frame_path))
        if img is None:
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # cv2.mean returns (mean, 0, 0, 0) for single-channel images
        mean_brightness = float(cv2.mean(gray)[0]) / 255.0
        if mean_brightness < threshold:
            black_seconds.append(i)  # frame i covers [i, i+1) seconds

    if not black_seconds:
        return []

    # Merge consecutive black seconds into (start, end) intervals
    segments: list[tuple[float, float]] = []
    seg_start = black_seconds[0]
    prev = black_seconds[0]

    for sec in black_seconds[1:]:
        if sec == prev + 1:
            prev = sec
        else:
            segments.append((float(seg_start), float(prev + 1)))
            seg_start = sec
            prev = sec
    segments.append((float(seg_start), float(prev + 1)))

    return segments


def find_respawn_segments(
    black_segs: list[tuple[float, float]],
    silence_segs: list[tuple[float, float]],
    min_duration: float,
) -> list[tuple[float, float]]:
    """
    Intersect black-frame and silent segments. Keep only overlaps >= min_duration,
    then merge any adjacent results.
    """
    overlaps: list[tuple[float, float]] = []

    for b_start, b_end in black_segs:
        for s_start, s_end in silence_segs:
            start = max(b_start, s_start)
            end = min(b_end, s_end)
            if end - start >= min_duration:
                overlaps.append((start, end))

    if not overlaps:
        return overlaps

    overlaps.sort()
    merged: list[tuple[float, float]] = [overlaps[0]]
    for start, end in overlaps[1:]:
        if start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    return merged


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
