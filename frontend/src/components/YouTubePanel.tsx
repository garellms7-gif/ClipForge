"use client";

import { useState } from "react";

export type YouTubePublishStage = "idle" | "publishing" | "published" | "error" | "scheduling" | "scheduled";

interface YouTubePanelProps {
  connected: boolean;
  connectionChecked: boolean;
  stage: YouTubePublishStage;
  youtubeUrl: string;
  errorMsg: string;
  defaultTitle: string;
  onConnect: () => void;
  onPublish: (params: {
    title: string;
    description: string;
    tags: string[];
    privacy: "private" | "unlisted" | "public";
  }) => void;
  onSchedule: (params: {
    title: string;
    description: string;
    tags: string[];
    privacy: "private" | "unlisted" | "public";
    scheduledAt: string; // ISO 8601
  }) => void;
  onRetry: () => void;
  scheduledConfirmation: string; // e.g. "Scheduled for April 1 at 6:00 PM"
  disabled: boolean;
}

const YOUTUBE_RED = "#FF0000";
const YOUTUBE_RED_DIM = "rgba(255,0,0,0.08)";
const YOUTUBE_RED_BORDER = "rgba(255,0,0,0.3)";

/** Format a local datetime-local value to a human-readable string. */
function formatScheduledLabel(isoLocal: string): string {
  if (!isoLocal) return "";
  try {
    const d = new Date(isoLocal);
    return d.toLocaleString(undefined, {
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return isoLocal;
  }
}

/** Return the minimum value for <input type="datetime-local"> — 1 minute from now. */
function minDatetimeLocal(): string {
  const d = new Date(Date.now() + 60_000);
  // Format: YYYY-MM-DDTHH:MM
  return d.toISOString().slice(0, 16);
}

export default function YouTubePanel({
  connected,
  connectionChecked,
  stage,
  youtubeUrl,
  errorMsg,
  defaultTitle,
  onConnect,
  onPublish,
  onSchedule,
  onRetry,
  scheduledConfirmation,
  disabled,
}: YouTubePanelProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("private");
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");

  const labelStyle: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.1em",
    color: "var(--text-dim)",
    display: "block",
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const isWorking = stage === "publishing" || stage === "scheduling";

  const handleSubmit = () => {
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    const resolvedTitle = title.trim() || defaultTitle;
    if (scheduleMode) {
      if (!scheduledAt) return;
      // Convert local datetime-local value to UTC ISO string
      const utcIso = new Date(scheduledAt).toISOString();
      onSchedule({ title: resolvedTitle, description, tags, privacy, scheduledAt: utcIso });
    } else {
      onPublish({ title: resolvedTitle, description, tags, privacy });
    }
  };

  const buttonLabel = () => {
    if (stage === "publishing") return "UPLOADING...";
    if (stage === "scheduling") return "SCHEDULING...";
    return scheduleMode ? "SCHEDULE" : "PUBLISH TO YOUTUBE";
  };

  return (
    <div
      style={{
        border: `1px solid ${YOUTUBE_RED_BORDER}`,
        background: "var(--surface)",
        padding: "20px 20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="5" width="20" height="14" rx="3" fill={YOUTUBE_RED} />
          <polygon points="10,8.5 10,15.5 16,12" fill="#fff" />
        </svg>
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.15em",
            color: YOUTUBE_RED,
          }}
        >
          PUBLISH TO YOUTUBE
        </span>
      </div>

      {/* Not yet connected */}
      {connectionChecked && !connected && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            Connect your YouTube account to publish directly from ClipForge.
          </p>
          <button
            onClick={onConnect}
            disabled={disabled}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              fontFamily: "'Space Mono', monospace",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              background: disabled ? YOUTUBE_RED_DIM : YOUTUBE_RED,
              color: disabled ? YOUTUBE_RED : "#fff",
              border: disabled ? `1px solid ${YOUTUBE_RED_BORDER}` : "none",
              cursor: disabled ? "not-allowed" : "pointer",
              alignSelf: "flex-start",
            }}
            onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            CONNECT YOUTUBE
          </button>
        </div>
      )}

      {/* Connected — show publish form or result */}
      {connectionChecked && connected && (
        <>
          {/* Connected indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 10,
                color: "var(--green)",
                letterSpacing: "0.08em",
              }}
            >
              CONNECTED
            </span>
          </div>

          {/* Published state */}
          {stage === "published" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "12px 14px",
                background: "var(--green-dim)",
                border: "1px solid var(--green-border)",
              }}
            >
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "var(--green)" }}>
                VIDEO PUBLISHED
              </span>
              <a
                href={youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: YOUTUBE_RED, wordBreak: "break-all" }}
              >
                {youtubeUrl}
              </a>
            </div>
          )}

          {/* Scheduled confirmation state */}
          {stage === "scheduled" && (
            <div
              style={{
                padding: "12px 14px",
                background: "rgba(255,190,0,0.08)",
                border: "1px solid rgba(255,190,0,0.3)",
                fontFamily: "'Space Mono', monospace",
                fontSize: 11,
                color: "#FFBE00",
              }}
            >
              {scheduledConfirmation || "SCHEDULED"}
            </div>
          )}

          {/* Error state */}
          {stage === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
              <button
                onClick={onRetry}
                style={{
                  alignSelf: "flex-start",
                  padding: "8px 14px",
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  background: "transparent",
                  border: "1px solid var(--red)",
                  color: "var(--red)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--red)"; e.currentTarget.style.color = "#fff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--red)"; }}
              >
                RETRY
              </button>
            </div>
          )}

          {/* Publish form (idle or working) */}
          {(stage === "idle" || stage === "publishing" || stage === "scheduling") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Title */}
              <div>
                <label style={labelStyle}>TITLE</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={defaultTitle}
                  disabled={isWorking}
                  style={inputStyle}
                />
              </div>

              {/* Description */}
              <div>
                <label style={labelStyle}>DESCRIPTION</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description..."
                  disabled={isWorking}
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>

              {/* Tags */}
              <div>
                <label style={labelStyle}>TAGS (comma-separated)</label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="gaming, highlight, clip"
                  disabled={isWorking}
                  style={inputStyle}
                />
              </div>

              {/* Privacy */}
              <div>
                <label style={labelStyle}>PRIVACY</label>
                <select
                  value={privacy}
                  onChange={(e) => setPrivacy(e.target.value as "private" | "unlisted" | "public")}
                  disabled={isWorking}
                  style={{ ...inputStyle, appearance: "none", cursor: isWorking ? "not-allowed" : "pointer" }}
                >
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </div>

              {/* Schedule toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={() => setScheduleMode((v) => !v)}
                  disabled={isWorking}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    background: scheduleMode ? "rgba(255,190,0,0.12)" : "transparent",
                    border: scheduleMode ? "1px solid rgba(255,190,0,0.4)" : "1px solid var(--border)",
                    color: scheduleMode ? "#FFBE00" : "var(--text-dim)",
                    cursor: isWorking ? "not-allowed" : "pointer",
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M6 3.5V6L7.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  SCHEDULE
                </button>
                {scheduleMode && (
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "var(--text-dim)" }}>
                    pick a date &amp; time below
                  </span>
                )}
              </div>

              {/* Datetime picker — shown when schedule mode is on */}
              {scheduleMode && (
                <div>
                  <label style={labelStyle}>PUBLISH DATE &amp; TIME (your local time)</label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    min={minDatetimeLocal()}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    disabled={isWorking}
                    style={{
                      ...inputStyle,
                      colorScheme: "dark",
                    }}
                  />
                  {scheduledAt && (
                    <span
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 9,
                        color: "#FFBE00",
                        marginTop: 5,
                        display: "block",
                      }}
                    >
                      Will publish {formatScheduledLabel(scheduledAt)}
                    </span>
                  )}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={disabled || isWorking || (scheduleMode && !scheduledAt)}
                style={{
                  width: "100%",
                  padding: "11px 16px",
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  background:
                    disabled || isWorking || (scheduleMode && !scheduledAt)
                      ? YOUTUBE_RED_DIM
                      : scheduleMode
                      ? "rgba(255,190,0,0.15)"
                      : YOUTUBE_RED,
                  color:
                    disabled || isWorking || (scheduleMode && !scheduledAt)
                      ? YOUTUBE_RED
                      : scheduleMode
                      ? "#FFBE00"
                      : "#fff",
                  border:
                    disabled || isWorking || (scheduleMode && !scheduledAt)
                      ? `1px solid ${YOUTUBE_RED_BORDER}`
                      : scheduleMode
                      ? "1px solid rgba(255,190,0,0.4)"
                      : "none",
                  cursor:
                    disabled || isWorking || (scheduleMode && !scheduledAt)
                      ? "not-allowed"
                      : "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!disabled && !isWorking && !(scheduleMode && !scheduledAt))
                    e.currentTarget.style.opacity = "0.85";
                }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
              >
                {buttonLabel()}
              </button>
            </div>
          )}
        </>
      )}

      {/* While connection status is loading */}
      {!connectionChecked && (
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 10,
            color: "var(--text-dim)",
            letterSpacing: "0.08em",
          }}
        >
          CHECKING CONNECTION...
        </span>
      )}
    </div>
  );
}
