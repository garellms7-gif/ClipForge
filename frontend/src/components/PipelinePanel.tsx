"use client";

import { Zap, Skull, Scissors, Check, Loader2, Circle } from "lucide-react";

export type PipelineStage = "idle" | "running" | "done" | "error";

export interface PipelineSummary {
  dead_space_removed_seconds: number;
  respawn_waits_removed: number;
  hype_moments_found: number;
}

const STEP_LABELS: Record<string, string> = {
  dead_space: "Dead Space Removal",
  respawn_removal: "Respawn Wait Removal",
  hype_detection: "Hype Moment Detection",
};

// ─── Shared slider row ────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
  disabled: boolean;
}

function SliderRow({ label, value, min, max, step, display, onChange, disabled }: SliderRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 10,
          color: "var(--text-dim)",
          minWidth: 132,
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1 }}
      />
      <span
        style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 11,
          color: "var(--text-muted)",
          minWidth: 52,
          textAlign: "right",
        }}
      >
        {display}
      </span>
    </div>
  );
}

// ─── Compact feature section ──────────────────────────────────────────────────

interface FeatureSectionProps {
  icon: React.ReactNode;
  title: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  disabled: boolean;
  children: React.ReactNode;
}

function FeatureSection({
  icon,
  title,
  enabled,
  onEnabledChange,
  disabled,
  children,
}: FeatureSectionProps) {
  return (
    <div
      style={{
        border: `1px solid ${enabled ? "var(--border-active)" : "var(--border)"}`,
        background: enabled ? "var(--green-dim)" : "transparent",
        padding: "10px 14px",
        transition: "all 0.15s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: enabled ? 10 : 0,
        }}
      >
        {/* square checkbox toggle */}
        <button
          onClick={() => onEnabledChange(!enabled)}
          disabled={disabled}
          aria-label={`Toggle ${title}`}
          style={{
            width: 18,
            height: 18,
            border: `1px solid ${enabled ? "var(--green)" : "var(--border)"}`,
            background: enabled ? "var(--green)" : "transparent",
            cursor: disabled ? "not-allowed" : "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          {enabled && (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <polyline
                points="1.5,5 4,7.5 8.5,2.5"
                stroke="#000"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <span style={{ color: enabled ? "var(--green)" : "var(--text-dim)", lineHeight: 0 }}>
          {icon}
        </span>
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 11,
            letterSpacing: "0.1em",
            color: enabled ? "var(--text)" : "var(--text-dim)",
          }}
        >
          {title}
        </span>
      </div>

      {enabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
      )}
    </div>
  );
}

// ─── Step progress row ────────────────────────────────────────────────────────

function StepRow({
  stepKey,
  isCompleted,
  isCurrent,
}: {
  stepKey: string;
  isCompleted: boolean;
  isCurrent: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "3px 0" }}>
      <span
        style={{
          width: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isCompleted ? (
          <Check size={12} style={{ color: "var(--green)" }} />
        ) : isCurrent ? (
          <Loader2
            size={12}
            style={{ color: "var(--green)", animation: "spin 1s linear infinite" }}
          />
        ) : (
          <Circle size={10} style={{ color: "var(--text-dim)" }} />
        )}
      </span>
      <span
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 13,
          color: isCompleted ? "var(--green)" : isCurrent ? "var(--text)" : "var(--text-dim)",
        }}
      >
        {STEP_LABELS[stepKey] ?? stepKey}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface PipelinePanelProps {
  pipelineMode: boolean;
  onPipelineModeChange: (v: boolean) => void;

  // Per-feature enabled (pipeline-specific)
  deadSpaceEnabled: boolean;
  onDeadSpaceEnabledChange: (v: boolean) => void;
  respawnEnabled: boolean;
  onRespawnEnabledChange: (v: boolean) => void;
  hypeEnabled: boolean;
  onHypeEnabledChange: (v: boolean) => void;

  // Shared settings values (same sliders used by individual panels)
  thresholdDb: number;
  onThresholdDbChange: (v: number) => void;
  minSilenceDuration: number;
  onMinSilenceDurationChange: (v: number) => void;
  blackThreshold: number;
  onBlackThresholdChange: (v: number) => void;
  respawnMinDuration: number;
  onRespawnMinDurationChange: (v: number) => void;
  audioSensitivity: number;
  onAudioSensitivityChange: (v: number) => void;
  motionSensitivity: number;
  onMotionSensitivityChange: (v: number) => void;
  minGapSeconds: number;
  onMinGapSecondsChange: (v: number) => void;

  // Execution state
  stage: PipelineStage;
  currentStep: string | null;
  stepsCompleted: string[];
  percent: number;
  summary: PipelineSummary | null;
  errorMsg: string;
  hasVideoOutput: boolean;

  // Actions
  onRun: () => void;
  onDownload: () => void;
  onExportHype: () => void;
  onRetry: () => void;
  hasJob: boolean;
  disabled: boolean;
}

