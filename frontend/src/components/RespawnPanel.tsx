"use client";

import { Skull } from "lucide-react";

export type RespawnStage = "idle" | "processing" | "done" | "error";

export interface RespawnStats {
  segments_removed: number;
  time_saved_seconds: number;
}

interface RespawnPanelProps {
  // settings
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  blackThreshold: number;
  onBlackThresholdChange: (v: number) => void;
  minDuration: number;
  onMinDurationChange: (v: number) => void;
  // stage
  stage: RespawnStage;
  stats: RespawnStats | null;
  errorMsg: string;
  // actions
  onProcess: () => void;
  onDownload: () => void;
  onRetry: () => void;
  // context
  hasJob: boolean;    // file has been uploaded; job_id exists
  disabled?: boolean; // globally locked (e.g. main upload in progress)
}

export default function RespawnPanel({
  enabled,
  onEnabledChange,
  blackThreshold,
  onBlackThresholdChange,
  minDuration,
  onMinDurationChange,
  stage,
  stats,
  errorMsg,
  onProcess,
  onDownload,
  onRetry,
  hasJob,
  disabled,
}: RespawnPanelProps) {
  const sliderDisabled = disabled || !enabled || stage === "processing" || stage === "done";
  const showSliders = enabled;
  const showProcess = enabled && hasJob && (stage === "idle" || stage === "error");
  const isProcessing = stage === "processing";

  return (
    <div
      className="flex flex-col gap-5 p-5"
      style={{
        background: "var(--surface)",
        border: `1px solid ${enabled ? "var(--border-active)" : "var(--border)"}`,
        transition: "border-color 0.2s",
      }}
    >
      {/* ── Header row: icon + title + toggle ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skull
            size={15}
            style={{ color: enabled ? "var(--green)" : "var(--text-dim)" }}
            strokeWidth={1.8}
          />
          <span
            className="text-xs tracking-widest"
            style={{
              fontFamily: "'Space Mono', monospace",
              color: enabled ? "var(--text-muted)" : "var(--text-dim)",
            }}
          >
            RESPAWN WAIT REMOVER
          </span>
        </div>

        {/* Toggle switch */}
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => !disabled && onEnabledChange(!enabled)}
          className="relative transition-all"
          style={{
            width: 36,
            height: 20,
            background: enabled ? "var(--green)" : "var(--border)",
            border: "none",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          <span
            className="absolute top-0.5 transition-all"
            style={{
              width: 16,
              height: 16,
              background: enabled ? "#000" : "var(--text-dim)",
              left: enabled ? 18 : 2,
            }}
          />
        </button>
      </div>

      {/* ── Sliders (only when enabled) ── */}
      {showSliders && (
        <div
          className="flex flex-col gap-5"
          style={{ opacity: sliderDisabled ? 0.5 : 1 }}
        >
          {/* Black Frame Sensitivity */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span
                className="text-xs tracking-widest"
                style={{ fontFamily: "'Space Mono', monospace", color: "var(--text-muted)" }}
              >
                BLACK FRAME SENSITIVITY
              </span>
              <span
                className="text-xs font-bold"
                style={{ fontFamily: "'Space Mono', monospace", color: "var(--green)" }}
              >
                {blackThreshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.05}
              max={0.5}
              step={0.01}
              value={blackThreshold}
              disabled={sliderDisabled}
              onChange={e => onBlackThresholdChange(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              Average frame brightness below this value is treated as a black screen.
              Lower = only near-pure-black frames; higher = catches faded screens too.
            </p>
          </div>

          {/* Min duration */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span
                className="text-xs tracking-widest"
                style={{ fontFamily: "'Space Mono', monospace", color: "var(--text-muted)" }}
              >
                MIN DURATION
              </span>
              <span
                className="text-xs font-bold"
                style={{ fontFamily: "'Space Mono', monospace", color: "var(--green)" }}
              >
                {minDuration.toFixed(1)} s
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={5.0}
              step={0.5}
              value={minDuration}
              disabled={sliderDisabled}
              onChange={e => onMinDurationChange(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              Only black+silent segments longer than this will be removed.
            </p>
          </div>
        </div>
      )}

      {/* ── Processing state ── */}
      {isProcessing && (
        <div className="flex flex-col gap-3">
          <div
            className="relative overflow-hidden"
            style={{ height: 2, background: "var(--border)" }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                height: "100%",
                background: "var(--green)",
                animation: "scan 1.8s ease-in-out infinite",
              }}
            />
          </div>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            Extracting frames and analysing brightness — this may take a moment…
          </p>
        </div>
      )}

      {/* ── Done: stats + download ── */}
      {stage === "done" && stats !== null && (
        <div className="flex flex-col gap-3">
          {stats.segments_removed > 0 ? (
            <>
              <div
                className="flex items-center gap-2 px-3 py-2 text-xs"
                style={{
                  background: "var(--green-dim)",
                  border: "1px solid var(--green-border)",
                  fontFamily: "'Space Mono', monospace",
                  color: "var(--green)",
                  letterSpacing: "0.03em",
                }}
              >
                <Skull size={12} strokeWidth={2} />
                <span>
                  Removed {stats.segments_removed} respawn wait
                  {stats.segments_removed !== 1 ? "s" : ""} — saved{" "}
                  {stats.time_saved_seconds}s
                </span>
              </div>
              <button
                onClick={onDownload}
                className="w-full py-3 px-6 font-bold text-sm transition-all"
                style={{
                  fontFamily: "'Space Mono', monospace",
                  background: "transparent",
                  border: "1px solid var(--green)",
                  color: "var(--green)",
                  cursor: "pointer",
                  letterSpacing: "0.05em",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--green-dim)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                DOWNLOAD (RESPAWN REMOVED)
              </button>
            </>
          ) : (
            <p
              className="text-xs text-center py-2"
              style={{ color: "var(--text-dim)", fontFamily: "'Space Mono', monospace" }}
            >
              No respawn waits detected — try lowering the threshold or duration.
            </p>
          )}
        </div>
      )}

      {/* ── Error ── */}
      {stage === "error" && (
        <div
          className="flex gap-3 items-start p-3 text-xs"
          style={{
            background: "var(--red-dim)",
            border: "1px solid var(--red-border)",
          }}
        >
          <span
            style={{
              fontFamily: "'Space Mono', monospace",
              color: "var(--red)",
              letterSpacing: "0.1em",
              flexShrink: 0,
            }}
          >
            ERR
          </span>
          <p style={{ color: "var(--red)" }}>{errorMsg || "Processing failed."}</p>
        </div>
      )}

      {/* ── Process / Retry button ── */}
      {showProcess && (
        <button
          onClick={stage === "error" ? onRetry : onProcess}
          className="w-full py-2.5 px-6 font-bold text-xs transition-all"
          style={{
            fontFamily: "'Space Mono', monospace",
            background: "transparent",
            border: stage === "error" ? "1px solid #ff4444" : "1px solid var(--green)",
            color: stage === "error" ? "#ff4444" : "var(--green)",
            cursor: "pointer",
            letterSpacing: "0.1em",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background =
              stage === "error" ? "#ff4444" : "var(--green-dim)";
            if (stage === "error") e.currentTarget.style.color = "#ffffff";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = stage === "error" ? "#ff4444" : "var(--green)";
          }}
        >
          {stage === "error" ? "TRY AGAIN" : "REMOVE RESPAWN WAITS"}
        </button>
      )}
    </div>
  );
}
