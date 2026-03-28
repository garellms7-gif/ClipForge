"use client";

import { useState, useCallback, useRef } from "react";
import DropZone from "@/components/DropZone";
import SettingsPanel from "@/components/SettingsPanel";
import StatusBar from "@/components/StatusBar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Stage = "idle" | "uploading" | "processing" | "done" | "error";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [silenceThreshold, setSilenceThreshold] = useState<number>(-30);
  const [minSilenceDuration, setMinSilenceDuration] = useState<number>(0.5);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleFileSelect = useCallback((f: File) => {
    setFile(f);
    setJobId(null);
    setStage("idle");
    setErrorMsg("");
  }, []);

  const handleProcess = async () => {
    if (!file) return;

    setStage("uploading");
    setErrorMsg("");

    try {
      // 1. Upload
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch(`${API}/upload`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail ?? "Upload failed");
      }
      const { job_id } = await uploadRes.json();
      setJobId(job_id);

      // 2. Kick off processing
      setStage("processing");
      const processForm = new FormData();
      processForm.append("job_id", job_id);
      processForm.append("silence_threshold", String(silenceThreshold));
      processForm.append("min_silence_duration", String(minSilenceDuration));

      const processRes = await fetch(`${API}/process`, {
        method: "POST",
        body: processForm,
      });
      if (!processRes.ok) {
        const err = await processRes.json().catch(() => ({ detail: "Processing failed" }));
        throw new Error(err.detail ?? "Processing failed");
      }

      // 3. Poll for completion
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API}/status/${job_id}`);
          if (!statusRes.ok) return;
          const { status, error } = await statusRes.json();
          if (status === "done") {
            stopPolling();
            setStage("done");
          } else if (status === "error") {
            stopPolling();
            setStage("error");
            setErrorMsg(error ?? "Unknown error");
          }
        } catch {
          // network hiccup — keep polling
        }
      }, 1500);
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

  const canProcess = file && stage === "idle";
  const isWorking = stage === "uploading" || stage === "processing";

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-16"
      style={{ background: "var(--background)" }}>
      {/* Header */}
      <header className="mb-12 text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#7c3aed" />
            <path d="M10 22V10l14 6-14 6z" fill="white" />
            <rect x="22" y="10" width="2.5" height="12" rx="1" fill="white" />
          </svg>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            ClipForge
          </h1>
        </div>
        <p className="text-sm text-gray-400">
          Automatically remove dead space &amp; silence from your videos
        </p>
      </header>

      {/* Card */}
      <div
        className="w-full max-w-2xl rounded-2xl p-8 flex flex-col gap-8"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        {/* Drop zone */}
        <DropZone file={file} onFileSelect={handleFileSelect} disabled={isWorking} />

        {/* Settings */}
        <SettingsPanel
          silenceThreshold={silenceThreshold}
          onSilenceThresholdChange={setSilenceThreshold}
          minSilenceDuration={minSilenceDuration}
          onMinSilenceDurationChange={setMinSilenceDuration}
          disabled={isWorking}
        />

        {/* Status bar */}
        <StatusBar stage={stage} errorMsg={errorMsg} />

        {/* Actions */}
        <div className="flex gap-3">
          {stage === "done" ? (
            <>
              <button
                onClick={handleDownload}
                className="flex-1 py-3 px-6 rounded-xl font-semibold text-white transition-colors"
                style={{ background: "#7c3aed" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#6d28d9")}
                onMouseLeave={e => (e.currentTarget.style.background = "#7c3aed")}
              >
                Download Processed Video
              </button>
              <button
                onClick={handleReset}
                className="py-3 px-5 rounded-xl font-medium transition-colors"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "#a0a0b8",
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#e2e2f0")}
                onMouseLeave={e => (e.currentTarget.style.color = "#a0a0b8")}
              >
                Start Over
              </button>
            </>
          ) : (
            <button
              onClick={canProcess ? handleProcess : undefined}
              disabled={!canProcess || isWorking}
              className="flex-1 py-3 px-6 rounded-xl font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: canProcess && !isWorking ? "#7c3aed" : "#4b4b6b",
                cursor: canProcess && !isWorking ? "pointer" : "not-allowed",
              }}
              onMouseEnter={e => {
                if (canProcess && !isWorking)
                  e.currentTarget.style.background = "#6d28d9";
              }}
              onMouseLeave={e => {
                if (canProcess && !isWorking)
                  e.currentTarget.style.background = "#7c3aed";
              }}
            >
              {isWorking ? "Processing…" : "Process Video"}
            </button>
          )}
        </div>
      </div>

      <footer className="mt-10 text-xs text-gray-600">
        ClipForge &mdash; Phase 0
      </footer>
    </main>
  );
}
