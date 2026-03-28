"use client";

import { useState, useCallback, useRef } from "react";
import DropZone from "@/components/DropZone";
import SettingsPanel from "@/components/SettingsPanel";
import StatusBar from "@/components/StatusBar";
import RespawnPanel, { type RespawnStage, type RespawnStats } from "@/components/RespawnPanel";
import { parseApiError } from "@/lib/api";

const BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

// Dead space removal state machine — exactly these five states:
//   idle       → no file selected
//   ready      → file uploaded, job_id stored, settings visible
//   processing → "Remove Dead Space" clicked, polling /status
//   done       → job finished, download available
//   error      → any fetch failed, errorMsg stored
type Stage = "idle" | "ready" | "processing" | "done" | "error";

const DEFAULT_THRESHOLD = -35;
const DEFAULT_DURATION = 0.5;
const DEFAULT_BLACK_THRESHOLD = 0.1;
const DEFAULT_RESPAWN_MIN_DURATION = 1.5;

export default function Home() {
  // ── Upload / dead space state ──
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [thresholdDb, setThresholdDb] = useState<number>(DEFAULT_THRESHOLD);
  const [minSilenceDuration, setMinSilenceDuration] = useState<number>(DEFAULT_DURATION);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Respawn state ──
  const [respawnEnabled, setRespawnEnabled] = useState(false);
  const [blackThreshold, setBlackThreshold] = useState<number>(DEFAULT_BLACK_THRESHOLD);
  const [respawnMinDuration, setRespawnMinDuration] = useState<number>(DEFAULT_RESPAWN_MIN_DURATION);
  const [respawnStage, setRespawnStage] = useState<RespawnStage>("idle");
  const [respawnStats, setRespawnStats] = useState<RespawnStats | null>(null);
  const [respawnErrorMsg, setRespawnErrorMsg] = useState<string>("");

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // ─────────────────────────────────────────────────────────
  // Dead space handlers
  // ─────────────────────────────────────────────────────────

  // File selected → immediately POST /upload; idle until ready or error
  const handleFileSelect = useCallback(async (f: File) => {
    stopPolling();
    setFile(f);
    setJobId(null);
    setErrorMsg("");
    setStage("idle");
    setIsUploading(true);
    // reset respawn state for the new file
    setRespawnStage("idle");
    setRespawnStats(null);
    setRespawnErrorMsg("");

    try {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch(`${BASE}/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      const { job_id } = await res.json();
      setJobId(job_id);
      setStage("ready");
    } catch (e: unknown) {
      setStage("error");
      setErrorMsg(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    } finally {
      setIsUploading(false);
    }
  }, []);

  // ready → processing
  const handleProcess = async () => {
    if (!jobId) return;
    setStage("processing");
    setErrorMsg("");

    try {
      const res = await fetch(`${BASE}/process/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threshold_db: thresholdDb,
          min_silence_duration: minSilenceDuration,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      // Poll every 2 s: processing → done | error
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${BASE}/status/${jobId}`);
          if (!statusRes.ok) return;
          const { status, error } = await statusRes.json();
          if (status === "done") {
            stopPolling();
            setStage("done");
          } else if (status === "error") {
            stopPolling();
            setStage("error");
            setErrorMsg(error ?? "Something went wrong. Please try again.");
          }
        } catch {
          // network hiccup — keep polling
        }
      }, 2000);
    } catch (e: unknown) {
      stopPolling();
      setStage("error");
      setErrorMsg(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    }
  };

  const handleDownload = () => {
    if (!jobId) return;
    window.open(`${BASE}/download/${jobId}`, "_blank");
  };

  // error → ready (job exists) | idle (upload failed)
  const handleTryAgain = () => {
    stopPolling();
    setErrorMsg("");
    if (jobId) {
      setStage("ready");
    } else {
      setFile(null);
      setStage("idle");
    }
  };

  // done → idle: full reset including settings back to defaults
  const handleReset = () => {
    stopPolling();
    setFile(null);
    setJobId(null);
    setStage("idle");
    setErrorMsg("");
    setThresholdDb(DEFAULT_THRESHOLD);
    setMinSilenceDuration(DEFAULT_DURATION);
    // reset respawn too
    setRespawnStage("idle");
    setRespawnStats(null);
    setRespawnErrorMsg("");
    setBlackThreshold(DEFAULT_BLACK_THRESHOLD);
    setRespawnMinDuration(DEFAULT_RESPAWN_MIN_DURATION);
  };

  // ─────────────────────────────────────────────────────────
  // Respawn handlers
  // ─────────────────────────────────────────────────────────

  const handleRespawnProcess = async () => {
    if (!jobId) return;
    setRespawnStage("processing");
    setRespawnErrorMsg("");
    setRespawnStats(null);

    try {
      const res = await fetch(`${BASE}/process/respawn/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          black_threshold: blackThreshold,
          min_duration: respawnMinDuration,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      const data = await res.json();
      setRespawnStats({
        segments_removed: data.segments_removed,
        time_saved_seconds: data.time_saved_seconds,
      });
      setRespawnStage("done");
    } catch (e: unknown) {
      setRespawnStage("error");
      setRespawnErrorMsg(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    }
  };

  const handleRespawnDownload = () => {
    if (!jobId) return;
    window.open(`${BASE}/download/respawn/${jobId}`, "_blank");
  };

  const handleRespawnRetry = () => {
    setRespawnStage("idle");
    setRespawnErrorMsg("");
    setRespawnStats(null);
  };

  // ─────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────

  const isWorking = isUploading || stage === "processing";
  const showPanels =
    stage === "ready" || stage === "processing" || stage === "done" || stage === "error";

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

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
          isUploading={isUploading}
          onFileSelect={handleFileSelect}
          disabled={isWorking}
        />

        {showPanels && (
          <>
            {/* ── Dead Space Removal card ── */}
            <SettingsPanel
              thresholdDb={thresholdDb}
              onThresholdDbChange={setThresholdDb}
              minSilenceDuration={minSilenceDuration}
              onMinSilenceDurationChange={setMinSilenceDuration}
              disabled={isWorking || stage === "done"}
            />

            <StatusBar stage={stage} errorMsg={errorMsg} />

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
                  className="w-full py-3 px-6 font-bold text-sm transition-all"
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    background: "transparent",
                    border: "1px solid #ffffff",
                    color: "#ffffff",
                    cursor: "pointer",
                    letterSpacing: "0.05em",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = "#ffffff";
                    e.currentTarget.style.color = "#000000";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#ffffff";
                  }}
                >
                  PROCESS ANOTHER VIDEO
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
                  border: "1px solid #ff4444",
                  color: "#ff4444",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "#ff4444";
                  e.currentTarget.style.color = "#ffffff";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#ff4444";
                }}
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

            {/* ── Respawn Wait Remover card ── */}
            <RespawnPanel
              enabled={respawnEnabled}
              onEnabledChange={setRespawnEnabled}
              blackThreshold={blackThreshold}
              onBlackThresholdChange={setBlackThreshold}
              minDuration={respawnMinDuration}
              onMinDurationChange={setRespawnMinDuration}
              stage={respawnStage}
              stats={respawnStats}
              errorMsg={respawnErrorMsg}
              onProcess={handleRespawnProcess}
              onDownload={handleRespawnDownload}
              onRetry={handleRespawnRetry}
              hasJob={jobId !== null}
              disabled={isWorking || respawnStage === "processing"}
            />
          </>
        )}
      </div>

      <footer
        className="mt-16 text-xs text-center"
        style={{ color: "#555555", fontFamily: "'DM Sans', sans-serif" }}
      >
        ClipForge &mdash; built for creators
      </footer>
    </main>
  );
}
