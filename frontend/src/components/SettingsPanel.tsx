"use client";

interface SettingsPanelProps {
  silenceThreshold: number;
  onSilenceThresholdChange: (v: number) => void;
  minSilenceDuration: number;
  onMinSilenceDurationChange: (v: number) => void;
  disabled?: boolean;
}

export default function SettingsPanel({
  silenceThreshold,
  onSilenceThresholdChange,
  minSilenceDuration,
  onMinSilenceDurationChange,
  disabled,
}: SettingsPanelProps) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-5"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#6b6b8e" }}>
        Settings
      </h2>

      {/* Silence threshold */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-white">
            Silence Threshold
          </label>
          <span
            className="text-sm font-mono px-2 py-0.5 rounded"
            style={{ background: "var(--border)", color: "#c0c0d8" }}
          >
            {silenceThreshold} dB
          </span>
        </div>
        <input
          type="range"
          min={-60}
          max={-10}
          step={1}
          value={silenceThreshold}
          disabled={disabled}
          onChange={e => onSilenceThresholdChange(Number(e.target.value))}
          className="w-full accent-violet-500 disabled:opacity-50"
        />
        <p className="text-xs" style={{ color: "#6b6b8e" }}>
          Audio below this level is considered silent. More negative = only very quiet parts removed.
        </p>
      </div>

      {/* Min silence duration */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-white">
            Minimum Silence Duration
          </label>
          <span
            className="text-sm font-mono px-2 py-0.5 rounded"
            style={{ background: "var(--border)", color: "#c0c0d8" }}
          >
            {minSilenceDuration.toFixed(1)} s
          </span>
        </div>
        <input
          type="range"
          min={0.1}
          max={5}
          step={0.1}
          value={minSilenceDuration}
          disabled={disabled}
          onChange={e => onMinSilenceDurationChange(Number(e.target.value))}
          className="w-full accent-violet-500 disabled:opacity-50"
        />
        <p className="text-xs" style={{ color: "#6b6b8e" }}>
          Only silences longer than this will be removed. Prevents cutting natural speech pauses.
        </p>
      </div>
    </div>
  );
}
