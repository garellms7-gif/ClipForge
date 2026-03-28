"use client";

import { useCallback, useRef, useState } from "react";

type Stage = "idle" | "uploading" | "ready" | "processing" | "done" | "error";

interface DropZoneProps {
  file: File | null;
  stage: Stage;
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED_EXT = /\.(mp4|mov|mkv|webm|avi)$/i;
const ACCEPTED_MIME = ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm", "video/avi"];

export default function DropZone({ file, stage, onFileSelect, disabled }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tryAccept = (f: File) => {
    if (!ACCEPTED_MIME.includes(f.type) && !ACCEPTED_EXT.test(f.name)) return;
    onFileSelect(f);
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const f = e.dataTransfer.files[0];
      if (f) tryAccept(f);
    },
    [disabled]
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) tryAccept(f);
    // reset so the same file can be re-selected
    e.target.value = "";
  };

  const formatSize = (bytes: number) =>
    bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const isUploading = stage === "uploading";

  const borderColor = dragging
    ? "var(--green)"
    : isUploading
    ? "var(--green-border)"
    : file
    ? "var(--border-active)"
    : "var(--border)";

  const bgColor = dragging
    ? "var(--green-dim)"
    : isUploading
    ? "rgba(0,255,135,0.04)"
    : "var(--surface)";

  return (
    <div
      className="relative transition-all select-none"
      style={{
        border: `1px dashed ${borderColor}`,
        background: bgColor,
        opacity: disabled && !isUploading ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={onInputChange}
        disabled={disabled}
      />

      <div className="flex flex-col items-center justify-center py-12 px-6 gap-4">
        {isUploading ? (
          <>
            <UploadingSpinner />
            <div className="text-center">
              <p
                className="text-sm font-bold tracking-widest"
                style={{ fontFamily: "'Space Mono', monospace", color: "var(--green)" }}
              >
                UPLOADING
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {file?.name}
              </p>
            </div>
          </>
        ) : file ? (
          <>
            <VideoIcon active />
            <div className="text-center">
              <p
                className="text-sm font-medium"
                style={{ color: "var(--text)" }}
              >
                {file.name}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {formatSize(file.size)}
              </p>
            </div>
            {!disabled && (
              <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                drop another file to replace
              </p>
            )}
          </>
        ) : (
          <>
            <VideoIcon active={false} />
            <div className="text-center">
              <p
                className="text-sm font-bold tracking-widest"
                style={{ fontFamily: "'Space Mono', monospace", color: "var(--text-muted)" }}
              >
                DROP VIDEO HERE
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                or click to browse &mdash; MP4, MOV, MKV, WebM
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function VideoIcon({ active }: { active: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <path
        d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
        stroke={active ? "var(--green)" : "var(--text-dim)"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UploadingSpinner() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 1s linear infinite" }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="var(--border)"
        strokeWidth="2"
      />
      <path
        d="M12 3a9 9 0 019 9"
        stroke="var(--green)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
