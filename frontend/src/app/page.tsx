"use client";

import { useState, useCallback, useRef } from "react";
import DropZone from "@/components/DropZone";
import SettingsPanel from "@/components/SettingsPanel";
import StatusBar from "@/components/StatusBar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// idle      — nothing selected
// uploading — file selected, POST /upload in flight
// ready     — upload done, settings visible, waiting for user to hit Process
// processing — POST /process sent, polling /status
// done      — job finished
// error     — something went wrong
type Stage = "idle" | "uploading" | "ready" | "processing" | "done" | "error";

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

  // Called by DropZone when a file is selected — immediately upload
  const handleFileSelect = useCallback(async (f: File) => {
    setFile(f);
    setJobId(null);
    setErrorMsg("");
    setStage("uploading");

    try {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch(`${API}/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail ?? "Upload failed");
      }
      const { job_id } = await res.json();
      setJobId(job_id);
      setStage("ready");
    } catch (e: unknown) {
      setStage("error");
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
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
        const err = await res.json().catch(() => ({ detail: "Processing failed" }));
        throw new Error(err.detail ?? "Processing failed");
      }

      // Poll status every 2 seconds
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API}/status/${jobId}`);
          if (!statusRes.ok) return;
          const { status, error } = await statusRes.json();
          if (status === "done") {
            stopPolling();
            setStage("done");
          } else if (status === "error") {
            stopPolling();
            setStage("error");
            setErrorMsg(error ?? "Unknown processing error");
          }
        } catch {
          // transient network error — keep polling
        }
      }, 2000);
    } catch (e: unknown) {
      stopPolling();
      setStage("error");
      setErrorMsg(e instanceof Error ? e.message : "Unexpected error");
    }
  };

  const handleDownload = () => {
    if (!jobId) return;
    window.open(`${API}/download/${jobId}`, "_blank");
  };

  const handleReset = () => {
    stopPolling();
    setFile(null);
    setJobId(null);
    setStage("idle");
    setErrorMsg("");
  };

  const isWorking = stage === "uploading" || stage === "processing";

  return (
    <main
      className="min-h-screen flex flex-col items-center px-4 py-16"
      style={{ background: "var(--bg)" }}
    >
      {/* Header */}
      <header className="mb-12 text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          {/* Scissors icon */}
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
        <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "'DM Sans', sans-serif" }}>
          Remove dead space &amp; silence from your videos automatically
        </p>
      </header>

      {/* Main card */}
      <div
        className="w-full flex flex-col gap-6"
        style={{ maxWidth: 680 }}
      >
        {/* Drop zone — always visible */}
        <DropZone
          file={file}
          stage={stage}
          onFileSelect={handleFileSelect}
          disabled={isWorking}
        />

        {/* Settings — only after a file is uploaded */}
        {(stage === "ready" || stage === "processing" || stage === "done" || stage === "error") && (
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

        {/* Action buttons */}
        {stage === "done" ? (
          <div className="flex gap-3">
            <button
              onClick={handleDownload}
              className="flex-1 py-3 px-6 font-semibold text-sm transition-all"
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
              className="py-3 px-5 text-sm font-medium transition-all"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-active)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              Start over
            </button>
          </div>
        ) : stage === "ready" || (stage === "error" && jobId) ? (
          <button
            onClick={handleProcess}
            disabled={isWorking}
            className="w-full py-3 px-6 font-bold text-sm tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              fontFamily: "'Space Mono', monospace",
              background: "transparent",
              border: "1px solid var(--green)",
              color: "var(--green)",
              cursor: "pointer",
              letterSpacing: "0.1em",
            }}
            onMouseEnter={e => {
              if (!isWorking) {
                e.currentTarget.style.background = "var(--green-dim)";
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            REMOVE DEAD SPACE
          </button>
        ) : null}
      </div>

      <footer
        className="mt-16 text-xs"
        style={{ color: "var(--text-dim)", fontFamily: "'Space Mono', monospace" }}
      >
        CLIPFORGE / PHASE 0
      </footer>
    </main>
  );
}
