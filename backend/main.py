import os
import shutil
import uuid
import json
import time
import secrets
import subprocess
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Literal

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Request, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import uvicorn

# Optional Supabase client (auth + DB persistence)
try:
    from supabase import create_client as _supabase_create_client
    _SUPABASE_AVAILABLE = True
except ImportError:
    _SUPABASE_AVAILABLE = False

# Optional Google API client (YouTube publishing)
try:
    from google_auth_oauthlib.flow import Flow as _GoogleAuthFlow
    from google.oauth2.credentials import Credentials as _GoogleCredentials
    from google.auth.transport.requests import Request as _GoogleAuthRequest
    from googleapiclient.discovery import build as _google_build
    from googleapiclient.http import MediaFileUpload as _MediaFileUpload
    _GOOGLE_APIS_AVAILABLE = True
except ImportError:
    _GOOGLE_APIS_AVAILABLE = False

# Optional Stripe client (subscription billing)
try:
    import stripe as _stripe
    _STRIPE_AVAILABLE = True
except ImportError:
    _STRIPE_AVAILABLE = False

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

# ---------------------------------------------------------------------------
# Supabase client (JWT verification + DB persistence)
# ---------------------------------------------------------------------------

_SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
_SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

supabase_admin = None
if _SUPABASE_AVAILABLE and _SUPABASE_URL and _SUPABASE_SERVICE_ROLE_KEY:
    try:
        supabase_admin = _supabase_create_client(_SUPABASE_URL, _SUPABASE_SERVICE_ROLE_KEY)
    except Exception as _exc:
        import sys as _sys
        print(f"[ClipForge] WARNING: Could not init Supabase client: {_exc}", file=_sys.stderr)

# ---------------------------------------------------------------------------
# Google OAuth / YouTube configuration
# ---------------------------------------------------------------------------

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get(
    "GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/youtube/callback"
)
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

# Short-lived nonces: state_token → (user_id, expiry_epoch). Keyed by random URL-safe string.
_youtube_oauth_states: Dict[str, tuple[str, float]] = {}

# ---------------------------------------------------------------------------
# Stripe / billing configuration
# ---------------------------------------------------------------------------

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_CREATOR = os.environ.get("STRIPE_PRICE_CREATOR", "")
STRIPE_PRICE_TEAM = os.environ.get("STRIPE_PRICE_TEAM", "")

FREE_VIDEO_LIMIT = 3
PLAN_LIMITS: Dict[str, int | None] = {"free": FREE_VIDEO_LIMIT, "creator": None, "team": None}

# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

