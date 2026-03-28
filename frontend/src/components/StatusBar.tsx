"use client";

type Stage = "idle" | "uploading" | "processing" | "done" | "error";

interface StatusBarProps {
  stage: Stage;
  errorMsg?: string;
}

const STEPS: { key: Stage; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "processing", label: "Processing" },
  { key: "done", label: "Ready" },
];

export default function StatusBar({ stage, errorMsg }: StatusBarProps) {
  if (stage === "idle") return null;

  if (stage === "error") {
    return (
      <div
        className="rounded-xl px-4 py-3 flex gap-3 items-start text-sm"
        style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0">
          <circle cx="12" cy="12" r="9" stroke="#dc2626" strokeWidth="1.8" />
          <path d="M12 8v4M12 16h.01" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <div>
          <p className="font-medium text-red-400">Processing failed</p>
          {errorMsg && <p className="mt-0.5 text-red-400/70">{errorMsg}</p>}
        </div>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div
        className="rounded-xl px-4 py-3 flex gap-3 items-center text-sm"
        style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
          <circle cx="12" cy="12" r="9" stroke="#10b981" strokeWidth="1.8" />
          <path d="M8 12l3 3 5-5" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="font-medium text-emerald-400">Your video is ready to download</p>
      </div>
    );
  }

  // uploading or processing — animated progress
  const activeIndex = STEPS.findIndex(s => s.key === stage);

  return (
    <div
      className="rounded-xl px-5 py-4 flex flex-col gap-4"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      {/* Step indicators */}
      <div className="flex items-center gap-0">
        {STEPS.map((step, i) => {
          const isDone = i < activeIndex || (stage === "done" && i <= activeIndex);
          const isActive = i === activeIndex;
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                  style={{
                    background: isActive ? "#7c3aed" : isDone ? "#4a2e8a" : "var(--border)",
                    color: isActive || isDone ? "#fff" : "#6b6b8e",
                    boxShadow: isActive ? "0 0 0 3px rgba(124,58,237,0.25)" : "none",
                  }}
                >
                  {isDone ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12l5 5L20 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className="text-xs whitespace-nowrap"
                  style={{ color: isActive ? "#c0c0d8" : "#6b6b8e" }}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className="h-px flex-1 mx-2 mb-4"
                  style={{ background: i < activeIndex ? "#7c3aed" : "var(--border)" }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Animated bar */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: stage === "uploading" ? "40%" : "80%",
            background: "linear-gradient(90deg, #7c3aed, #a855f7)",
            transition: "width 0.6s ease",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.65; }
        }
      `}</style>

      <p className="text-xs text-center" style={{ color: "#6b6b8e" }}>
        {stage === "uploading"
          ? "Uploading your video to the server…"
          : "Detecting and removing silent segments with ffmpeg…"}
      </p>
    </div>
  );
}
