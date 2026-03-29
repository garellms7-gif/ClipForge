"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export default function BillingSuccessPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push("/auth"); return; }
      try {
        const res = await fetch(`${BASE}/billing/status`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setPlan(data.plan);
        }
      } catch {
        setPlan("creator");
      }
    });
  }, [router]);

  const planLabel = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "paid";

  return (
    <div
      style={{
        background: "var(--bg)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          maxWidth: 480,
          textAlign: "center",
        }}
      >
        {/* Check icon */}
        <div
          style={{
            width: 56,
            height: 56,
            border: "2px solid var(--green)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <polyline
              points="20 6 9 17 4 12"
              stroke="var(--green)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div>
          <h1
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.15em",
              color: "var(--text)",
              marginBottom: 10,
            }}
          >
            YOU&apos;RE ON THE {planLabel.toUpperCase()} PLAN
          </h1>
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 15,
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}
          >
            Let&apos;s make something.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => router.push("/")}
            style={{
              padding: "11px 22px",
              fontFamily: "'Space Mono', monospace",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              background: "var(--green)",
              color: "#000",
              border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            OPEN CLIPFORGE
          </button>
          <button
            onClick={() => router.push("/billing")}
            style={{
              padding: "11px 22px",
              fontFamily: "'Space Mono', monospace",
              fontSize: 11,
              letterSpacing: "0.1em",
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-active)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            VIEW PLAN
          </button>
        </div>
      </div>
    </div>
  );
}
