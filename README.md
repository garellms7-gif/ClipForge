# ClipForge

Automatically remove dead space and silence from your videos. Drop a video, tune the silence settings, and download the trimmed result.

```
clipforge/
  backend/    ← FastAPI + ffmpeg processing
  frontend/   ← Next.js + Tailwind UI
  README.md
```

---

## Prerequisites

- **Node.js** 18+
- **Python** 3.10+
- **ffmpeg** (must be available on your PATH)

Install ffmpeg:
```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt install ffmpeg

# Windows — download from https://ffmpeg.org/download.html and add to PATH
```

---

## Backend (FastAPI)

```bash
cd backend

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the dev server
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive docs: `http://localhost:8000/docs`

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload a video file; returns `job_id` |
| `POST` | `/process` | Start silence removal; params: `job_id`, `silence_threshold` (dB), `min_silence_duration` (s) |
| `GET` | `/status/{job_id}` | Poll job status: `uploaded` → `processing` → `done` / `error` |
| `GET` | `/download/{job_id}` | Download the processed video |

---

## Frontend (Next.js)

```bash
cd frontend

# Install dependencies
npm install

# Copy the example env file
cp .env.local.example .env.local
# Edit .env.local if your backend runs on a different port/host

# Start the dev server
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## Usage

1. Drag and drop (or click to browse) a video file onto the upload zone.
2. Adjust **Silence Threshold** (dB) — audio below this level is treated as silence.
3. Adjust **Minimum Silence Duration** (s) — only silences longer than this get removed.
4. Click **Process Video**.
5. Wait for processing to complete, then click **Download Processed Video**.

---

## How it works

1. The frontend uploads the video to `POST /upload`.
2. `POST /process` runs `ffmpeg -af silencedetect` to find silent segments, then uses `ffmpeg` trim/concat filters to cut them out and stitch the remaining audio+video together.
3. The result is streamed back via `GET /download/{job_id}`.

Jobs are stored in memory — restarting the backend clears all jobs and temp files.