export default function PipelinePanel({
  pipelineMode,
  onPipelineModeChange,
  deadSpaceEnabled,
  onDeadSpaceEnabledChange,
  respawnEnabled,
  onRespawnEnabledChange,
  hypeEnabled,
  onHypeEnabledChange,
  thresholdDb,
  onThresholdDbChange,
  minSilenceDuration,
  onMinSilenceDurationChange,
  blackThreshold,
  onBlackThresholdChange,
  respawnMinDuration,
  onRespawnMinDurationChange,
  audioSensitivity,
  onAudioSensitivityChange,
  motionSensitivity,
  onMotionSensitivityChange,
  minGapSeconds,
  onMinGapSecondsChange,
  stage,
  currentStep,
  stepsCompleted,
  percent,
  summary,
  errorMsg,
  hasVideoOutput,
  onRun,
  onDownload,
  onExportHype,
  onRetry,
  hasJob,
  disabled,
}: PipelinePanelProps) {
  const orderedSteps = [
    ...(deadSpaceEnabled ? ["dead_space"] : []),
    ...(respawnEnabled ? ["respawn_removal"] : []),
    ...(hypeEnabled ? ["hype_detection"] : []),
  ];

  const isRunning = stage === "running";
  const isDone = stage === "done";
  const isError = stage === "error";
  const noneEnabled = orderedSteps.length === 0;
  // disable controls while running, after done (result is final), or parent disabled
  const ctrlDisabled = disabled || isRunning || isDone;

  const canRun = hasJob && !noneEnabled && !disabled;

  return (
    <div
      style={{
        border: `1px solid ${pipelineMode ? "var(--border-active)" : "var(--border)"}`,
        background: pipelineMode ? "var(--surface)" : "var(--surface)",
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* ── Header with toggle ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* square toggle */}
        <button
          onClick={() => onPipelineModeChange(!pipelineMode)}
          disabled={disabled || isRunning}
          aria-label="Toggle Full Pipeline mode"
          style={{
            width: 18,
            height: 18,
            border: `1px solid ${pipelineMode ? "var(--green)" : "var(--border)"}`,
            background: pipelineMode ? "var(--green)" : "transparent",
            cursor: disabled || isRunning ? "not-allowed" : "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          {pipelineMode && (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <polyline
                points="1.5,5 4,7.5 8.5,2.5"
                stroke="#000"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <Zap size={13} style={{ color: pipelineMode ? "var(--green)" : "var(--text-dim)", flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 12,
            letterSpacing: "0.15em",
            color: pipelineMode ? "var(--text)" : "var(--text-dim)",
            flex: 1,
          }}
        >
          FULL PIPELINE
        </span>
        {pipelineMode && (
          <span
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            runs all steps in sequence
          </span>
        )}
      </div>

      {/* Collapsed when pipeline mode is off */}
      {!pipelineMode && (
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            color: "var(--text-dim)",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Enable to chain dead space removal, respawn wait removal, and hype detection in one click.
        </p>
      )}

      {/* ── Expanded content when pipeline mode is on ── */}
      {pipelineMode && (
        <>
          {/* Feature sub-sections (settings) — only shown when idle or error */}
          {(stage === "idle" || stage === "error") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <FeatureSection
                icon={<Scissors size={12} />}
                title="DEAD SPACE REMOVAL"
                enabled={deadSpaceEnabled}
                onEnabledChange={onDeadSpaceEnabledChange}
                disabled={ctrlDisabled}
              >
                <SliderRow
                  label="SILENCE THRESHOLD"
                  value={thresholdDb}
                  min={-60}
                  max={-10}
                  step={1}
                  display={`${thresholdDb} dB`}
                  onChange={onThresholdDbChange}
                  disabled={ctrlDisabled}
                />
                <SliderRow
                  label="MIN SILENCE"
                  value={minSilenceDuration}
                  min={0.1}
                  max={3.0}
                  step={0.1}
                  display={`${minSilenceDuration.toFixed(1)}s`}
                  onChange={onMinSilenceDurationChange}
                  disabled={ctrlDisabled}
                />
              </FeatureSection>

              <FeatureSection
                icon={<Skull size={12} />}
                title="RESPAWN WAIT REMOVAL"
                enabled={respawnEnabled}
                onEnabledChange={onRespawnEnabledChange}
                disabled={ctrlDisabled}
              >
                <SliderRow
                  label="BLACK SENSITIVITY"
                  value={blackThreshold}
                  min={0.05}
                  max={0.5}
                  step={0.01}
                  display={blackThreshold.toFixed(2)}
                  onChange={onBlackThresholdChange}
                  disabled={ctrlDisabled}
                />
                <SliderRow
                  label="MIN DURATION"
                  value={respawnMinDuration}
                  min={0.5}
                  max={5.0}
                  step={0.5}
                  display={`${respawnMinDuration.toFixed(1)}s`}
                  onChange={onRespawnMinDurationChange}
                  disabled={ctrlDisabled}
                />
              </FeatureSection>

              <FeatureSection
                icon={<Zap size={12} />}
                title="HYPE MOMENT DETECTION"
                enabled={hypeEnabled}
                onEnabledChange={onHypeEnabledChange}
                disabled={ctrlDisabled}
              >
                <SliderRow
                  label="AUDIO SENSITIVITY"
                  value={audioSensitivity}
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  display={audioSensitivity.toFixed(2)}
                  onChange={onAudioSensitivityChange}
                  disabled={ctrlDisabled}
                />
                <SliderRow
                  label="MOTION SENSITIVITY"
                  value={motionSensitivity}
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  display={motionSensitivity.toFixed(2)}
                  onChange={onMotionSensitivityChange}
                  disabled={ctrlDisabled}
                />
                <SliderRow
                  label="MIN GAP"
                  value={minGapSeconds}
                  min={1}
                  max={10}
                  step={1}
                  display={`${minGapSeconds}s`}
                  onChange={onMinGapSecondsChange}
                  disabled={ctrlDisabled}
                />
              </FeatureSection>
            </div>
          )}

          {/* Running: step-by-step progress */}
          {isRunning && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {orderedSteps.map((key) => (
                <StepRow
                  key={key}
                  stepKey={key}
                  isCompleted={stepsCompleted.includes(key)}
                  isCurrent={currentStep === key}
                />
              ))}
              {/* progress bar */}
              <div
                style={{
                  marginTop: 10,
                  height: 2,
                  background: "var(--border)",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${percent}%`,
                    background: "var(--green)",
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
            </div>
          )}

          {/* Done: summary card */}
          {isDone && summary && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  border: "1px solid var(--green-border)",
                  background: "var(--green-dim)",
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 11,
                    color: "var(--green)",
                    letterSpacing: "0.12em",
                    marginBottom: 2,
                  }}
                >
                  PIPELINE COMPLETE
                </span>

                {summary.dead_space_removed_seconds > 0 ? (
                  <span
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      color: "var(--text)",
                    }}
                  >
                    ✂ Removed {summary.dead_space_removed_seconds}s of dead space
                  </span>
                ) : deadSpaceEnabled ? (
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "var(--text-muted)" }}>
                    ✂ No dead space found
                  </span>
                ) : null}

                {summary.respawn_waits_removed > 0 ? (
                  <span
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      color: "var(--text)",
                    }}
                  >
                    ☠ Removed {summary.respawn_waits_removed} respawn{" "}
                    {summary.respawn_waits_removed === 1 ? "wait" : "waits"}
                  </span>
                ) : respawnEnabled ? (
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "var(--text-muted)" }}>
                    ☠ No respawn waits found
                  </span>
                ) : null}

                {summary.hype_moments_found > 0 ? (
                  <span
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      color: "var(--text)",
                    }}
                  >
                    ⚡ Found {summary.hype_moments_found} hype{" "}
                    {summary.hype_moments_found === 1 ? "moment" : "moments"}
                  </span>
                ) : hypeEnabled ? (
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "var(--text-muted)" }}>
                    ⚡ No hype moments found
                  </span>
                ) : null}
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                {hasVideoOutput && (
                  <button
                    onClick={onDownload}
                    style={{
                      flex: 1,
                      padding: "11px 16px",
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      background: "var(--green)",
                      color: "#000",
                      border: "none",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
                  >
                    DOWNLOAD VIDEO
                  </button>
                )}
                {summary.hype_moments_found > 0 && (
                  <button
                    onClick={onExportHype}
                    style={{
                      flex: 1,
                      padding: "11px 16px",
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      background: "transparent",
                      color: "var(--green)",
                      border: "1px solid var(--green-border)",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--green-dim)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    EXPORT HYPE MARKERS
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Error message */}
          {isError && errorMsg && (
            <div
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 11,
                color: "var(--red)",
                padding: "8px 12px",
                border: "1px solid var(--red-border)",
                background: "var(--red-dim)",
              }}
            >
              <span style={{ opacity: 0.6 }}>ERR</span> {errorMsg}
            </div>
          )}

          {/* Run / Retry button */}
          {(stage === "idle" || stage === "error") && (
            <button
              onClick={stage === "error" ? onRetry : onRun}
              disabled={!canRun}
              style={{
                width: "100%",
                padding: "11px 16px",
                fontFamily: "'Space Mono', monospace",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.1em",
                background: "transparent",
                color:
                  stage === "error"
                    ? "var(--red)"
                    : !canRun
                    ? "var(--text-dim)"
                    : "var(--green)",
                border:
                  stage === "error"
                    ? "1px solid var(--red)"
                    : `1px solid ${!canRun ? "var(--border)" : "var(--green-border)"}`,
                cursor: !canRun ? "not-allowed" : "pointer",
              }}
              onMouseEnter={(e) => {
                if (!canRun) return;
                if (stage === "error") {
                  e.currentTarget.style.background = "#ff4444";
                  e.currentTarget.style.color = "#ffffff";
                } else {
                  e.currentTarget.style.background = "var(--green-dim)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color =
                  stage === "error"
                    ? "var(--red)"
                    : !canRun
                    ? "var(--text-dim)"
                    : "var(--green)";
              }}
            >
              {stage === "error" ? "TRY AGAIN" : "RUN FULL PIPELINE"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
