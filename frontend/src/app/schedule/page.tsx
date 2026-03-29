"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { parseApiError } from "@/lib/api";

const BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

type ScheduleStatus = "scheduled" | "published" | "failed" | "cancelled";

interface ScheduleRow {
  id: string;
  job_id: string;
  filename: string;
  platforms: string[];
  scheduled_at: string;
  status: ScheduleStatus;
  error_message: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<ScheduleStatus, { bg: string; border: string; color: string; label: string }> = {
  scheduled:  { bg: "rgba(255,190,0,0.10)",  border: "rgba(255,190,0,0.35)",  color: "#FFBE00", label: "SCHEDULED" },
  published:  { bg: "var(--green-dim)",       border: "var(--green-border)",   color: "var(--green)", label: "PUBLISHED" },
  failed:     { bg: "var(--red-dim)",         border: "var(--red-border)",     color: "var(--red)", label: "FAILED" },
  cancelled:  { bg: "rgba(100,100,100,0.10)", border: "rgba(100,100,100,0.3)", color: "#666", label: "CANCELLED" },
};

function StatusBadge({ status }: { status: ScheduleStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.cancelled;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 8px",
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        fontFamily: "'Space Mono', monospace",
        fontSize: 9,
        letterSpacing: "0.1em",
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function SchedulePage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function getToken(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/auth");
        return;
      }
      loadSchedules(session.access_token);
    });
  }, [router]);

  async function loadSchedules(token: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/publish/schedule`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setSchedules(data.schedules ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load schedules.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(scheduleId: string) {
    setCancelling(scheduleId);
    try {
      const token = await getToken();
      const res = await fetch(`${BASE}/publish/schedule/${scheduleId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setSchedules((prev) =>
        prev.map((s) => (s.id === scheduleId ? { ...s, status: "cancelled" } : s))
      );
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to cancel schedule.");
    } finally {
      setCancelling(null);
    }
  }

  const mono: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
  };

  const sans: React.CSSProperties = {
    fontFamily: "'DM Sans', sans-serif",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        padding: "40px 24px",
      }}
    >
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        {/* Back link */}
        <button
          onClick={() => router.push("/")}
          style={{
            ...mono,
            fontSize: 10,
            letterSpacing: "0.1em",
            color: "var(--text-dim)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
            marginBottom: 28,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          ← BACK TO EDITOR
        </button>

        {/* Heading */}
        <h1
          style={{
            ...mono,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.12em",
            margin: "0 0 6px",
          }}
        >
          SCHEDULED PUBLISHES
        </h1>
        <p
          style={{
            ...sans,
            fontSize: 13,
            color: "var(--text-muted)",
            margin: "0 0 28px",
          }}
        >
          All upcoming and past scheduled video publishes.
        </p>

        {/* Error */}
        {error && (
          <div
            style={{
              ...mono,
              fontSize: 11,
              color: "var(--red)",
              padding: "10px 14px",
              border: "1px solid var(--red-border)",
              background: "var(--red-dim)",
              marginBottom: 20,
            }}
          >
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <p style={{ ...mono, fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.08em" }}>
            LOADING...
          </p>
        )}

        {/* Empty state */}
        {!loading && !error && schedules.length === 0 && (
          <div
            style={{
              padding: "32px 20px",
              border: "1px solid var(--border)",
              textAlign: "center",
            }}
          >
            <p style={{ ...mono, fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.1em", margin: 0 }}>
              NO SCHEDULED PUBLISHES
            </p>
            <p style={{ ...sans, fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
              Use the Schedule toggle in the YouTube panel to queue a publish.
            </p>
          </div>
        )}

        {/* Table */}
        {!loading && schedules.length > 0 && (
          <div style={{ border: "1px solid var(--border)", overflow: "hidden" }}>
            {/* Header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 120px 180px 100px 90px",
                padding: "10px 16px",
                borderBottom: "1px solid var(--border)",
                background: "var(--surface)",
              }}
            >
              {["VIDEO", "PLATFORMS", "SCHEDULED FOR", "STATUS", ""].map((h) => (
                <span
                  key={h}
                  style={{
                    ...mono,
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    color: "var(--text-dim)",
                  }}
                >
                  {h}
                </span>
              ))}
            </div>

            {/* Data rows */}
            {schedules.map((row, i) => (
              <div
                key={row.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 120px 180px 100px 90px",
                  alignItems: "center",
                  padding: "12px 16px",
                  borderBottom:
                    i < schedules.length - 1 ? "1px solid var(--border)" : "none",
                  background: "var(--bg)",
                }}
              >
                {/* Filename */}
                <div style={{ minWidth: 0, paddingRight: 12 }}>
                  <span
                    style={{
                      ...sans,
                      fontSize: 13,
                      color: "var(--text)",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.filename || row.job_id}
                  >
                    {row.filename || <span style={{ color: "var(--text-dim)" }}>{row.job_id.slice(0, 8)}…</span>}
                  </span>
                </div>

                {/* Platforms */}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {(row.platforms ?? []).map((p) => (
                    <span
                      key={p}
                      style={{
                        ...mono,
                        fontSize: 9,
                        letterSpacing: "0.08em",
                        padding: "2px 6px",
                        border: "1px solid var(--border)",
                        color: p === "youtube" ? "#FF0000" : "var(--text-dim)",
                        background: p === "youtube" ? "rgba(255,0,0,0.06)" : "transparent",
                      }}
                    >
                      {p.toUpperCase()}
                    </span>
                  ))}
                </div>

                {/* Scheduled at */}
                <span style={{ ...sans, fontSize: 12, color: "var(--text-muted)" }}>
                  {formatDateTime(row.scheduled_at)}
                </span>

                {/* Status badge */}
                <StatusBadge status={row.status} />

                {/* Cancel button */}
                <div>
                  {row.status === "scheduled" && (
                    <button
                      onClick={() => handleCancel(row.id)}
                      disabled={cancelling === row.id}
                      style={{
                        ...mono,
                        fontSize: 9,
                        letterSpacing: "0.08em",
                        padding: "5px 10px",
                        background: "transparent",
                        border: "1px solid var(--red-border)",
                        color: "var(--red)",
                        cursor: cancelling === row.id ? "not-allowed" : "pointer",
                        opacity: cancelling === row.id ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => { if (cancelling !== row.id) { e.currentTarget.style.background = "var(--red)"; e.currentTarget.style.color = "#fff"; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--red)"; }}
                    >
                      {cancelling === row.id ? "..." : "CANCEL"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Failed error detail (collapsed under each row would be complex; show below table) */}
        {schedules.some((s) => s.status === "failed" && s.error_message) && (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            {schedules
              .filter((s) => s.status === "failed" && s.error_message)
              .map((s) => (
                <div
                  key={s.id}
                  style={{
                    ...sans,
                    fontSize: 12,
                    padding: "8px 12px",
                    border: "1px solid var(--red-border)",
                    background: "var(--red-dim)",
                    color: "var(--red)",
                  }}
                >
                  <span style={{ ...mono, fontSize: 9, marginRight: 8 }}>ERR</span>
                  {s.error_message}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
