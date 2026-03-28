import os
import uuid
import json
import subprocess
import tempfile
import shutil
from pathlib import Path
from typing import Dict, Any

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn

app = FastAPI(title="ClipForge API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job store: job_id -> { status, input_path, output_path, error }
jobs: Dict[str, Dict[str, Any]] = {}

TEMP_DIR = Path(tempfile.gettempdir()) / "clipforge"
TEMP_DIR.mkdir(exist_ok=True)


@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Accept a video file and save it to temp storage, returning a job_id."""
    job_id = str(uuid.uuid4())
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename).suffix if file.filename else ".mp4"
    input_path = job_dir / f"input{suffix}"

    with open(input_path, "wb") as f:
        content = await file.read()
        f.write(content)

    jobs[job_id] = {
        "status": "uploaded",
        "input_path": str(input_path),
        "output_path": None,
        "error": None,
        "filename": file.filename or "video.mp4",
    }

    return {"job_id": job_id, "status": "uploaded", "filename": file.filename}


@app.post("/process")
async def process_video(
    job_id: str = Form(...),
    silence_threshold: float = Form(-30.0),
    min_silence_duration: float = Form(0.5),
):
    """
    Run dead space removal on the uploaded video.
    Uses ffmpeg silencedetect to find silent segments, then trims them out.
    """
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    if job["status"] not in ("uploaded", "error"):
        raise HTTPException(status_code=400, detail=f"Job is in state '{job['status']}', cannot process")

    job["status"] = "processing"
    input_path = job["input_path"]
    job_dir = Path(input_path).parent
    output_path = job_dir / "output.mp4"

    try:
        # Step 1: Detect silent segments
        silence_segments = detect_silence(
            input_path, silence_threshold, min_silence_duration
        )

        # Step 2: Build list of non-silent (kept) intervals
        duration = get_video_duration(input_path)
        keep_intervals = invert_silence_segments(silence_segments, duration)

        if not keep_intervals:
            raise ValueError("No non-silent segments found. Try lowering the silence threshold.")

        # Step 3: Cut and concatenate non-silent segments
        concat_video(input_path, keep_intervals, str(output_path))

        job["status"] = "done"
        job["output_path"] = str(output_path)
        return {"job_id": job_id, "status": "done"}

    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    """Return current status of a job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    job = jobs[job_id]
    return {
        "job_id": job_id,
        "status": job["status"],
        "error": job.get("error"),
        "filename": job.get("filename"),
    }


@app.get("/download/{job_id}")
async def download_video(job_id: str):
    """Return the processed video file."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    if job["status"] != "done":
        raise HTTPException(status_code=400, detail=f"Job not ready (status: {job['status']})")

    output_path = job["output_path"]
    if not output_path or not Path(output_path).exists():
        raise HTTPException(status_code=404, detail="Output file not found")

    original_name = Path(job.get("filename", "output.mp4")).stem
    download_name = f"{original_name}_clipped.mp4"

    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename=download_name,
    )


# ---------------------------------------------------------------------------
# FFmpeg helpers
# ---------------------------------------------------------------------------

def detect_silence(input_path: str, threshold_db: float, min_duration: float) -> list[tuple[float, float]]:
    """
    Run ffmpeg silencedetect and return list of (start, end) tuples for silent segments.
    """
    cmd = [
        "ffmpeg", "-i", input_path,
        "-af", f"silencedetect=noise={threshold_db}dB:d={min_duration}",
        "-f", "null", "-"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    stderr = result.stderr

    segments = []
    current_start = None

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

    # Handle silence that extends to the end of the video
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
        input_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def invert_silence_segments(
    silence_segments: list[tuple[float, float]], total_duration: float
) -> list[tuple[float, float]]:
    """
    Given silent (start, end) intervals, return the non-silent intervals.
    Adds a small pad around cuts to avoid audio pops.
    """
    PAD = 0.05  # seconds to keep around silence boundaries
    keep = []
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
    """
    Use ffmpeg complex filter to select and concatenate non-silent segments.
    """
    if len(intervals) == 1:
        start, end = intervals[0]
        duration = end - start
        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-ss", str(start),
            "-t", str(duration),
            "-c:v", "libx264", "-c:a", "aac",
            "-movflags", "+faststart",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed: {result.stderr[-2000:]}")
        return

    # Build a complex filter for multiple segments
    filter_parts = []
    for i, (start, end) in enumerate(intervals):
        duration = end - start
        filter_parts.append(
            f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{i}];"
            f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{i}]"
        )

    n = len(intervals)
    video_inputs = "".join(f"[v{i}]" for i in range(n))
    audio_inputs = "".join(f"[a{i}]" for i in range(n))
    filter_parts.append(f"{video_inputs}concat=n={n}:v=1:a=0[outv]")
    filter_parts.append(f"{audio_inputs}concat=n={n}:v=0:a=1[outa]")

    filter_complex = ";".join(filter_parts)

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-filter_complex", filter_complex,
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264", "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {result.stderr[-2000:]}")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
