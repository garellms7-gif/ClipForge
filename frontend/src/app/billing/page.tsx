"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";
import { supabase } from "@/lib/supabase";

const BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

interface BillingStatus {
  plan: string;
  videos_this_month: number;
  limit: number | null;
}

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    features: [
      "3 videos / month",
      "Dead space removal",
      "Download processed video",
    ],
    excluded: ["Respawn Wait Remover", "Hype Moment Detector", "YouTube publishing", "Team seats"],
  },
  {
    id: "creator",
    name: "Creator",
    price: "$12",
    period: "/ month",
    features: [
      "Unlimited videos",
      "Dead space removal",
      "Respawn Wait Remover",
      "Hype Moment Detector",
      "Full Pipeline mode",
      "YouTube publishing",
    ],
    excluded: ["Team seats", "Shared workspace"],
  },
  {
    id: "team",
    name: "Team",
    price: "$29",
    period: "/ month",
    features: [
      "Everything in Creator",
      "5 seats",
      "Shared workspace",
      "Priority support",
    ],
    excluded: [],
  },
];

export default function BillingPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/auth");
      } else {
        setUserEmail(session.user.email ?? "");
        setIsAuthChecked(true);
        fetchStatus(session.access_token);
      }
    });
  }, [router]);

  const fetchStatus = async (token: string) => {
    try {
      const res = await fetch(`${BASE}/billing/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setStatus(await res.json());
    } catch {
      // non-critical
    }
  };

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/auth"); return; }
      const res = await fetch(`${BASE}/billing/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ plan: planId }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.detail ?? "Failed to start checkout. Please try again.");
        return;
      }
      const { checkout_url } = await res.json();
      window.location.href = checkout_url;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setUpgrading(null);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/auth");
  };

  if (!isAuthChecked) return null;

  const currentPlan = status?.plan ?? "free";
  const videosUsed = status?.videos_this_month ?? 0;
  const limit = status?.limit ?? 3;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <TopBar
        userEmail={userEmail}
        onSignOut={handleSignOut}
        activeTeamId={null}
        onWorkspaceChange={() => undefined}
      />

      <main
        className="flex flex-col items-center px-4 pt-10 pb-16"
        style={{ maxWidth: 880, margin: "0 auto" }}
      >
        {/* Header */}
        <header className="mb-10 text-center">
          <h1
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.2em",
              color: "var(--text)",
              marginBottom: 8,
            }}
          >
            PLANS &amp; BILLING
          </h1>
          <p style={{ fontFamily: "'DM Sans', sans-serif", color: "var(--text-muted)", fontSize: 14 }}>
            Choose the plan that fits your workflow.
          </p>
        </header>

        {/* Usage summary */}
        {status && (
          <div
            style={{
              width: "100%",
              maxWidth: 680,
              padding: "12px 16px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              marginBottom: 28,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.1em",
                color: "var(--text-dim)",
              }}
            >
              THIS MONTH
            </span>
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14,
                color: "var(--text)",
              }}
            >
              {videosUsed} video{videosUsed !== 1 ? "s" : ""} processed
              {limit !== null ? ` of ${limit}` : " (unlimited)"}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "'Space Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.08em",
                color: "var(--green)",
                padding: "3px 8px",
                border: "1px solid var(--green-border)",
              }}
            >
              {currentPlan.toUpperCase()}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              width: "100%",
              maxWidth: 680,
              padding: "10px 14px",
              marginBottom: 20,
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

        {/* Plan cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
            width: "100%",
          }}
        >
          {PLANS.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const isUpgradable =
              plan.id !== "free" &&
              (currentPlan === "free" ||
                (currentPlan === "creator" && plan.id === "team"));
            const isLoading = upgrading === plan.id;

            return (
              <div
                key={plan.id}
                style={{
                  padding: "22px 20px 24px",
                  border: isCurrent
                    ? "1px solid var(--green-border)"
                    : "1px solid var(--border)",
                  background: "var(--surface)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  position: "relative",
                }}
              >
                {isCurrent && (
                  <div
                    style={{
                      position: "absolute",
                      top: -1,
                      right: 16,
                      background: "var(--green)",
                      color: "#000",
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      padding: "3px 8px",
                    }}
                  >
                    CURRENT
                  </div>
                )}

                {/* Plan name + price */}
                <div>
                  <div
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 13,
                      fontWeight: 700,
                      letterSpacing: "0.15em",
                      color: isCurrent ? "var(--green)" : "var(--text)",
                      marginBottom: 8,
                    }}
                  >
                    {plan.name.toUpperCase()}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 26,
                        fontWeight: 700,
                        color: "var(--text)",
                      }}
                    >
                      {plan.price}
                    </span>
                    <span
                      style={{
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 13,
                        color: "var(--text-muted)",
                      }}
                    >
                      {plan.period}
                    </span>
                  </div>
                </div>

                {/* Features */}
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 13,
                        color: "var(--text)",
                      }}
                    >
                      <span style={{ color: "var(--green)", fontWeight: 700 }}>✓</span>
                      {f}
                    </li>
                  ))}
                  {plan.excluded.map((f) => (
                    <li
                      key={f}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 13,
                        color: "var(--text-dim)",
                        textDecoration: "line-through",
                      }}
                    >
                      <span style={{ color: "var(--text-dim)" }}>✗</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div style={{ marginTop: "auto" }}>
                  {isCurrent ? (
                    <div
                      style={{
                        padding: "10px 0",
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 11,
                        color: "var(--green)",
                        letterSpacing: "0.08em",
                        textAlign: "center",
                      }}
                    >
                      YOUR CURRENT PLAN
                    </div>
                  ) : isUpgradable ? (
                    <button
                      onClick={() => handleUpgrade(plan.id)}
                      disabled={!!upgrading}
                      style={{
                        width: "100%",
                        padding: "11px 0",
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        background: upgrading ? "var(--green-dim)" : "var(--green)",
                        color: upgrading ? "var(--green)" : "#000",
                        border: upgrading ? "1px solid var(--green-border)" : "none",
                        cursor: upgrading ? "not-allowed" : "pointer",
                      }}
                      onMouseEnter={(e) => { if (!upgrading) e.currentTarget.style.opacity = "0.85"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                    >
                      {isLoading ? "REDIRECTING..." : `UPGRADE TO ${plan.name.toUpperCase()}`}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => router.push("/")}
          style={{
            marginTop: 28,
            padding: "10px 20px",
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
          ← BACK TO CLIPFORGE
        </button>
      </main>
    </div>
  );
}
