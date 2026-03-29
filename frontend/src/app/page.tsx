"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import DropZone from "@/components/DropZone";
import SettingsPanel from "@/components/SettingsPanel";
import StatusBar from "@/components/StatusBar";
import TopBar from "@/components/TopBar";
import RespawnPanel, { type RespawnStage, type RespawnStats } from "@/components/RespawnPanel";
import HypePanel, { type HypeStage, type HypeMoment } from "@/components/HypePanel";
import PipelinePanel, {
  type PipelineStage,
  type PipelineSummary,
} from "@/components/PipelinePanel";
import { parseApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";

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
const DEFAULT_AUDIO_SENSITIVITY = 0.7;
const DEFAULT_MOTION_SENSITIVITY = 0.6;
const DEFAULT_MIN_GAP = 3.0;
const DEFAULT_PIPELINE_DEAD_SPACE_ENABLED = true;
const DEFAULT_PIPELINE_RESPAWN_ENABLED = true;
const DEFAULT_PIPELINE_HYPE_ENABLED = true;

export default function Home() {
  const router = useRouter();

  // ── Auth state ──
  const [userEmail, setUserEmail] = useState<string>("");
  const [isAuthChecked, setIsAuthChecked] = useState(false);

  useEffect(() => {
    // Check session on mount; redirect to /auth if unauthenticated
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/auth");
      } else {
        setUserEmail(session.user.email ?? "");
        setIsAuthChecked(true);
      }
    });

    // Listen for future auth changes (sign-out in another tab, token expiry, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          router.push("/auth");
        } else {
          setUserEmail(session.user.email ?? "");
        }
      }
    );
    return () => subscription.unsubscribe();
  }, [router]);

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

  // ── Pipeline state ──
  const [pipelineMode, setPipelineMode] = useState(false);
  const [pipelineDeadSpaceEnabled, setPipelineDeadSpaceEnabled] = useState(DEFAULT_PIPELINE_DEAD_SPACE_ENABLED);
  const [pipelineRespawnEnabled, setPipelineRespawnEnabled] = useState(DEFAULT_PIPELINE_RESPAWN_ENABLED);
  const [pipelineHypeEnabled, setPipelineHypeEnabled] = useState(DEFAULT_PIPELINE_HYPE_ENABLED);
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [pipelineCurrentStep, setPipelineCurrentStep] = useState<string | null>(null);
  const [pipelineStepsCompleted, setPipelineStepsCompleted] = useState<string[]>([]);
  const [pipelinePercent, setPipelinePercent] = useState(0);
  const [pipelineSummary, setPipelineSummary] = useState<PipelineSummary | null>(null);
  const [pipelineErrorMsg, setPipelineErrorMsg] = useState<string>("");
  const [pipelineHasVideoOutput, setPipelineHasVideoOutput] = useState(false);
  const pipelinePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Hype state ──
  const [hypeEnabled, setHypeEnabled] = useState(false);
  const [audioSensitivity, setAudioSensitivity] = useState<number>(DEFAULT_AUDIO_SENSITIVITY);
  const [motionSensitivity, setMotionSensitivity] = useState<number>(DEFAULT_MOTION_SENSITIVITY);
  const [minGapSeconds, setMinGapSeconds] = useState<number>(DEFAULT_MIN_GAP);
  const [hypeStage, setHypeStage] = useState<HypeStage>("idle");
  const [hypeMoments, setHypeMoments] = useState<HypeMoment[]>([]);
  const [hypeErrorMsg, setHypeErrorMsg] = useState<string>("");

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const stopPipelinePolling = () => {
    if (pipelinePollRef.current) {
      clearInterval(pipelinePollRef.current);
      pipelinePollRef.current = null;
    }
  };

  // Returns headers with Authorization token (and optionally Content-Type: application/json).
  // Calls getSession() each time so a refreshed token is always used.
  const getHeaders = async (json = true): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    const h: Record<string, string> = {};
    if (json) h["Content-Type"] = "application/json";
    if (session?.access_token) h["Authorization"] = `Bearer ${session.access_token}`;
    return h;
  };

  // Download a protected URL as a blob and trigger the browser save dialog.
  const downloadAuthed = async (url: string, fallbackFilename: string): Promise<void> => {
    const headers = await getHeaders(false);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(await parseApiError(res));
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition");
    const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallbackFilename;
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/auth");
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
    // reset hype state for the new file
    setHypeStage("idle");
    setHypeMoments([]);
    setHypeErrorMsg("");
    // reset pipeline state for the new file
    stopPipelinePolling();
    setPipelineStage("idle");
    setPipelineCurrentStep(null);
    setPipelineStepsCompleted([]);
    setPipelinePercent(0);
    setPipelineSummary(null);
    setPipelineHasVideoOutput(false);
    setPipelineErrorMsg("");

    try {
      const formData = new FormData();
      formData.append("file", f);
      // No Content-Type — browser sets multipart boundary automatically
      const uploadHeaders = await getHeaders(false);
      const res = await fetch(`${BASE}/upload`, {
        method: "POST",
        headers: uploadHeaders,
        body: formData,
      });
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
        headers: await getHeaders(),
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
          const statusHeaders = await getHeaders(false);
          const statusRes = await fetch(`${BASE}/status/${jobId}`, { headers: statusHeaders });
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

  const handleDownload = async () => {
    if (!jobId) return;
    await downloadAuthed(`${BASE}/download/${jobId}`, "video_clipped.mp4");
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
    // reset hype too
    setHypeEnabled(false);
    setHypeStage("idle");
    setHypeMoments([]);
    setHypeErrorMsg("");
    setAudioSensitivity(DEFAULT_AUDIO_SENSITIVITY);
    setMotionSensitivity(DEFAULT_MOTION_SENSITIVITY);
    setMinGapSeconds(DEFAULT_MIN_GAP);
    // reset pipeline too
    stopPipelinePolling();
    setPipelineMode(false);
    setPipelineDeadSpaceEnabled(DEFAULT_PIPELINE_DEAD_SPACE_ENABLED);
    setPipelineRespawnEnabled(DEFAULT_PIPELINE_RESPAWN_ENABLED);
    setPipelineHypeEnabled(DEFAULT_PIPELINE_HYPE_ENABLED);
    setPipelineStage("idle");
    setPipelineCurrentStep(null);
    setPipelineStepsCompleted([]);
    setPipelinePercent(0);
    setPipelineSummary(null);
    setPipelineHasVideoOutput(false);
    setPipelineErrorMsg("");
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
        headers: await getHeaders(),
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

  const handleRespawnDownload = async () => {
    if (!jobId) return;
    await downloadAuthed(`${BASE}/download/respawn/${jobId}`, "video_respawn_removed.mp4");
  };

  const handleRespawnRetry = () => {
    setRespawnStage("idle");
    setRespawnErrorMsg("");
    setRespawnStats(null);
  };

  // ─────────────────────────────────────────────────────────
  // Hype handlers
  // ─────────────────────────────────────────────────────────

  const handleHypeAnalyze = async () => {
    if (!jobId) return;
    setHypeStage("analyzing");
    setHypeErrorMsg("");
    setHypeMoments([]);

    try {
      const res = await fetch(`${BASE}/analyze/hype/${jobId}`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({
          audio_sensitivity: audioSensitivity,
          motion_sensitivity: motionSensitivity,
          min_gap_seconds: minGapSeconds,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      const data = await res.json();
      setHypeMoments(data.moments ?? []);
      setHypeStage("done");
    } catch (e: unknown) {
      setHypeStage("error");
      setHypeErrorMsg(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    }
  };

  const handleHypeExport = async () => {
    if (!jobId) return;
    try {
      await downloadAuthed(`${BASE}/analyze/hype/${jobId}/export`, "hype_markers.xml");
    } catch {
      // silent — export failure doesn't change stage
    }
  };

  const handleHypeRetry = () => {
    setHypeStage("idle");
    setHypeErrorMsg("");
    setHypeMoments([]);
  };

  // ─────────────────────────────────────────────────────────
  // Pipeline handlers
  // ─────────────────────────────────────────────────────────

  const handlePipelineRun = async () => {
    if (!jobId) return;
    stopPipelinePolling();
    setPipelineStage("running");
    setPipelineErrorMsg("");
    setPipelineCurrentStep(null);
    setPipelineStepsCompleted([]);
    setPipelinePercent(0);
    setPipelineSummary(null);
    setPipelineHasVideoOutput(false);

    try {
      const res = await fetch(`${BASE}/process/pipeline/${jobId}`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({
          dead_space: {
            enabled: pipelineDeadSpaceEnabled,
            threshold_db: thresholdDb,
            min_silence_duration: minSilenceDuration,
          },
          respawn_removal: {
            enabled: pipelineRespawnEnabled,
            black_threshold: blackThreshold,
            min_duration: respawnMinDuration,
          },
          hype_detection: {
            enabled: pipelineHypeEnabled,
            audio_sensitivity: audioSensitivity,
            motion_sensitivity: motionSensitivity,
            min_gap_seconds: minGapSeconds,
          },
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));

      // Poll pipeline status every 2s
      pipelinePollRef.current = setInterval(async () => {
        try {
          const pipelineStatusHeaders = await getHeaders(false);
          const statusRes = await fetch(`${BASE}/status/${jobId}/pipeline`, {
            headers: pipelineStatusHeaders,
          });
          if (!statusRes.ok) return;
          const data = await statusRes.json();
          setPipelineCurrentStep(data.current_step ?? null);
          setPipelineStepsCompleted(data.steps_completed ?? []);
          setPipelinePercent(data.percent ?? 0);
          if (data.status === "done") {
            stopPipelinePolling();
            setPipelineStage("done");
            setPipelineSummary(data.summary ?? null);
            setPipelineHasVideoOutput(data.has_video_output ?? false);
          } else if (data.status === "error") {
            stopPipelinePolling();
            setPipelineStage("error");
            setPipelineErrorMsg(
              data.error ?? "Pipeline failed. Try adjusting your settings and running again."
            );
          }
        } catch {
          // network hiccup — keep polling
        }
      }, 2000);
    } catch (e: unknown) {
      stopPipelinePolling();
      setPipelineStage("error");
      setPipelineErrorMsg(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    }
  };

  const handlePipelineDownload = async () => {
    if (!jobId) return;
    await downloadAuthed(`${BASE}/download/pipeline/${jobId}`, "video_pipeline.mp4");
  };

  const handlePipelineExportHype = async () => {
    if (!jobId) return;
    try {
      await downloadAuthed(`${BASE}/download/pipeline/${jobId}/hype`, "hype_markers.xml");
    } catch {
      // silent — export failure is non-critical
    }
  };

  const handlePipelineRetry = () => {
    stopPipelinePolling();
    setPipelineStage("idle");
    setPipelineCurrentStep(null);
    setPipelineStepsCompleted([]);
    setPipelinePercent(0);
    setPipelineSummary(null);
    setPipelineHasVideoOutput(false);
    setPipelineErrorMsg("");
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

  // Don't render until auth is confirmed — prevents flash of unauthenticated UI
  if (!isAuthChecked) return null;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <TopBar userEmail={userEmail} onSignOut={handleSignOut} />

      <main className="flex flex-col items-center px-4 pt-10 pb-16">
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
            {/* ── Full Pipeline card (always visible when panels are shown) ── */}
            <PipelinePanel
              pipelineMode={pipelineMode}
              onPipelineModeChange={(v) => {
                setPipelineMode(v);
                if (!v) stopPipelinePolling();
              }}
              deadSpaceEnabled={pipelineDeadSpaceEnabled}
              onDeadSpaceEnabledChange={setPipelineDeadSpaceEnabled}
              respawnEnabled={pipelineRespawnEnabled}
              onRespawnEnabledChange={setPipelineRespawnEnabled}
              hypeEnabled={pipelineHypeEnabled}
              onHypeEnabledChange={setPipelineHypeEnabled}
              thresholdDb={thresholdDb}
              onThresholdDbChange={setThresholdDb}
              minSilenceDuration={minSilenceDuration}
              onMinSilenceDurationChange={setMinSilenceDuration}
              blackThreshold={blackThreshold}
              onBlackThresholdChange={setBlackThreshold}
              respawnMinDuration={respawnMinDuration}
              onRespawnMinDurationChange={setRespawnMinDuration}
              audioSensitivity={audioSensitivity}
              onAudioSensitivityChange={setAudioSensitivity}
              motionSensitivity={motionSensitivity}
              onMotionSensitivityChange={setMotionSensitivity}
              minGapSeconds={minGapSeconds}
              onMinGapSecondsChange={setMinGapSeconds}
              stage={pipelineStage}
              currentStep={pipelineCurrentStep}
              stepsCompleted={pipelineStepsCompleted}
              percent={pipelinePercent}
              summary={pipelineSummary}
              errorMsg={pipelineErrorMsg}
              hasVideoOutput={pipelineHasVideoOutput}
              onRun={handlePipelineRun}
              onDownload={handlePipelineDownload}
              onExportHype={handlePipelineExportHype}
              onRetry={handlePipelineRetry}
              hasJob={jobId !== null}
              disabled={isWorking}
            />

            {/* ── Individual feature panels (hidden when pipeline mode is on) ── */}
            {!pipelineMode && (
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

            {/* ── Hype Moment Detector card ── */}
            <HypePanel
              enabled={hypeEnabled}
              onEnabledChange={setHypeEnabled}
              audioSensitivity={audioSensitivity}
              onAudioSensitivityChange={setAudioSensitivity}
              motionSensitivity={motionSensitivity}
              onMotionSensitivityChange={setMotionSensitivity}
              minGapSeconds={minGapSeconds}
              onMinGapSecondsChange={setMinGapSeconds}
              stage={hypeStage}
              moments={hypeMoments}
              errorMsg={hypeErrorMsg}
              onAnalyze={handleHypeAnalyze}
              onExport={handleHypeExport}
              onRetry={handleHypeRetry}
              hasJob={jobId !== null}
              disabled={isWorking || hypeStage === "analyzing"}
            />
              </>
            )}
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
    </div>
  );
}