_security = HTTPBearer(auto_error=False)


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
) -> str:
    """Verify the Supabase JWT and return the user's UUID."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required. Please sign in.")
    if supabase_admin is None:
        raise HTTPException(
            status_code=503,
            detail="Authentication service is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        )
    try:
        resp = supabase_admin.auth.get_user(credentials.credentials)
        if resp.user is None:
            raise ValueError("no user in response")
        return str(resp.user.id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=401, detail="Invalid or expired authentication token."
        )


def _assert_job_owner(job_id: str, user_id: str) -> Dict[str, Any]:
    """
    Return the job dict for job_id owned by user_id.
    Raises 404 (not 403) to avoid leaking other users' job IDs.
    """
    if job_id not in jobs:
        raise HTTPException(
            status_code=404,
            detail="Job not found. It may have expired — please re-upload your video.",
        )
    job = jobs[job_id]
    if job.get("user_id") != user_id:
        raise HTTPException(
            status_code=404,
            detail="Job not found. It may have expired — please re-upload your video.",
        )
    return job


def _db_write(job_id: str, data: Dict[str, Any]) -> None:
    """Best-effort upsert to the Supabase jobs table. Never raises."""
    if supabase_admin is None:
        return
    try:
        supabase_admin.table("jobs").upsert({"id": job_id, **data}).execute()
    except Exception as exc:
        import sys
        print(f"[ClipForge] DB write failed for job {job_id}: {exc}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Billing helpers
# ---------------------------------------------------------------------------

def _get_user_profile(user_id: str) -> Dict[str, Any]:
    """Fetch user_profiles row; returns empty dict on failure."""
    if supabase_admin is None:
        return {}
    try:
        resp = (
            supabase_admin.table("user_profiles")
            .select("*")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        return resp.data or {}
    except Exception:
        return {}


def _get_usage(user_id: str) -> tuple[str, int]:
    """Return (plan, videos_this_month), auto-resetting the counter on a new month."""
    profile = _get_user_profile(user_id)
    plan: str = profile.get("plan", "free") or "free"
    videos_this_month: int = profile.get("videos_this_month", 0) or 0
    usage_month: str = profile.get("usage_month", "") or ""
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    if usage_month != current_month and supabase_admin:
        try:
            supabase_admin.table("user_profiles").upsert({
                "user_id": user_id,
                "videos_this_month": 0,
                "usage_month": current_month,
            }).execute()
        except Exception:
            pass
        videos_this_month = 0
    return plan, videos_this_month


def _increment_video_count(user_id: str) -> None:
    """Increment videos_this_month for the user. Best-effort, never raises."""
    if supabase_admin is None:
        return
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        profile = _get_user_profile(user_id)
        count = profile.get("videos_this_month", 0) or 0
        stored_month = profile.get("usage_month", "") or ""
        if stored_month != current_month:
            count = 0
        supabase_admin.table("user_profiles").upsert({
            "user_id": user_id,
            "videos_this_month": count + 1,
            "usage_month": current_month,
        }).execute()
    except Exception as exc:
        import sys
        print(f"[ClipForge] Failed to increment video count: {exc}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Team helpers
# ---------------------------------------------------------------------------

TEAM_SEAT_LIMIT = 5


def _assert_team_member_db(team_id: str, user_id: str) -> Dict[str, Any]:
    """Assert user is a member of the team. Returns team+role dict or raises 404."""
    if supabase_admin is None:
        raise HTTPException(status_code=503, detail="Database not configured.")
    try:
        member_resp = (
            supabase_admin.table("team_members")
            .select("role")
            .eq("team_id", team_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if not member_resp.data:
            raise HTTPException(status_code=404, detail="Team not found.")
        team_resp = (
            supabase_admin.table("teams")
            .select("*")
            .eq("id", team_id)
            .maybe_single()
            .execute()
        )
        if not team_resp.data:
            raise HTTPException(status_code=404, detail="Team not found.")
        return {**team_resp.data, "role": member_resp.data["role"]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


def _assert_team_owner_db(team_id: str, user_id: str) -> Dict[str, Any]:
    """Assert user is the owner of the team. Returns team dict or raises 403."""
    team = _assert_team_member_db(team_id, user_id)
    if team.get("owner_id") != user_id:
        raise HTTPException(
            status_code=403,
            detail="Only the team owner can perform this action.",
        )
    return team


def _get_team_member_count(team_id: str) -> int:
    """Return current member count for the team."""
    if supabase_admin is None:
        return 0
    try:
        resp = (
            supabase_admin.table("team_members")
            .select("user_id", count="exact")
            .eq("team_id", team_id)
            .execute()
        )
        return resp.count or 0
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Supabase Storage helpers
# ---------------------------------------------------------------------------

UPLOAD_BUCKET = "clipforge-uploads"
OUTPUT_BUCKET = "clipforge-outputs"


def _storage_upload(bucket: str, storage_path: str, local_path: str | Path) -> None:
    """Upload a local file to a Supabase Storage bucket. Raises on failure."""
    if supabase_admin is None:
        raise RuntimeError(
            "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        )
    with open(local_path, "rb") as fh:
        supabase_admin.storage.from_(bucket).upload(
            path=storage_path,
            file=fh,
            file_options={"content-type": "video/mp4", "upsert": "true"},
        )


def _storage_download(bucket: str, storage_path: str, local_path: str | Path) -> None:
    """Download a file from a Supabase Storage bucket to a local path."""
    if supabase_admin is None:
        raise RuntimeError(
            "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        )
    data: bytes = supabase_admin.storage.from_(bucket).download(storage_path)
    with open(local_path, "wb") as fh:
        fh.write(data)


def _storage_signed_url(bucket: str, storage_path: str, expires: int = 3600) -> str:
    """Create a time-limited signed URL for a private Supabase Storage file."""
    if supabase_admin is None:
        raise RuntimeError(
            "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        )
    res = supabase_admin.storage.from_(bucket).create_signed_url(
        path=storage_path, expires_in=expires
    )
    # supabase-py 2.x may return a model or a dict
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signed_url") or ""
    return getattr(res, "signed_url", None) or getattr(res, "signedURL", "") or str(res)


# ---------------------------------------------------------------------------
# In-memory job store
# ---------------------------------------------------------------------------

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


class HypeRequest(BaseModel):
    audio_sensitivity: float = 0.7   # 0.1–1.0 RMS energy threshold (normalised)
    motion_sensitivity: float = 0.6  # 0.1–1.0 frame-diff threshold (normalised)
    min_gap_seconds: float = 3.0     # merge events closer than this


class YouTubePublishRequest(BaseModel):
    title: str
    description: str = ""
    tags: list[str] = []
    privacy: Literal["public", "unlisted", "private"] = "private"
    category_id: str = "20"  # 20 = Gaming


class CheckoutRequest(BaseModel):
    plan: Literal["creator", "team"]


class CreateTeamRequest(BaseModel):
    name: str


class InviteMemberRequest(BaseModel):
    email: str


class UpdateTeamRequest(BaseModel):
    name: str


class DeadSpaceSettings(BaseModel):
    enabled: bool = True
    threshold_db: float = -35.0
    min_silence_duration: float = 0.5


class RespawnSettings(BaseModel):
    enabled: bool = True
    black_threshold: float = 0.1
    min_duration: float = 1.5


class HypeSettings(BaseModel):
    enabled: bool = True
    audio_sensitivity: float = 0.7
    motion_sensitivity: float = 0.6
    min_gap_seconds: float = 3.0


class PipelineRequest(BaseModel):
    dead_space: DeadSpaceSettings = DeadSpaceSettings()
    respawn_removal: RespawnSettings = RespawnSettings()
    hype_detection: HypeSettings = HypeSettings()


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


def _check_librosa() -> None:
    """Raise RuntimeError if librosa is not importable."""
    try:
        import librosa  # noqa: F401
    except ImportError:
        raise RuntimeError("librosa is not installed on the server. Contact support.")


def _check_google() -> None:
    """Raise RuntimeError if Google API libraries are not installed."""
    if not _GOOGLE_APIS_AVAILABLE:
        raise RuntimeError(
            "Google API libraries are not installed. "
            "Run: pip install google-auth google-auth-oauthlib google-api-python-client"
        )


@app.on_event("startup")
async def startup_event() -> None:
    import sys
    for check in (_check_ffmpeg, _check_cv2, _check_librosa, _check_google):
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
async def upload_video(
    file: UploadFile = File(...),
    team_id: str | None = Form(default=None),
    user_id: str = Depends(get_current_user_id),
):
    """Accept a video file, upload to Supabase Storage, return job_id."""
    try:
        _check_ffmpeg()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    # Plan enforcement: Free plan is limited to 3 videos/month
    _plan, _videos_used = _get_usage(user_id)
    if _plan == "free" and _videos_used >= FREE_VIDEO_LIMIT:
        raise HTTPException(
            status_code=403,
            detail="Monthly limit reached. Upgrade to Creator for unlimited videos.",
        )

    # If uploading to a team workspace, verify membership
    if team_id:
        _assert_team_member_db(team_id, user_id)

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

    # Upload to Supabase Storage, then remove the local temp file
    storage_input_path = f"{user_id}/{job_id}/original{suffix}"
    try:
        _storage_upload(UPLOAD_BUCKET, storage_input_path, input_path)
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to store uploaded file: {exc}",
        )
    try:
        input_path.unlink(missing_ok=True)
        job_dir.rmdir()
    except Exception:
        pass

    jobs[job_id] = {
        "status": "pending",
        "user_id": user_id,
        "team_id": team_id,
        "storage_input_path": storage_input_path,
        "storage_output_path": None,
        "storage_respawn_output_path": None,
        "storage_pipeline_output_path": None,
        "error": None,
        "filename": file.filename,
        # respawn fields (populated by /process/respawn/{job_id})
        "respawn_status": "idle",
        "respawn_stats": None,
        "respawn_error": None,
        # hype fields (populated by /analyze/hype/{job_id})
        "hype_status": "idle",
        "hype_moments": None,
        "hype_error": None,
        # pipeline fields (populated by /process/pipeline/{job_id})
        "pipeline_status": "idle",   # idle | running | done | error
        "pipeline_step": None,
        "pipeline_steps_all": [],
        "pipeline_steps_completed": [],
        "pipeline_hype_moments": None,
        "pipeline_summary": None,
        "pipeline_error": None,
    }

    _db_write(job_id, {"user_id": user_id, "team_id": team_id, "status": "pending", "settings": {}, "summary": None})
    _increment_video_count(user_id)
    return {"job_id": job_id}


@app.post("/process/{job_id}")
async def process_video(
    job_id: str,
    req: ProcessRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Run dead space removal on the uploaded video."""
    job = _assert_job_owner(job_id, user_id)
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

    storage_input = job.get("storage_input_path") or ""
    if not storage_input:
        job["status"] = "error"
        job["error"] = "Source file not found in storage."
        raise HTTPException(status_code=500, detail="Source file not found in storage.")

    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    local_input = job_dir / "input.mp4"

    try:
        _storage_download(UPLOAD_BUCKET, storage_input, local_input)
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        job["status"] = "error"
        job["error"] = "Could not retrieve source file from storage."
        raise HTTPException(status_code=500, detail=f"Failed to download source: {exc}")

    input_path = str(local_input)
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

        storage_output = f"{user_id}/{job_id}/processed.mp4"
        _storage_upload(OUTPUT_BUCKET, storage_output, output_path)
        shutil.rmtree(job_dir, ignore_errors=True)

        job["status"] = "done"
        job["storage_output_path"] = storage_output
        _db_write(job_id, {
            "status": "done",
            "settings": {"threshold_db": req.threshold_db, "min_silence_duration": req.min_silence_duration},
        })
        return {"status": "done", "job_id": job_id}

    except HTTPException:
        raise
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        job["status"] = "error"
        job["error"] = "Processing failed. Try adjusting your settings and running again."
        _db_write(job_id, {"status": "error"})
        raise HTTPException(
            status_code=500,
            detail="Processing failed. Try adjusting your settings and running again.",
        )


