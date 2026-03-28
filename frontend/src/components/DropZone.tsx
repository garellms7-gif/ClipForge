"use client";

import { useCallback, useRef, useState } from "react";

interface DropZoneProps {
  file: File | null;
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED = ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm", "video/avi"];

export default function DropZone({ file, onFileSelect, disabled }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = (f: File) => {
    if (!ACCEPTED.includes(f.type) && !f.name.match(/\.(mp4|mov|mkv|webm|avi)$/i)) {
      return;
    }
    onFileSelect(f);
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const f = e.dataTransfer.files[0];
      if (f) accept(f);
    },
    [disabled]
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };

  const onDragLeave = () => setDragging(false);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) accept(f);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className="relative rounded-xl transition-all cursor-pointer select-none"
      style={{
        border: `2px dashed ${dragging ? "#7c3aed" : file ? "#4a4a6a" : "var(--border)"}`,
        background: dragging
          ? "rgba(124,58,237,0.06)"
          : file
          ? "rgba(124,58,237,0.04)"
          : "var(--surface-2)",
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
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

      <div className="flex flex-col items-center justify-center py-10 px-6 gap-3">
        {file ? (
          <>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(124,58,237,0.15)" }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                  stroke="#7c3aed"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-medium text-white text-sm">{file.name}</p>
              <p className="text-xs mt-0.5" style={{ color: "#6b6b8e" }}>
                {formatSize(file.size)}
              </p>
            </div>
            {!disabled && (
              <p className="text-xs" style={{ color: "#6b6b8e" }}>
                Click or drop to replace
              </p>
            )}
          </>
        ) : (
          <>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: "var(--border)" }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12M8 8l4-4 4 4"
                  stroke="#6b6b8e"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-medium text-sm" style={{ color: "#a0a0b8" }}>
                Drop a video here
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#6b6b8e" }}>
                or click to browse &mdash; MP4, MOV, MKV, WebM
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
