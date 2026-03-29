"use client";

interface TopBarProps {
  userEmail: string;
  onSignOut: () => void;
}

export default function TopBar({ userEmail, onSignOut }: TopBarProps) {
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
        }}
      >
        CLIPFORGE
      </span>

      {/* Right: email + sign out */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            color: "var(--text-muted)",
            maxWidth: 200,
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
