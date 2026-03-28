"use client";

type Stage = "idle" | "uploading" | "ready" | "processing" | "done" | "error";

interface StatusBarProps {
  stage: Stage;
  errorMsg?: string;
}

export default function StatusBar({ stage, errorMsg }: StatusBarProps) {
  if (stage === "idle" || stage === "uploading" || stage === "ready") return null;

  if (stage === "error") {
    return (
      <div
        className="flex gap-3 items-start p-4 text-sm"
        style={{
          background: "var(--red-dim)",
          border: "1px solid var(--red-border)",
        }}
      >
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            color: "var(--red)",
            fontSize: 11,
            letterSpacing: "0.1em",
            marginTop: 1,
            flexShrink: 0,
          }}
        >
          ERR
        </span>
        <div>
          <p className="font-medium" style={{ color: "var(--red)", fontSize: 13 }}>
            Processing failed
          </p>
          {errorMsg && (
            <p className="mt-0.5 text-xs" style={{ color: "rgba(255,68,68,0.6)" }}>
              {errorMsg}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div
        className="flex gap-3 items-center p-4"
        style={{
          background: "var(--green-dim)",
          border: "1px solid var(--green-border)",
        }}
      >
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            color: "var(--green)",
            fontSize: 11,
            letterSpacing: "0.1em",
          }}
        >
          OK
        </span>
        <p
          className="text-sm font-medium"
          style={{ color: "var(--green)" }}
        >
          Dead space removed — your video is ready
        </p>
      </div>
    );
  }

  // processing
  return (
    <div
      className="flex flex-col gap-4 p-5"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span
          className="text-xs tracking-widest"
          style={{ fontFamily: "'Space Mono', monospace", color: "var(--text-muted)" }}
        >
          PROCESSING
        </span>
        <span
          className="text-xs"
          style={{
            fontFamily: "'Space Mono', monospace",
            color: "var(--green)",
            animation: "blink 1s step-start infinite",
          }}
        >
          ▮
        </span>
      </div>

      {/* Scanning bar */}
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
        Running ffmpeg silencedetect — detecting and removing silent segments…
      </p>
    </div>
  );
}
