"use client";

import { useState } from "react";

export type YouTubePublishStage = "idle" | "publishing" | "published" | "error";

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
  onRetry: () => void;
  disabled: boolean;
}

const YOUTUBE_RED = "#FF0000";
const YOUTUBE_RED_DIM = "rgba(255,0,0,0.08)";
const YOUTUBE_RED_BORDER = "rgba(255,0,0,0.3)";

export default function YouTubePanel({
  connected,
  connectionChecked,
  stage,
  youtubeUrl,
  errorMsg,
  defaultTitle,
  onConnect,
  onPublish,
  onRetry,
  disabled,
}: YouTubePanelProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("private");

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

  const handleSubmit = () => {
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onPublish({ title: title.trim() || defaultTitle, description, tags, privacy });
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
        {/* YouTube icon */}
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
            onMouseEnter={(e) => {
              if (!disabled) e.currentTarget.style.opacity = "0.85";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
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
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--green)",
              }}
            />
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
              <span
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 11,
                  color: "var(--green)",
                }}
              >
                VIDEO PUBLISHED
              </span>
              <a
                href={youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13,
                  color: YOUTUBE_RED,
                  wordBreak: "break-all",
                }}
              >
                {youtubeUrl}
              </a>
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
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--red)";
                  e.currentTarget.style.color = "#fff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--red)";
                }}
              >
                RETRY
              </button>
            </div>
          )}

          {/* Publish form (idle or publishing) */}
          {(stage === "idle" || stage === "publishing") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Title */}
              <div>
                <label style={labelStyle}>TITLE</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={defaultTitle}
                  disabled={stage === "publishing"}
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
                  disabled={stage === "publishing"}
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
                  disabled={stage === "publishing"}
                  style={inputStyle}
                />
              </div>

              {/* Privacy */}
              <div>
                <label style={labelStyle}>PRIVACY</label>
                <select
                  value={privacy}
                  onChange={(e) =>
                    setPrivacy(e.target.value as "private" | "unlisted" | "public")
                  }
                  disabled={stage === "publishing"}
                  style={{
                    ...inputStyle,
                    appearance: "none",
                    cursor: stage === "publishing" ? "not-allowed" : "pointer",
                  }}
                >
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={disabled || stage === "publishing"}
                style={{
                  width: "100%",
                  padding: "11px 16px",
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  background:
                    disabled || stage === "publishing" ? YOUTUBE_RED_DIM : YOUTUBE_RED,
                  color: disabled || stage === "publishing" ? YOUTUBE_RED : "#fff",
                  border:
                    disabled || stage === "publishing"
                      ? `1px solid ${YOUTUBE_RED_BORDER}`
                      : "none",
                  cursor:
                    disabled || stage === "publishing" ? "not-allowed" : "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!disabled && stage !== "publishing")
                    e.currentTarget.style.opacity = "0.85";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
              >
                {stage === "publishing" ? "UPLOADING..." : "PUBLISH TO YOUTUBE"}
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