@app.get("/status/{job_id}")
async def get_status(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return current job status: pending | processing | done | error."""
    job = _assert_job_owner(job_id, user_id)
    return {
        "job_id": job_id,
        "status": job["status"],
        "error": job.get("error"),
    }


@app.get("/download/{job_id}")
async def download_video(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return a short-lived signed URL for the processed video."""
    job = _assert_job_owner(job_id, user_id)

    if job["status"] == "processing":
        raise HTTPException(status_code=400, detail="Your video is still being processed. Please wait.")
    if job["status"] == "error":
        raise HTTPException(status_code=400, detail="This job encountered an error. Please try processing again.")
    if job["status"] != "done":
        raise HTTPException(status_code=400, detail=f"Job is not ready for download (status: {job['status']}).")

    storage_output = job.get("storage_output_path")
    if not storage_output:
        raise HTTPException(
            status_code=404,
            detail="Processed file not found in storage. It may have been cleaned up — please process again.",
        )

    try:
        signed_url = _storage_signed_url(OUTPUT_BUCKET, storage_output, expires=3600)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate download link: {exc}")

    return {"download_url": signed_url}


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
async def process_respawn(
    job_id: str,
    req: RespawnRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Detect and remove respawn-wait segments: frames that are black AND silent
    for at least req.min_duration seconds.
    """
    job = _assert_job_owner(job_id, user_id)
    if job.get("respawn_status") == "processing":
        raise HTTPException(status_code=400, detail="Respawn processing is already in progress.")

    try:
        _check_ffmpeg()
        _check_cv2()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    job["respawn_status"] = "processing"
    job["respawn_error"] = None

    storage_input = job.get("storage_input_path") or ""
    if not storage_input:
        job["respawn_status"] = "error"
        job["respawn_error"] = "Source file not found in storage."
        raise HTTPException(status_code=500, detail="Source file not found in storage.")

    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    local_input = job_dir / "respawn_input.mp4"

    try:
        _storage_download(UPLOAD_BUCKET, storage_input, local_input)
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        job["respawn_status"] = "error"
        job["respawn_error"] = "Could not retrieve source file from storage."
        raise HTTPException(status_code=500, detail=f"Failed to download source: {exc}")

    input_path = str(local_input)
    output_path = job_dir / f"{job_id}_respawn_processed.mp4"

    try:
        black_segs = detect_black_frames(input_path, req.black_threshold, job_dir)
        silence_segs = detect_silence(input_path, -35.0, 0.3)
        respawn_segs = find_respawn_segments(black_segs, silence_segs, req.min_duration)

        if not respawn_segs:
            shutil.rmtree(job_dir, ignore_errors=True)
            job["respawn_status"] = "done"
            job["respawn_stats"] = {"segments_removed": 0, "time_saved_seconds": 0.0}
            return {"status": "done", "segments_removed": 0, "time_saved_seconds": 0.0}

        duration = get_video_duration(input_path)
        keep_intervals = invert_silence_segments(respawn_segs, duration)
        concat_video(input_path, keep_intervals, str(output_path))

        storage_respawn = f"{user_id}/{job_id}/respawn.mp4"
        _storage_upload(OUTPUT_BUCKET, storage_respawn, output_path)
        shutil.rmtree(job_dir, ignore_errors=True)

        time_saved = round(sum(e - s for s, e in respawn_segs), 1)
        stats = {"segments_removed": len(respawn_segs), "time_saved_seconds": time_saved}

        job["respawn_status"] = "done"
        job["storage_respawn_output_path"] = storage_respawn
        job["respawn_stats"] = stats

        return {"status": "done", **stats}

    except HTTPException:
        raise
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        job["respawn_status"] = "error"
        job["respawn_error"] = "Processing failed. Try adjusting your settings and running again."
        raise HTTPException(
            status_code=500,
            detail="Processing failed. Try adjusting your settings and running again.",
        )


@app.get("/download/respawn/{job_id}")
async def download_respawn_video(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return a short-lived signed URL for the respawn-processed video."""
    job = _assert_job_owner(job_id, user_id)
    respawn_status = job.get("respawn_status", "idle")

    if respawn_status == "processing":
        raise HTTPException(status_code=400, detail="Respawn processing is still in progress.")
    if respawn_status == "error":
        raise HTTPException(status_code=400, detail="Respawn processing encountered an error. Please try again.")
    if respawn_status != "done":
        raise HTTPException(status_code=400, detail="Respawn processing has not been run yet.")

    storage_respawn = job.get("storage_respawn_output_path")
    if not storage_respawn:
        raise HTTPException(status_code=400, detail="No respawn waits were detected — nothing to download.")

    try:
        signed_url = _storage_signed_url(OUTPUT_BUCKET, storage_respawn, expires=3600)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate download link: {exc}")

    return {"download_url": signed_url}


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


# ---------------------------------------------------------------------------
# Full Pipeline endpoints
# ---------------------------------------------------------------------------

@app.post("/process/pipeline/{job_id}")
async def process_pipeline(
    job_id: str,
    req: PipelineRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Run all enabled steps in order: dead space → respawn removal → hype detection.
    Each step uses the output of the previous as its input.
    Processing runs in a background thread; poll GET /status/{job_id}/pipeline.
    """
    job = _assert_job_owner(job_id, user_id)
    if job.get("pipeline_status") == "running":
        raise HTTPException(status_code=400, detail="Pipeline is already running.")

    if not any([req.dead_space.enabled, req.respawn_removal.enabled, req.hype_detection.enabled]):
        raise HTTPException(status_code=400, detail="At least one pipeline step must be enabled.")

    try:
        _check_ffmpeg()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    all_steps: list[str] = []
    if req.dead_space.enabled:
        all_steps.append("dead_space")
    if req.respawn_removal.enabled:
        all_steps.append("respawn_removal")
    if req.hype_detection.enabled:
        all_steps.append("hype_detection")

    job["pipeline_status"] = "running"
    job["pipeline_step"] = all_steps[0] if all_steps else None
    job["pipeline_steps_all"] = list(all_steps)
    job["pipeline_steps_completed"] = []
    job["pipeline_output_path"] = None
    job["pipeline_hype_moments"] = None
    job["pipeline_summary"] = None
    job["pipeline_error"] = None

    t = threading.Thread(target=_run_pipeline, args=(job_id, req), daemon=True)
    t.start()

    return {"status": "running", "job_id": job_id}


@app.get("/status/{job_id}/pipeline")
async def get_pipeline_status(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return step-by-step progress for a running or completed pipeline."""
    job = _assert_job_owner(job_id, user_id)
    status = job.get("pipeline_status", "idle")
    all_steps: list[str] = job.get("pipeline_steps_all", [])
    completed: list[str] = job.get("pipeline_steps_completed", [])
    current_step = job.get("pipeline_step")
    remaining = [s for s in all_steps if s not in completed and s != current_step]

    n = len(all_steps)
    if status == "done":
        percent = 100
    elif n > 0:
        percent = round(len(completed) / n * 100)
    else:
        percent = 0

    resp: dict[str, Any] = {
        "status": status,
        "current_step": current_step,
        "steps_completed": completed,
        "steps_remaining": remaining,
        "percent": percent,
    }

    if status == "done":
        resp["summary"] = job.get("pipeline_summary")
        resp["has_video_output"] = job.get("storage_pipeline_output_path") is not None
    elif status == "error":
        resp["error"] = job.get("pipeline_error", "Pipeline failed. Please try again.")

    return resp


@app.get("/download/pipeline/{job_id}")
async def download_pipeline_video(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return a short-lived signed URL for the pipeline-processed video."""
    job = _assert_job_owner(job_id, user_id)
    if job.get("pipeline_status") != "done":
        raise HTTPException(status_code=400, detail="Pipeline has not completed yet.")

    storage_pipeline = job.get("storage_pipeline_output_path")
    if not storage_pipeline:
        raise HTTPException(
            status_code=400,
            detail="No video output from pipeline — only analysis steps were run.",
        )

    try:
        signed_url = _storage_signed_url(OUTPUT_BUCKET, storage_pipeline, expires=3600)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate download link: {exc}")

    return {"download_url": signed_url}


@app.get("/download/pipeline/{job_id}/hype")
async def download_pipeline_hype_markers(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return a CapCut-compatible XML file with hype markers from the pipeline run."""
    job = _assert_job_owner(job_id, user_id)
    if job.get("pipeline_status") != "done":
        raise HTTPException(status_code=400, detail="Pipeline has not completed yet.")

    moments = job.get("pipeline_hype_moments") or []
    if not moments:
        raise HTTPException(
            status_code=400,
            detail="No hype moments were detected in the pipeline run — nothing to export.",
        )

    xml_content = _build_capcut_xml(moments)
    return Response(
        content=xml_content,
        media_type="application/xml",
        headers={"Content-Disposition": 'attachment; filename="hype_markers.xml"'},
    )


# ---------------------------------------------------------------------------
# Hype Moment Detection endpoints
# ---------------------------------------------------------------------------

@app.post("/analyze/hype/{job_id}")
async def analyze_hype(
    job_id: str,
    req: HypeRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Detect hype moments: timestamps where audio energy AND motion both spike
    simultaneously. Returns a ranked list of { timestamp, score, label }.
    Does NOT modify the video.
    """
    job = _assert_job_owner(job_id, user_id)
    if job.get("hype_status") == "analyzing":
        raise HTTPException(status_code=400, detail="Hype analysis is already in progress.")

    try:
        _check_ffmpeg()
        _check_cv2()
        _check_librosa()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    job["hype_status"] = "analyzing"
    job["hype_error"] = None

    storage_input = job.get("storage_input_path") or ""
    if not storage_input:
        job["hype_status"] = "error"
        job["hype_error"] = "Source file not found in storage."
        raise HTTPException(status_code=500, detail="Source file not found in storage.")

    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    local_input = job_dir / "hype_input.mp4"

    try:
        _storage_download(UPLOAD_BUCKET, storage_input, local_input)
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        job["hype_status"] = "error"
        job["hype_error"] = "Could not retrieve source file from storage."
        raise HTTPException(status_code=500, detail=f"Failed to download source: {exc}")

    input_path = str(local_input)

    try:
        audio_path = job_dir / "audio.wav"
        _extract_audio_wav(input_path, str(audio_path))

        audio_peaks = _audio_rms_peaks(str(audio_path), req.audio_sensitivity)
        motion_peaks = _motion_diff_peaks(input_path, req.motion_sensitivity, job_dir)

        moments = _merge_hype_moments(audio_peaks, motion_peaks, req.min_gap_seconds)

        shutil.rmtree(job_dir, ignore_errors=True)

        job["hype_status"] = "done"
        job["hype_moments"] = moments

        return {"status": "done", "moments": moments}

    except HTTPException:
        raise
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        job["hype_status"] = "error"
        job["hype_error"] = "Analysis failed. Try adjusting your settings and running again."
        raise HTTPException(
            status_code=500,
            detail="Analysis failed. Try adjusting your settings and running again.",
        )


@app.get("/analyze/hype/{job_id}/export")
async def export_hype_markers(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return a CapCut-compatible XML file with hype moment markers."""
    job = _assert_job_owner(job_id, user_id)
    if job.get("hype_status") != "done":
        raise HTTPException(
            status_code=400,
            detail="Hype analysis has not been completed yet.",
        )

    moments = job.get("hype_moments") or []
    if not moments:
        raise HTTPException(
            status_code=400,
            detail="No hype moments were detected — nothing to export.",
        )

    xml_content = _build_capcut_xml(moments)
    return Response(
        content=xml_content,
        media_type="application/xml",
        headers={"Content-Disposition": 'attachment; filename="hype_markers.xml"'},
    )


# ---------------------------------------------------------------------------
# Hype detection helpers
# ---------------------------------------------------------------------------

def _extract_audio_wav(input_path: str, output_path: str) -> None:
    """Extract a mono 22050 Hz WAV track from a video using ffmpeg."""
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-ac", "1", "-ar", "22050",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            "Failed to extract audio from the video. "
            f"Details: {result.stderr[-500:]}"
        )


def _audio_rms_peaks(
    audio_path: str, sensitivity: float
) -> list[tuple[float, float]]:
    """
    Load WAV with librosa, compute RMS energy in 0.1 s windows,
    normalise, and return (timestamp_seconds, normalised_rms) for every
    frame >= sensitivity.
    """
    import librosa

    y, sr = librosa.load(audio_path, sr=22050, mono=True)

    hop = int(sr * 0.1)          # 0.1 s per frame
    frame_len = hop * 2          # 0.2 s analysis window

    rms = librosa.feature.rms(y=y, frame_length=frame_len, hop_length=hop)[0]
    peak_val = float(rms.max())
    if peak_val == 0:
        return []

    rms_norm = rms / peak_val
    return [
        (float(i * 0.1), float(rms_norm[i]))
        for i in range(len(rms_norm))
        if rms_norm[i] >= sensitivity
    ]


def _motion_diff_peaks(
    input_path: str, sensitivity: float, job_dir: Path
) -> list[tuple[float, float]]:
    """
    Extract 5fps frames via ffmpeg, compute absolute greyscale diff between
    consecutive frames, normalise, and return (timestamp_seconds, normalised_diff)
    for every frame >= sensitivity.
    """
    import cv2

    frames_dir = job_dir / "hype_frames"
    frames_dir.mkdir(exist_ok=True)

    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-vf", "fps=5",
        str(frames_dir / "frame_%05d.jpg"),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Failed to extract frames for motion analysis. "
            f"Details: {result.stderr[-500:]}"
        )

    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if len(frame_files) < 2:
        return []

    diffs: list[float] = []
    prev_gray = None

    for frame_path in frame_files:
        img = cv2.imread(str(frame_path))
        if img is None:
            diffs.append(0.0)
            prev_gray = None
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if prev_gray is not None:
            diff_img = cv2.absdiff(gray, prev_gray)
            diffs.append(float(cv2.mean(diff_img)[0]))
        else:
            diffs.append(0.0)
        prev_gray = gray

    max_diff = max(diffs) if diffs else 0.0
    if max_diff == 0:
        return []

    return [
        (float(i / 5.0), float(diffs[i] / max_diff))
        for i in range(len(diffs))
        if diffs[i] / max_diff >= sensitivity
    ]


def _merge_hype_moments(
    audio_peaks: list[tuple[float, float]],
    motion_peaks: list[tuple[float, float]],
    min_gap: float,
    overlap_window: float = 0.5,
) -> list[dict]:
    """
    Intersect audio and motion peak lists: keep only timestamps where both
    signals are active within overlap_window seconds of each other.
    Score = average of the two normalised values.
    Then merge events closer than min_gap seconds, keeping the highest score.
    """
    raw: list[tuple[float, float]] = []

    for a_t, a_s in audio_peaks:
        for m_t, m_s in motion_peaks:
            if abs(a_t - m_t) <= overlap_window:
                t = (a_t + m_t) / 2.0
                score = min(1.0, (a_s + m_s) / 2.0)
                raw.append((t, score))

    if not raw:
        return []

    raw.sort(key=lambda x: x[0])

    # Deduplicate within overlap_window first
    deduped: list[tuple[float, float]] = [raw[0]]
    for t, score in raw[1:]:
        if t - deduped[-1][0] <= overlap_window:
            if score > deduped[-1][1]:
                deduped[-1] = (t, score)
        else:
            deduped.append((t, score))

    # Then merge events closer than min_gap
    merged: list[tuple[float, float]] = [deduped[0]]
    for t, score in deduped[1:]:
        if t - merged[-1][0] < min_gap:
            if score > merged[-1][1]:
                merged[-1] = (t, score)
        else:
            merged.append((t, score))

    return [
        {"timestamp": round(t, 2), "score": round(s, 3), "label": "Hype Moment"}
        for t, s in merged
    ]


def _build_capcut_xml(moments: list[dict]) -> str:
    """Generate a CapCut-compatible XML marker file (30 fps frame numbers)."""
    lines = ["<sequence>", "  <markers>"]
    for m in moments:
        frame = round(m["timestamp"] * 30)
        lines.append(
            f'    <marker time="{frame}" name="Hype Moment" color="red"/>'
        )
    lines += ["  </markers>", "</sequence>"]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# YouTube publishing helpers
# ---------------------------------------------------------------------------

def _get_youtube_flow() -> "_GoogleAuthFlow":
    """Build a google-auth-oauthlib Flow for the YouTube upload scope."""
    if not _GOOGLE_APIS_AVAILABLE:
        raise RuntimeError("Google API libraries are not installed.")
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise RuntimeError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.")
    client_config = {
        "web": {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [GOOGLE_REDIRECT_URI],
        }
    }
    return _GoogleAuthFlow.from_client_config(
        client_config,
        scopes=YOUTUBE_SCOPES,
        redirect_uri=GOOGLE_REDIRECT_URI,
    )


def _creds_to_dict(creds: "_GoogleCredentials") -> dict:
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes) if creds.scopes else YOUTUBE_SCOPES,
    }


def _creds_from_dict(d: dict) -> "_GoogleCredentials":
    return _GoogleCredentials(
        token=d.get("token"),
        refresh_token=d.get("refresh_token"),
        token_uri=d.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=d.get("client_id"),
        client_secret=d.get("client_secret"),
        scopes=d.get("scopes", YOUTUBE_SCOPES),
    )


def _save_youtube_creds(user_id: str, creds: "_GoogleCredentials") -> None:
    """Persist Google credentials to user_profiles table. Best-effort."""
    if supabase_admin is None:
        return
    try:
        supabase_admin.table("user_profiles").upsert({
            "user_id": user_id,
            "youtube_credentials": _creds_to_dict(creds),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as exc:
        import sys
        print(f"[ClipForge] Failed to save YouTube creds for {user_id}: {exc}", file=sys.stderr)


def _load_youtube_creds(user_id: str) -> "_GoogleCredentials | None":
    """Load and optionally refresh Google credentials from user_profiles."""
    if supabase_admin is None or not _GOOGLE_APIS_AVAILABLE:
        return None
    try:
        result = (
            supabase_admin.table("user_profiles")
            .select("youtube_credentials")
            .eq("user_id", user_id)
            .execute()
        )
        if not result.data or not result.data[0].get("youtube_credentials"):
            return None
        creds = _creds_from_dict(result.data[0]["youtube_credentials"])
        # Refresh if expired
        if creds.expired and creds.refresh_token:
            creds.refresh(_GoogleAuthRequest())
            _save_youtube_creds(user_id, creds)
        return creds
    except Exception as exc:
        import sys
        print(f"[ClipForge] Failed to load YouTube creds for {user_id}: {exc}", file=sys.stderr)
        return None


def _cleanup_oauth_states() -> None:
    """Remove OAuth state nonces older than 10 minutes."""
    cutoff = time.time()
    expired = [k for k, (_, exp) in _youtube_oauth_states.items() if exp < cutoff]
    for k in expired:
        del _youtube_oauth_states[k]


async def _verify_token_from_query(token: str) -> str:
    """Validate a raw Supabase JWT string and return the user_id. Raises HTTP 401 on failure."""
    if supabase_admin is None:
        raise HTTPException(status_code=503, detail="Authentication service is not configured.")
    try:
        resp = supabase_admin.auth.get_user(token)
        if resp.user is None:
            raise HTTPException(status_code=401, detail="Invalid or expired token.")
        return str(resp.user.id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")


# ---------------------------------------------------------------------------
# YouTube publishing endpoints
# ---------------------------------------------------------------------------

@app.get("/auth/youtube")
async def youtube_auth(token: str = Query(..., description="Supabase JWT from the frontend")):
    """
    Redirect the authenticated user to the Google OAuth consent screen.
    The frontend navigates window.location.href to this URL, passing the
    Supabase JWT as ?token= because browser navigation cannot carry headers.
    """
    try:
        _check_google()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    user_id = await _verify_token_from_query(token)

    _cleanup_oauth_states()

    # Generate a short-lived state nonce (valid for 10 minutes)
    state = secrets.token_urlsafe(32)
    _youtube_oauth_states[state] = (user_id, time.time() + 600)

    flow = _get_youtube_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        state=state,
        prompt="consent",  # always ask so we receive a refresh_token
    )
    return RedirectResponse(url=auth_url)


@app.get("/auth/youtube/callback")
async def youtube_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
):
    """
    Google redirects here after the user grants (or denies) YouTube access.
    Exchanges the authorization code for tokens, persists them, and redirects
    back to the frontend.
    """
    _cleanup_oauth_states()

    if error or not code or not state:
        return RedirectResponse(url=f"{FRONTEND_URL}/?youtube=error")

    entry = _youtube_oauth_states.pop(state, None)
    if entry is None:
        return RedirectResponse(url=f"{FRONTEND_URL}/?youtube=error")

    user_id, expiry = entry
    if time.time() > expiry:
        return RedirectResponse(url=f"{FRONTEND_URL}/?youtube=error")

    try:
        flow = _get_youtube_flow()
        # Allow HTTP for local development (must set OAUTHLIB_INSECURE_TRANSPORT=1 in env)
        flow.fetch_token(code=code)
        creds = flow.credentials
        _save_youtube_creds(user_id, creds)
    except Exception as exc:
        import sys
        print(f"[ClipForge] YouTube OAuth callback failed: {exc}", file=sys.stderr)
        return RedirectResponse(url=f"{FRONTEND_URL}/?youtube=error")

    return RedirectResponse(url=f"{FRONTEND_URL}/?youtube=connected")


@app.get("/auth/youtube/status")
async def youtube_status(user_id: str = Depends(get_current_user_id)):
    """Return whether the authenticated user has YouTube credentials stored."""
    if supabase_admin is None:
        return {"connected": False}
    try:
        result = (
            supabase_admin.table("user_profiles")
            .select("youtube_credentials")
            .eq("user_id", user_id)
            .execute()
        )
        connected = bool(result.data and result.data[0].get("youtube_credentials"))
        return {"connected": connected}
    except Exception:
        return {"connected": False}


@app.post("/publish/youtube/{job_id}")
async def publish_to_youtube(
    job_id: str,
    req: YouTubePublishRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Upload the processed video file to YouTube using the stored OAuth credentials.
    Uses resumable upload (1 MB chunks) so large files are handled gracefully.
    Returns the YouTube video URL and video ID.
    """
    try:
        _check_google()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    job = _assert_job_owner(job_id, user_id)

    # Pick the most-processed output available (pipeline > dead space > respawn)
    storage_video_path = (
        job.get("storage_pipeline_output_path")
        or job.get("storage_output_path")
        or job.get("storage_respawn_output_path")
    )
    if not storage_video_path:
        raise HTTPException(
            status_code=400,
            detail="No processed video found. Please process your video before publishing.",
        )

    # Download from Supabase Storage to a local temp file for the YouTube upload
    yt_job_dir = TEMP_DIR / f"{job_id}_yt"
    yt_job_dir.mkdir(parents=True, exist_ok=True)
    local_video = yt_job_dir / "upload.mp4"
    try:
        _storage_download(OUTPUT_BUCKET, storage_video_path, local_video)
    except Exception as exc:
        shutil.rmtree(yt_job_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve video for publishing: {exc}")

    video_path = str(local_video)

    # Load credentials
    creds = _load_youtube_creds(user_id)
    if creds is None:
        raise HTTPException(
            status_code=400,
            detail="YouTube is not connected. Please connect your YouTube account first.",
        )
    if creds.expired and not creds.refresh_token:
        raise HTTPException(
            status_code=400,
            detail="YouTube credentials have expired and cannot be refreshed. Please reconnect.",
        )

    try:
        youtube = _google_build("youtube", "v3", credentials=creds)

        body = {
            "snippet": {
                "title": req.title[:100],  # YouTube title limit
                "description": req.description[:5000],
                "tags": req.tags[:500],
                "categoryId": req.category_id,
            },
            "status": {
                "privacyStatus": req.privacy,
            },
        }

        insert_request = youtube.videos().insert(
            part=",".join(body.keys()),
            body=body,
            media_body=_MediaFileUpload(
                video_path,
                chunksize=1024 * 1024,  # 1 MB chunks
                resumable=True,
            ),
        )

        response = None
        while response is None:
            _, response = insert_request.next_chunk()

        # Persist potentially-refreshed credentials
        _save_youtube_creds(user_id, creds)

        shutil.rmtree(yt_job_dir, ignore_errors=True)
        video_id = response["id"]
        return {
            "video_id": video_id,
            "youtube_url": f"https://www.youtube.com/watch?v={video_id}",
        }

    except HTTPException:
        shutil.rmtree(yt_job_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(yt_job_dir, ignore_errors=True)
        import sys
        print(f"[ClipForge] YouTube upload failed for job {job_id}: {exc}", file=sys.stderr)
        raise HTTPException(
            status_code=500,
            detail="YouTube upload failed. Please try again or check your YouTube channel settings.",
        )


# ---------------------------------------------------------------------------
# Team routes
# ---------------------------------------------------------------------------

@app.post("/teams")
async def create_team(
    req: CreateTeamRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Create a new team workspace. Requires Team plan."""
    if supabase_admin is None:
        raise HTTPException(status_code=503, detail="Database not configured.")
    plan, _ = _get_usage(user_id)
    if plan != "team":
        raise HTTPException(
            status_code=403,
            detail="Team workspaces require the Team plan. Upgrade at /billing.",
        )
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name cannot be empty.")
    try:
        team_resp = supabase_admin.table("teams").insert({
            "name": name,
            "owner_id": user_id,
        }).execute()
        team = team_resp.data[0]
        team_id = team["id"]
        supabase_admin.table("team_members").insert({
            "team_id": team_id,
            "user_id": user_id,
            "role": "owner",
        }).execute()
        return {"id": team_id, "name": name, "role": "owner"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create team: {exc}")


@app.get("/teams")
async def list_teams(user_id: str = Depends(get_current_user_id)):
    """List all teams the authenticated user belongs to."""
    if supabase_admin is None:
        return {"teams": []}
    try:
        resp = (
            supabase_admin.table("team_members")
            .select("role, teams(id, name, owner_id)")
            .eq("user_id", user_id)
            .execute()
        )
        teams = []
        for row in (resp.data or []):
            t = row.get("teams") or {}
            if t.get("id"):
                teams.append({
                    "id": t["id"],
                    "name": t["name"],
                    "owner_id": t.get("owner_id"),
                    "role": row.get("role", "member"),
                })
        return {"teams": teams}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list teams: {exc}")


@app.get("/teams/{team_id}")
async def get_team(team_id: str, user_id: str = Depends(get_current_user_id)):
    """Return team info and full member list. Requires membership."""
    _assert_team_member_db(team_id, user_id)
    if supabase_admin is None:
        raise HTTPException(status_code=503, detail="Database not configured.")
    try:
        team_resp = (
            supabase_admin.table("teams").select("*").eq("id", team_id).maybe_single().execute()
        )
        if not team_resp.data:
            raise HTTPException(status_code=404, detail="Team not found.")

        members_resp = (
            supabase_admin.table("team_members")
            .select("user_id, role, joined_at")
            .eq("team_id", team_id)
            .execute()
        )
        members = []
        for m in (members_resp.data or []):
            try:
                u = supabase_admin.auth.admin.get_user_by_id(m["user_id"])
                email = u.user.email if u.user else ""
            except Exception:
                email = ""
            members.append({
                "user_id": m["user_id"],
                "email": email,
                "role": m["role"],
                "joined_at": m["joined_at"],
            })

        return {
            "id": team_resp.data["id"],
            "name": team_resp.data["name"],
            "owner_id": team_resp.data["owner_id"],
            "created_at": team_resp.data["created_at"],
            "members": members,
            "seat_limit": TEAM_SEAT_LIMIT,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to get team: {exc}")


@app.patch("/teams/{team_id}")
async def update_team(
    team_id: str,
    req: UpdateTeamRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Rename a team. Owner only."""
    _assert_team_owner_db(team_id, user_id)
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name cannot be empty.")
    try:
        supabase_admin.table("teams").update({"name": name}).eq("id", team_id).execute()
        return {"id": team_id, "name": name}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update team: {exc}")


@app.post("/teams/{team_id}/invite")
async def invite_team_member(
    team_id: str,
    req: InviteMemberRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Invite a user by email. Owner only. Enforces 5-seat limit."""
    _assert_team_owner_db(team_id, user_id)
    if supabase_admin is None:
        raise HTTPException(status_code=503, detail="Database not configured.")

    current_count = _get_team_member_count(team_id)
    if current_count >= TEAM_SEAT_LIMIT:
        raise HTTPException(
            status_code=403,
            detail=f"Seat limit reached ({TEAM_SEAT_LIMIT} members maximum).",
        )
    try:
        # invite_user_by_email returns the user (creates if new, reuses if existing)
        invite_resp = supabase_admin.auth.admin.invite_user_by_email(req.email)
        invited_uid = str(invite_resp.user.id)

        existing = (
            supabase_admin.table("team_members")
            .select("user_id")
            .eq("team_id", team_id)
            .eq("user_id", invited_uid)
            .maybe_single()
            .execute()
        )
        if existing.data:
            raise HTTPException(
                status_code=400, detail="User is already a member of this team."
            )
        supabase_admin.table("team_members").insert({
            "team_id": team_id,
            "user_id": invited_uid,
            "role": "member",
        }).execute()
        return {"message": f"Invite sent to {req.email}."}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to send invite: {exc}")


@app.get("/teams/{team_id}/jobs")
async def list_team_jobs(team_id: str, user_id: str = Depends(get_current_user_id)):
    """List jobs associated with a team workspace."""
    _assert_team_member_db(team_id, user_id)

    db_jobs: list[Dict[str, Any]] = []
    if supabase_admin is not None:
        try:
            resp = (
                supabase_admin.table("jobs")
                .select("id, status, created_at, summary")
                .eq("team_id", team_id)
                .order("created_at", desc=True)
                .limit(50)
                .execute()
            )
            db_jobs = resp.data or []
        except Exception:
            pass

    result = []
    seen: set[str] = set()
    for db_job in db_jobs:
        jid = db_job["id"]
        seen.add(jid)
        mem = jobs.get(jid, {})
        result.append({
            "job_id": jid,
            "status": mem.get("status") or db_job.get("status", "unknown"),
            "filename": mem.get("filename", ""),
            "created_at": db_job.get("created_at"),
        })
    # Include in-memory-only jobs not yet persisted to DB
    for jid, j in jobs.items():
        if j.get("team_id") == team_id and jid not in seen:
            result.append({
                "job_id": jid,
                "status": j.get("status", "unknown"),
                "filename": j.get("filename", ""),
                "created_at": None,
            })

    return {"jobs": result}


@app.delete("/teams/{team_id}/members/{member_user_id}")
async def remove_team_member(
    team_id: str,
    member_user_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Remove a member from a team. Owner only. Cannot remove the owner."""
    team = _assert_team_owner_db(team_id, user_id)
    if member_user_id == team["owner_id"]:
        raise HTTPException(status_code=400, detail="Cannot remove the team owner.")
    if supabase_admin is None:
        raise HTTPException(status_code=503, detail="Database not configured.")
    try:
        supabase_admin.table("team_members").delete().eq(
            "team_id", team_id
        ).eq("user_id", member_user_id).execute()
        return {"message": "Member removed."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to remove member: {exc}")


# ---------------------------------------------------------------------------
# Billing routes
# ---------------------------------------------------------------------------

@app.post("/billing/checkout")
async def billing_checkout(
    req: CheckoutRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Create a Stripe Checkout session for the selected plan."""
    if not _STRIPE_AVAILABLE or not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Billing is not configured.")
    price_id = STRIPE_PRICE_CREATOR if req.plan == "creator" else STRIPE_PRICE_TEAM
    if not price_id:
        raise HTTPException(
            status_code=503,
            detail=f"Price ID for the '{req.plan}' plan is not configured.",
        )
    try:
        _stripe.api_key = STRIPE_SECRET_KEY
        session = _stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"{FRONTEND_URL}/billing/success",
            cancel_url=f"{FRONTEND_URL}/billing",
            metadata={"user_id": user_id},
        )
        return {"checkout_url": session.url}
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create checkout session: {exc}",
        )


@app.post("/billing/webhook")
async def billing_webhook(request: Request):
    """Handle Stripe webhook events to keep subscription state in sync."""
    if not _STRIPE_AVAILABLE or not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Billing webhook is not configured.")
    _stripe.api_key = STRIPE_SECRET_KEY
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        event = _stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except _stripe.error.SignatureVerificationError:  # type: ignore[attr-defined]
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Webhook error: {exc}")

    event_type = event["type"]

    if event_type == "checkout.session.completed":
        session_obj = event["data"]["object"]
        uid = (session_obj.get("metadata") or {}).get("user_id")
        if uid and supabase_admin:
            # Resolve the price ID to determine the plan name
            price_id = None
            try:
                line_items = _stripe.checkout.Session.list_line_items(session_obj["id"], limit=1)
                if line_items.data:
                    price_id = line_items.data[0].price.id
            except Exception:
                pass
            if price_id == STRIPE_PRICE_CREATOR:
                plan_name = "creator"
            elif price_id == STRIPE_PRICE_TEAM:
                plan_name = "team"
            else:
                plan_name = "creator"  # safe default for unrecognised price
            try:
                supabase_admin.table("user_profiles").upsert({
                    "user_id": uid,
                    "plan": plan_name,
                    "stripe_customer_id": session_obj.get("customer") or "",
                    "stripe_subscription_id": session_obj.get("subscription") or "",
                }).execute()
            except Exception as exc:
                import sys
                print(f"[ClipForge] Webhook DB update failed: {exc}", file=sys.stderr)

    elif event_type == "customer.subscription.deleted":
        sub_obj = event["data"]["object"]
        customer_id = sub_obj.get("customer")
        if customer_id and supabase_admin:
            try:
                resp = (
                    supabase_admin.table("user_profiles")
                    .select("user_id")
                    .eq("stripe_customer_id", customer_id)
                    .maybe_single()
                    .execute()
                )
                if resp.data:
                    supabase_admin.table("user_profiles").upsert({
                        "user_id": resp.data["user_id"],
                        "plan": "free",
                        "stripe_subscription_id": "",
                    }).execute()
            except Exception as exc:
                import sys
                print(f"[ClipForge] Webhook subscription-deleted handling error: {exc}", file=sys.stderr)

    elif event_type == "invoice.payment_failed":
        invoice_obj = event["data"]["object"]
        customer_id = invoice_obj.get("customer")
        if customer_id and supabase_admin:
            try:
                resp = (
                    supabase_admin.table("user_profiles")
                    .select("user_id")
                    .eq("stripe_customer_id", customer_id)
                    .maybe_single()
                    .execute()
                )
                if resp.data:
                    supabase_admin.table("user_profiles").upsert({
                        "user_id": resp.data["user_id"],
                        "plan": "free",
                    }).execute()
            except Exception as exc:
                import sys
                print(f"[ClipForge] Webhook payment-failed handling error: {exc}", file=sys.stderr)

    return {"received": True}


@app.get("/billing/status")
async def billing_status(user_id: str = Depends(get_current_user_id)):
    """Return the authenticated user's current plan and monthly usage."""
    plan, videos_this_month = _get_usage(user_id)
    return {
        "plan": plan,
        "videos_this_month": videos_this_month,
        "limit": PLAN_LIMITS.get(plan),
    }


# ---------------------------------------------------------------------------
# Pipeline runner (executes in a daemon thread)
# ---------------------------------------------------------------------------

def _run_pipeline(job_id: str, req: PipelineRequest) -> None:
    """
    Run dead-space removal → respawn removal → hype detection in sequence.
    Each video-processing step uses the output of the previous step as input.
    Updates job dict fields directly (thread-safe for CPython dict writes).
    """
    job = jobs[job_id]
    all_steps: list[str] = job["pipeline_steps_all"]

    # Download source from Supabase Storage to a local temp directory
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    local_input = job_dir / "pipeline_input.mp4"

    storage_input = job.get("storage_input_path") or ""
    if not storage_input:
        job["pipeline_status"] = "error"
        job["pipeline_error"] = "Source file not found in storage."
        _db_write(job_id, {"status": "error"})
        return

    try:
        _storage_download(UPLOAD_BUCKET, storage_input, local_input)
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        job["pipeline_status"] = "error"
        job["pipeline_error"] = "Could not retrieve source file from storage."
        _db_write(job_id, {"status": "error"})
        return

    input_path = str(local_input)
    current_input = input_path
    dead_space_removed_seconds = 0.0
    respawn_waits_removed = 0
    hype_moments_found = 0

    try:
        # ── Step 1: Dead Space Removal ──────────────────────────────────────
        if req.dead_space.enabled:
            job["pipeline_step"] = "dead_space"

            silence_segs = detect_silence(
                current_input,
                req.dead_space.threshold_db,
                req.dead_space.min_silence_duration,
            )
            duration = get_video_duration(current_input)
            keep_intervals = invert_silence_segments(silence_segs, duration)

            if keep_intervals:
                out = str(job_dir / f"{job_id}_pipeline_deadspace.mp4")
                concat_video(current_input, keep_intervals, out)
                kept = sum(e - s for s, e in keep_intervals)
                dead_space_removed_seconds = round(max(0.0, duration - kept), 1)
                current_input = out

            job["pipeline_steps_completed"] = [
                s for s in all_steps
                if s == "dead_space" or s in job["pipeline_steps_completed"]
            ]

        # ── Step 2: Respawn Wait Removal ────────────────────────────────────
        if req.respawn_removal.enabled:
            job["pipeline_step"] = "respawn_removal"

            black_segs = detect_black_frames(
                current_input, req.respawn_removal.black_threshold, job_dir
            )
            silence_segs = detect_silence(current_input, -35.0, 0.3)
            respawn_segs = find_respawn_segments(
                black_segs, silence_segs, req.respawn_removal.min_duration
            )

            if respawn_segs:
                duration = get_video_duration(current_input)
                keep_intervals = invert_silence_segments(respawn_segs, duration)
                out = str(job_dir / f"{job_id}_pipeline_respawn.mp4")
                concat_video(current_input, keep_intervals, out)
                respawn_waits_removed = len(respawn_segs)
                current_input = out

            job["pipeline_steps_completed"] = [
                s for s in all_steps
                if s in ("dead_space", "respawn_removal")
                or s in job["pipeline_steps_completed"]
            ]

        # ── Step 3: Hype Detection ───────────────────────────────────────────
        if req.hype_detection.enabled:
            job["pipeline_step"] = "hype_detection"

            audio_path = str(job_dir / "pipeline_audio.wav")
            _extract_audio_wav(current_input, audio_path)
            audio_peaks = _audio_rms_peaks(audio_path, req.hype_detection.audio_sensitivity)
            motion_peaks = _motion_diff_peaks(
                current_input, req.hype_detection.motion_sensitivity, job_dir
            )
            moments = _merge_hype_moments(
                audio_peaks, motion_peaks, req.hype_detection.min_gap_seconds
            )
            hype_moments_found = len(moments)
            job["pipeline_hype_moments"] = moments

            job["pipeline_steps_completed"] = list(all_steps)

        # ── Finalise ────────────────────────────────────────────────────────
        has_video_output = current_input != input_path
        summary = {
            "dead_space_removed_seconds": dead_space_removed_seconds,
            "respawn_waits_removed": respawn_waits_removed,
            "hype_moments_found": hype_moments_found,
        }

        storage_pipeline: str | None = None
        if has_video_output:
            storage_pipeline = f"{job['user_id']}/{job_id}/pipeline.mp4"
            _storage_upload(OUTPUT_BUCKET, storage_pipeline, current_input)

        shutil.rmtree(job_dir, ignore_errors=True)

        job["pipeline_status"] = "done"
        job["pipeline_step"] = None
        job["pipeline_steps_completed"] = list(all_steps)
        job["storage_pipeline_output_path"] = storage_pipeline
        job["pipeline_summary"] = summary
        _db_write(job_id, {"status": "done", "summary": summary})

    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        job["pipeline_status"] = "error"
        job["pipeline_step"] = None
        job["pipeline_error"] = "Pipeline failed. Try adjusting your settings and running again."
        _db_write(job_id, {"status": "error"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
