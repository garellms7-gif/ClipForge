"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export interface Team {
  id: string;
  name: string;
  role: "owner" | "member";
}

interface TopBarProps {
  userEmail: string;
  onSignOut: () => void;
  teams?: Team[];
  activeTeamId: string | null;
  billingPlan?: string;
  onWorkspaceChange: (teamId: string | null) => void;
  onCreateTeam?: () => void;
}

export default function TopBar({
  userEmail,
  onSignOut,
  teams = [],
  activeTeamId,
  billingPlan,
  onWorkspaceChange,
  onCreateTeam,
}: TopBarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeTeam = teams.find((t) => t.id === activeTeamId);
  const label = activeTeam ? activeTeam.name : "Personal";

  return (
    <div
      style={{
        width: "100%",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        height: 48,
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Left: logo */}
      <span
        style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.2em",
          color: "var(--green)",
          flexShrink: 0,
        }}
      >
        CLIPFORGE
      </span>

      {/* Centre: workspace switcher */}
      <div ref={ref} style={{ position: "relative" }}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            fontFamily: "'Space Mono', monospace",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: activeTeamId ? "var(--green)" : "var(--text-muted)",
            background: "transparent",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border-active)")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        >
          {label.toUpperCase()}
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="none"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.1s" }}
          >
            <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {open && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: "50%",
              transform: "translateX(-50%)",
              minWidth: 180,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              zIndex: 100,
              overflow: "hidden",
            }}
          >
            {/* Personal */}
            <WorkspaceItem
              label="Personal"
              active={activeTeamId === null}
              onClick={() => { onWorkspaceChange(null); setOpen(false); }}
            />

            {/* Teams */}
            {teams.map((team) => (
              <WorkspaceItem
                key={team.id}
                label={team.name}
                active={activeTeamId === team.id}
                showSettings={team.role === "owner"}
                onClick={() => { onWorkspaceChange(team.id); setOpen(false); }}
                onSettings={(e) => {
                  e.stopPropagation();
                  router.push(`/teams/${team.id}/settings`);
                  setOpen(false);
                }}
              />
            ))}

            {/* Divider + Create Team (Team plan only) */}
            {billingPlan === "team" && (
              <>
                <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
                <button
                  onClick={() => { onCreateTeam?.(); setOpen(false); }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 14px",
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    color: "var(--green)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--green-dim)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ fontSize: 13, lineHeight: 1 }}>+</span>
                  CREATE TEAM
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Right: email + sign out */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            color: "var(--text-muted)",
            maxWidth: 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={userEmail}
        >
          {userEmail}
        </span>

        <button
          onClick={onSignOut}
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 10,
            letterSpacing: "0.1em",
            color: "var(--text-dim)",
            background: "transparent",
            border: "1px solid var(--border)",
            padding: "4px 10px",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--red)";
            e.currentTarget.style.color = "var(--red)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.color = "var(--text-dim)";
          }}
        >
          SIGN OUT
        </button>
      </div>
    </div>
  );
}

// ── Internal sub-component ────────────────────────────────────────────────────

function WorkspaceItem({
  label,
  active,
  showSettings,
  onClick,
  onSettings,
}: {
  label: string;
  active: boolean;
  showSettings?: boolean;
  onClick: () => void;
  onSettings?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 4px 0 14px",
        cursor: "pointer",
        background: active ? "var(--green-dim)" : "transparent",
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = active ? "var(--green-dim)" : "transparent";
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 13,
          color: active ? "var(--green)" : "var(--text)",
          padding: "9px 0",
          flex: 1,
        }}
      >
        {active && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="var(--green)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {!active && <span style={{ width: 10, display: "inline-block" }} />}
        {label}
      </span>

      {showSettings && (
        <button
          onClick={onSettings}
          title="Team settings"
          style={{
            padding: "6px 8px",
            background: "transparent",
            border: "none",
            color: "var(--text-dim)",
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
        >
          ⚙
        </button>
      )}
    </div>
  );
}
