"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

interface Member {
  user_id: string;
  email: string;
  role: "owner" | "member";
  joined_at: string;
}

interface TeamData {
  id: string;
  name: string;
  owner_id: string;
  members: Member[];
  seat_limit: number;
}

export default function TeamSettingsPage() {
  const params = useParams();
  const team_id = params.team_id as string;
  const router = useRouter();

  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Rename state
  const [nameInput, setNameInput] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviteError, setInviteError] = useState("");

  // Remove state
  const [removingId, setRemovingId] = useState<string | null>(null);

  const getToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  };

  const fetchTeam = async (token: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/teams/${team_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.detail ?? "Failed to load team.");
        return;
      }
      const data: TeamData = await res.json();
      setTeam(data);
      setNameInput(data.name);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/auth");
        return;
      }
      setCurrentUserId(session.user.id);
      setIsAuthChecked(true);
      fetchTeam(session.access_token);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team_id]);

  const handleRename = async () => {
    const name = nameInput.trim();
    if (!name || !team) return;
    setRenaming(true);
    setRenameError("");
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${BASE}/teams/${team_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const d = await res.json();
        setRenameError(d.detail ?? "Failed to rename team.");
        return;
      }
      setTeam((t) => t ? { ...t, name } : t);
    } catch {
      setRenameError("Network error.");
    } finally {
      setRenaming(false);
    }
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    setInviteError("");
    setInviteMsg("");
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${BASE}/teams/${team_id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      });
      const d = await res.json();
      if (!res.ok) {
        setInviteError(d.detail ?? "Failed to send invite.");
        return;
      }
      setInviteMsg(d.message ?? `Invite sent to ${email}.`);
      setInviteEmail("");
      // Refresh member list
      const newToken = await getToken();
      if (newToken) fetchTeam(newToken);
    } catch {
      setInviteError("Network error.");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (memberId: string) => {
    setRemovingId(memberId);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${BASE}/teams/${team_id}/members/${memberId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.detail ?? "Failed to remove member.");
        return;
      }
      setTeam((t) =>
        t ? { ...t, members: t.members.filter((m) => m.user_id !== memberId) } : t
      );
    } catch {
      alert("Network error.");
    } finally {
      setRemovingId(null);
    }
  };

  if (!isAuthChecked) return null;

  const isOwner = team?.owner_id === currentUserId;
  const seatCount = team?.members.length ?? 0;
  const seatLimit = team?.seat_limit ?? 5;

  const sectionLabel: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.15em",
    color: "var(--text-dim)",
    marginBottom: 12,
  };

  const card: React.CSSProperties = {
    padding: "20px 20px 22px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  };

  const inputStyle: React.CSSProperties = {
    padding: "9px 12px",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 14,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      {/* Simple nav */}
      <div
        style={{
          width: "100%",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          height: 48,
          gap: 20,
        }}
      >
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
        <span style={{ color: "var(--border)" }}>·</span>
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 10,
            letterSpacing: "0.12em",
            color: "var(--text-muted)",
          }}
        >
          TEAM SETTINGS
        </span>
      </div>

      <main
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "36px 24px 64px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {loading && (
          <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "var(--text-dim)" }}>
            LOADING...
          </p>
        )}

        {error && (
          <div
            style={{
              padding: "12px 16px",
              border: "1px solid var(--red-border)",
              background: "var(--red-dim)",
              fontFamily: "'Space Mono', monospace",
              fontSize: 11,
              color: "var(--red)",
            }}
          >
            {error}
          </div>
        )}

        {team && (
          <>
            {/* Team name */}
            <div style={card}>
              <p style={sectionLabel}>TEAM NAME</p>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
                  disabled={!isOwner || renaming}
                  style={{ ...inputStyle, flex: 1 }}
                />
                {isOwner && (
                  <button
                    onClick={handleRename}
                    disabled={renaming || nameInput.trim() === team.name}
                    style={{
                      padding: "9px 16px",
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      background: renaming ? "var(--green-dim)" : "var(--green)",
                      color: renaming ? "var(--green)" : "#000",
                      border: "none",
                      cursor: renaming ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {renaming ? "SAVING..." : "SAVE"}
                  </button>
                )}
              </div>
              {renameError && (
                <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "var(--red)", margin: 0 }}>
                  {renameError}
                </p>
              )}
            </div>

            {/* Members */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ ...sectionLabel, margin: 0 }}>MEMBERS</p>
                <span
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 10,
                    color: seatCount >= seatLimit ? "var(--red)" : "var(--text-dim)",
                    letterSpacing: "0.08em",
                  }}
                >
                  {seatCount} of {seatLimit} seats used
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {team.members.map((m) => (
                  <div
                    key={m.user_id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "9px 12px",
                      background: "var(--surface-2)",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: 13,
                          color: "var(--text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.email || m.user_id}
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        color: m.role === "owner" ? "var(--green)" : "var(--text-dim)",
                        padding: "2px 6px",
                        border: `1px solid ${m.role === "owner" ? "var(--green-border)" : "var(--border)"}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.role.toUpperCase()}
                    </span>
                    {isOwner && m.role !== "owner" && (
                      <button
                        onClick={() => handleRemove(m.user_id)}
                        disabled={removingId === m.user_id}
                        style={{
                          padding: "4px 10px",
                          fontFamily: "'Space Mono', monospace",
                          fontSize: 9,
                          letterSpacing: "0.08em",
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: "var(--text-dim)",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
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
                        {removingId === m.user_id ? "..." : "REMOVE"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Invite member */}
            {isOwner && (
              <div style={card}>
                <p style={sectionLabel}>INVITE MEMBER</p>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); }}
                    placeholder="colleague@example.com"
                    disabled={inviting || seatCount >= seatLimit}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={handleInvite}
                    disabled={inviting || !inviteEmail.trim() || seatCount >= seatLimit}
                    style={{
                      padding: "9px 16px",
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      background: inviting ? "var(--green-dim)" : "var(--green)",
                      color: inviting ? "var(--green)" : "#000",
                      border: "none",
                      cursor: inviting ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inviting ? "SENDING..." : "SEND INVITE"}
                  </button>
                </div>
                {inviteError && (
                  <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "var(--red)", margin: 0 }}>
                    {inviteError}
                  </p>
                )}
                {inviteMsg && (
                  <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "var(--green)", margin: 0 }}>
                    {inviteMsg}
                  </p>
                )}
                {seatCount >= seatLimit && (
                  <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "var(--text-dim)", margin: 0 }}>
                    Seat limit reached ({seatLimit} members maximum).
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <button
          onClick={() => router.push("/")}
          style={{
            alignSelf: "flex-start",
            padding: "9px 18px",
            fontFamily: "'Space Mono', monospace",
            fontSize: 10,
            letterSpacing: "0.1em",
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-active)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          ← BACK TO CLIPFORGE
        </button>
      </main>
    </div>
  );
}
