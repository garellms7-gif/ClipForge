"use client";

import { useState, useCallback, useRef } from "react";
import DropZone from "@/components/DropZone";
import SettingsPanel from "@/components/SettingsPanel";
import StatusBar from "@/components/StatusBar";

const API =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

// idle       — nothing selected
// uploading  — file dropped, POST /upload in flight
// ready      — upload done, settings visible
// processing — POST /process sent, polling /status
// done       — job finished
// error      — something went wrong
type Stage = "idle" | "uploading" | "ready" | "processing" | "done" | "error";

/** Extract a human-readable message from a fetch Response error body. */
async function parseApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.detail ?? body?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [thresholdDb, setThresholdDb] = useState<number>(-35);
  const [minSilenceDuration, setMinSilenceDuration] = useState<number>(0.5);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // Upload fires immediately on file drop/select
  const handleFileSelect = useCallback(async (f: File) => {
    stopPolling();
    setFile(f);
    setJobId(null);
    setErrorMsg("");
    setStage("uploading");

    try {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch(`${API}/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Upload failed. Please try again."));
      }
      const { job_id } = await res.json();
      setJobId(job_id);
      setStage("ready");
    } catch (e: unknown) {
      setStage("error");
      setErrorMsg(
        e instanceof Error
          ? e.message
          : "Upload failed. Check your connection and try again."
      );
    }
  }, []);

  const handleProcess = async () => {
    if (!jobId) return;
    setStage("processing");
    setErrorMsg("");

    try {
      const res = await fetch(`${API}/process/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threshold_db: thresholdDb,
          min_silence_duration: minSilenceDuration,
        }),
      });
      if (!res.ok) {
        throw new Error(
          await parseApiError(res, "Processing failed. Adjust the settings and try again.")
        );
      }

      // Poll every 2 s
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API}/status/${jobId}`);
          if (!statusRes.ok) return; // transient — keep polling
          const { status, error } = await statusRes.json();
          if (status === "done") {
            stopPolling();
            setStage("done");
          } else if (status === "error") {
            stopPolling();
            setStage("error");
            setErrorMsg(
              error ?? "Processing failed. Adjust the settings and try again."
            );
          }
        } catch {
          // network hiccup — keep polling
        }
      }, 2000);
    } catch (e: unknown) {
      stopPolling();
      setStage("error");
      setErrorMsg(
        e instanceof Error
          ? e.message
          : "An unexpected error occurred. Please try again."
      );
    }
  };

  const handleDownload = () => {
    if (!jobId) return;
    window.open(`${API}/download/${jobId}`, "_blank");
  };

  // "Try Again" — keep the file & jobId, go back to ready so user can tweak settings
  const handleTryAgain = () => {
    stopPolling();
    setErrorMsg("");
    // If we have a jobId the file is still on the server; go back to ready.
    // If the error was during upload (no jobId), go back to idle.
    if (jobId) {
      setStage("ready");
    } else {
      setFile(null);
      setStage("idle");
    }
  };

  // "Process another video" — full reset
  const handleReset = () => {
    stopPolling();
    setFile(null);
    setJobId(null);
    setStage("idle");
    setErrorMsg("");
  };

  const isWorking = stage === "uploading" || stage === "processing";
  const showSettings =
    stage === "ready" ||
    stage === "processing" ||
    stage === "done" ||
    stage === "error";

  return (
    <main
      className="min-h-screen flex flex-col items-center px-4 py-16"
      style={{ background: "var(--bg)" }}
    >
      {/* Header */}
      <header className="mb-12 text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="6" cy="6" r="3" stroke="var(--green)" strokeWidth="1.8" />
            <circle cx="6" cy="18" r="3" stroke="var(--green)" strokeWidth="1.8" />
            <path
              d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"
              stroke="var(--green)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <h1
            className="text-2xl font-bold tracking-[0.2em]"
            style={{ fontFamily: "'Space Mono', monospace", color: "var(--text)" }}
          >
            CLIPFORGE
          </h1>
        </div>
        <p
          className="text-sm"
          style={{ color: "var(--text-muted)", fontFamily: "'DM Sans', sans-serif" }}
        >
          Remove dead space &amp; silence from your videos automatically
        </p>
      </header>

      {/* Main column */}
      <div className="w-full flex flex-col gap-6" style={{ maxWidth: 680 }}>
        {/* Drop zone */}
        <DropZone
          file={file}
          stage={stage}
          onFileSelect={handleFileSelect}
          disabled={isWorking}
        />

        {/* Settings — shown once a file is uploaded */}
        {showSettings && (
          <SettingsPanel
            thresholdDb={thresholdDb}
            onThresholdDbChange={setThresholdDb}
            minSilenceDuration={minSilenceDuration}
            onMinSilenceDurationChange={setMinSilenceDuration}
            disabled={isWorking || stage === "done"}
          />
        )}

        {/* Status feedback */}
        <StatusBar stage={stage} errorMsg={errorMsg} />

        {/* ── Actions ── */}

        {stage === "done" && (
          <div className="flex flex-col gap-3">
            <button
              onClick={handleDownload}
              className="w-full py-3 px-6 font-bold text-sm transition-all"
              style={{
                fontFamily: "'Space Mono', monospace",
                background: "var(--green)",
                color: "#000",
                border: "none",
                cursor: "pointer",
                letterSpacing: "0.05em",
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              DOWNLOAD PROCESSED VIDEO
            </button>
            <button
              onClick={handleReset}
              className="w-full py-3 px-6 text-sm font-medium transition-all"
              style={{
                fontFamily: "'DM Sans', sans-serif",
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-active)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              Process another video
            </button>
          </div>
        )}

        {stage === "error" && (
          <button
            onClick={handleTryAgain}
            className="w-full py-3 px-6 font-bold text-sm transition-all"
            style={{
              fontFamily: "'Space Mono', monospace",
              background: "transparent",
              border: "1px solid var(--red)",
              color: "var(--red)",
              cursor: "pointer",
              letterSpacing: "0.1em",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--red-dim)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            TRY AGAIN
          </button>
        )}

        {stage === "ready" && (
          <button
            onClick={handleProcess}
            className="w-full py-3 px-6 font-bold text-sm transition-all"
            style={{
              fontFamily: "'Space Mono', monospace",
              background: "transparent",
              border: "1px solid var(--green)",
              color: "var(--green)",
              cursor: "pointer",
              letterSpacing: "0.1em",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--green-dim)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            REMOVE DEAD SPACE
          </button>
        )}
      </div>

      <footer
        className="mt-16 text-xs"
        style={{ color: "var(--text-dim)", fontFamily: "'DM Sans', sans-serif" }}
      >
        ClipForge &mdash; built for creators
      </footer>
    </main>
  );
}
