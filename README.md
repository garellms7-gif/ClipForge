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
- **Python** 3.11+
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

# Copy and edit the env file
cp .env.example .env
# ALLOWED_ORIGINS defaults to http://localhost:3000
# Add your Vercel URL when deploying, e.g.:
# ALLOWED_ORIGINS=http://localhost:3000,https://my-app.vercel.app

# Start the dev server
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive docs: `http://localhost:8000/docs`

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins |
| `PORT` | `8000` | Port to bind (set automatically by Railway) |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload a video file; returns `{ job_id }` |
| `POST` | `/process/{job_id}` | Start silence removal; JSON body: `{ threshold_db, min_silence_duration }` |
| `GET` | `/status/{job_id}` | Poll job status: `pending` → `processing` → `done` / `error` |
| `GET` | `/download/{job_id}` | Download the processed video as an attachment |

### Deploy to Railway

1. Push the repo to GitHub.
2. Create a new Railway project → **Deploy from GitHub repo** → select the `backend/` root.
3. Railway will detect the `Procfile` and `runtime.txt` automatically.
4. Add the `ALLOWED_ORIGINS` environment variable with your Vercel frontend URL.

---

## Frontend (Next.js)

```bash
cd frontend

# Install dependencies
npm install

# Copy and edit the env file
cp .env.local.example .env.local
# Set NEXT_PUBLIC_BACKEND_URL to your backend URL

# Start the dev server
npm run dev
```

Open `http://localhost:3000` in your browser.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:8000` | Base URL of the FastAPI backend |

### Deploy to Vercel

1. Import the repo in Vercel → set **Root Directory** to `frontend/`.
2. Add `NEXT_PUBLIC_BACKEND_URL` pointing at your Railway backend URL.
3. Vercel will use `vercel.json` for build settings automatically.

---

## Usage

1. Drag and drop (or click to browse) a video file — it uploads immediately.
2. Adjust **Silence Threshold** (dB) — audio below this level is treated as silence.
3. Adjust **Minimum Silence Duration** (s) — only silences longer than this get removed.
4. Click **Remove Dead Space**.
5. Wait for processing to complete, then click **Download Processed Video**.
6. If processing fails, click **Try Again** to adjust settings and retry without re-uploading.

---

## How it works

1. The frontend uploads the video to `POST /upload` on file select.
2. `POST /process/{job_id}` runs `ffmpeg -af silencedetect` to find silent segments, then uses `ffmpeg` trim/concat filters to cut them out and stitch the remaining audio+video together.
3. The frontend polls `GET /status/{job_id}` every 2 s until `done` or `error`.
4. `GET /download/{job_id}` streams the finished MP4 as an attachment.

Jobs are stored in memory — restarting the backend clears all jobs and temp files.
