"use client";

import { Zap } from "lucide-react";

export type HypeStage = "idle" | "analyzing" | "done" | "error";

export interface HypeMoment {
  timestamp: number;
  score: number;
  label: string;
}

interface HypePanelProps {
  // settings
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  audioSensitivity: number;
  onAudioSensitivityChange: (v: number) => void;
  motionSensitivity: number;
  onMotionSensitivityChange: (v: number) => void;
  minGapSeconds: number;
  onMinGapSecondsChange: (v: number) => void;
  // stage
  stage: HypeStage;
  moments: HypeMoment[];
  errorMsg: string;
  // actions
  onAnalyze: () => void;
  onExport: () => void;
  onRetry: () => void;
  // context
  hasJob: boolean;
  disabled?: boolean;
}

/** Format seconds as MM:SS */
function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/** 8-segment volume-style score meter */
function ScoreBar({ score }: { score: number }) {
  const SEGMENTS = 8;
  const filled = Math.round(score * SEGMENTS);
  return (
    <div className="flex gap-px" style={{ flexShrink: 0 }}>
      {Array.from({ length: SEGMENTS }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: 14,
            background: i < filled ? "var(--green)" : "var(--border)",
          }}
        />
      ))}
    </div>
  );
}

export default function HypePanel({
  enabled,
  onEnabledChange,
  audioSensitivity,
  onAudioSensitivityChange,
  motionSensitivity,
  onMotionSensitivityChange,
  minGapSeconds,
  onMinGapSecondsChange,
  stage,
  moments,
  errorMsg,
  onAnalyze,
  onExport,
  onRetry,
  hasJob,
  disabled,
}: HypePanelProps) {
  const sliderDisabled = disabled || !enabled || stage === "analyzing" || stage === "done";
  const showAnalyze = enabled && hasJob && (stage === "idle" || stage === "error");
  const isAnalyzing = stage === "analyzing";

  return (
    <div
      className="flex flex-col gap-5 p-5"
      style={{
        background: "var(--surface)",
        border: `1px solid ${enabled ? "var(--border-active)" : "var(--border)"}`,
        transition: "border-color 0.2s",
      }}
    >
      {/* ── Header: icon + title + toggle ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap
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
            HYPE MOMENT DETECTOR
          </span>
        </div>

        {/* Square toggle */}
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => !disabled && onEnabledChange(!enabled)}
          style={{
            position: "relative",
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
            style={{
              position: "absolute",
              top: 2,
              left: enabled ? 18 : 2,
              width: 16,
              height: 16,
              background: enabled ? "#000" : "var(--text-dim)",
              transition: "left 0.15s",
            }}
          />
        </button>
      </div>

      {/* ── Sliders ── */}
      {enabled && (
        <div
          className="flex flex-col gap-5"
          style={{ opacity: sliderDisabled ? 0.5 : 1 }}
        >
          <SliderRow
            label="AUDIO SENSITIVITY"
            value={audioSensitivity.toFixed(1)}
            hint="Normalised RMS energy threshold. Higher = only very loud moments are flagged."
            disabled={sliderDisabled}
          >
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={audioSensitivity}
              disabled={sliderDisabled}
              onChange={e => onAudioSensitivityChange(Number(e.target.value))}
              className="w-full"
            />
          </SliderRow>

          <SliderRow
            label="MOTION SENSITIVITY"
            value={motionSensitivity.toFixed(1)}
            hint="Normalised frame-difference threshold. Higher = only rapid movement is flagged."
            disabled={sliderDisabled}
          >
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={motionSensitivity}
              disabled={sliderDisabled}
              onChange={e => onMotionSensitivityChange(Number(e.target.value))}
              className="w-full"
            />
          </SliderRow>

          <SliderRow
            label="MIN GAP BETWEEN MOMENTS"
            value={`${minGapSeconds.toFixed(0)} s`}
            hint="Events closer than this are merged into a single hype moment."
            disabled={sliderDisabled}
          >
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={minGapSeconds}
              disabled={sliderDisabled}
              onChange={e => onMinGapSecondsChange(Number(e.target.value))}
              className="w-full"
            />
          </SliderRow>
        </div>
      )}

      {/* ── Analyzing ── */}
      {isAnalyzing && (
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
            Extracting audio and frames — analysing energy and motion…
          </p>
        </div>
      )}

      {/* ── Results ── */}
      {stage === "done" && (
        <div className="flex flex-col gap-3">
          {moments.length > 0 ? (
            <>
              {/* Scrollable moment list */}
              <div
                className="overflow-y-auto flex flex-col"
                style={{
                  maxHeight: 224,
                  border: "1px solid var(--border)",
                }}
              >
                {moments.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-2"
                    style={{
                      borderBottom:
                        i < moments.length - 1
                          ? "1px solid var(--border)"
                          : "none",
                    }}
                  >
                    {/* Timestamp */}
                    <span
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 12,
                        color: "var(--green)",
                        width: 38,
                        flexShrink: 0,
                      }}
                    >
                      {fmt(m.timestamp)}
                    </span>

                    {/* Score bar */}
                    <div className="flex-1 flex items-center">
                      <ScoreBar score={m.score} />
                    </div>

                    {/* Label */}
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--text-dim)",
                        fontFamily: "'Space Mono', monospace",
                        letterSpacing: "0.05em",
                        flexShrink: 0,
                      }}
                    >
                      {m.label.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>

              {/* Stats line */}
              <p
                className="text-xs"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "'Space Mono', monospace",
                }}
              >
                {moments.length} moment{moments.length !== 1 ? "s" : ""} detected
              </p>

              {/* Export button */}
              <button
                onClick={onExport}
                className="w-full py-2.5 px-6 font-bold text-xs transition-all"
                style={{
                  fontFamily: "'Space Mono', monospace",
                  background: "transparent",
                  border: "1px solid var(--green)",
                  color: "var(--green)",
                  cursor: "pointer",
                  letterSpacing: "0.05em",
                }}
                onMouseEnter={e =>
                  (e.currentTarget.style.background = "var(--green-dim)")
                }
                onMouseLeave={e =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                EXPORT MARKERS (CAPCUT XML)
              </button>
            </>
          ) : (
            <p
              className="text-xs text-center py-2"
              style={{
                color: "var(--text-dim)",
                fontFamily: "'Space Mono', monospace",
              }}
            >
              No hype moments detected — try lowering the sensitivity.
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
          <p style={{ color: "var(--red)" }}>{errorMsg || "Analysis failed."}</p>
        </div>
      )}

      {/* ── Analyze / Retry button ── */}
      {showAnalyze && (
        <button
          onClick={stage === "error" ? onRetry : onAnalyze}
          className="w-full py-2.5 px-6 font-bold text-xs transition-all"
          style={{
            fontFamily: "'Space Mono', monospace",
            background: "transparent",
            border:
              stage === "error" ? "1px solid #ff4444" : "1px solid var(--green)",
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
            e.currentTarget.style.color =
              stage === "error" ? "#ff4444" : "var(--green)";
          }}
        >
          {stage === "error" ? "TRY AGAIN" : "DETECT HYPE MOMENTS"}
        </button>
      )}
    </div>
  );
}

function SliderRow({
  label,
  value,
  hint,
  disabled,
  children,
}: {
  label: string;
  value: string;
  hint: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span
          className="text-xs tracking-widest"
          style={{
            fontFamily: "'Space Mono', monospace",
            color: "var(--text-muted)",
          }}
        >
          {label}
        </span>
        <span
          className="text-xs font-bold"
          style={{
            fontFamily: "'Space Mono', monospace",
            color: "var(--green)",
          }}
        >
          {value}
        </span>
      </div>
      {children}
      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
        {hint}
      </p>
    </div>
  );
}
