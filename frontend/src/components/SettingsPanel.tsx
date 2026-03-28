"use client";

interface SettingsPanelProps {
  thresholdDb: number;
  onThresholdDbChange: (v: number) => void;
  minSilenceDuration: number;
  onMinSilenceDurationChange: (v: number) => void;
  disabled?: boolean;
}

export default function SettingsPanel({
  thresholdDb,
  onThresholdDbChange,
  minSilenceDuration,
  onMinSilenceDurationChange,
  disabled,
}: SettingsPanelProps) {
  return (
    <div
      className="flex flex-col gap-6 p-5"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <p
        className="text-xs tracking-widest"
        style={{ fontFamily: "'Space Mono', monospace", color: "var(--text-muted)" }}
      >
        SETTINGS
      </p>

      {/* Silence threshold */}
      <SliderRow
        label="SILENCE THRESHOLD"
        value={`${thresholdDb} dB`}
        hint="Audio below this level is treated as silence. More negative = only very quiet parts removed."
        disabled={disabled}
      >
        <input
          type="range"
          min={-60}
          max={-10}
          step={1}
          value={thresholdDb}
          disabled={disabled}
          onChange={e => onThresholdDbChange(Number(e.target.value))}
          className="w-full"
        />
      </SliderRow>

      {/* Min silence duration */}
      <SliderRow
        label="MIN SILENCE DURATION"
        value={`${minSilenceDuration.toFixed(1)} s`}
        hint="Only silences longer than this are removed. Prevents cutting natural pauses in speech."
        disabled={disabled}
      >
        <input
          type="range"
          min={0.1}
          max={3.0}
          step={0.1}
          value={minSilenceDuration}
          disabled={disabled}
          onChange={e => onMinSilenceDurationChange(Number(e.target.value))}
          className="w-full"
        />
      </SliderRow>
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
    <div className="flex flex-col gap-2" style={{ opacity: disabled ? 0.5 : 1 }}>
      <div className="flex items-center justify-between">
        <span
          className="text-xs tracking-widest"
          style={{ fontFamily: "'Space Mono', monospace", color: "var(--text-muted)" }}
        >
          {label}
        </span>
        <span
          className="text-xs font-bold"
          style={{ fontFamily: "'Space Mono', monospace", color: "var(--green)" }}
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
