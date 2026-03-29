"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type AuthMode = "signin" | "signup";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!email.trim() || !password) {
      setErrorMsg("Email and password are required.");
      return;
    }

    if (mode === "signup") {
      if (password !== confirmPassword) {
        setErrorMsg("Passwords do not match.");
        return;
      }
      if (password.length < 6) {
        setErrorMsg("Password must be at least 6 characters.");
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (data.session) router.push("/");
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        setSuccessMsg(
          "Account created! Check your email to confirm your address, then sign in."
        );
        setMode("signin");
        setPassword("");
        setConfirmPassword("");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.1em",
    color: "var(--text-dim)",
    display: "block",
    marginBottom: 6,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Brand */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.25em",
              color: "var(--green)",
              marginBottom: 6,
            }}
          >
            CLIPFORGE
          </div>
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              color: "var(--text-muted)",
            }}
          >
            {mode === "signin" ? "Sign in to your account" : "Create a new account"}
          </p>
        </div>

        {/* Card */}
        <div
          style={{
            border: "1px solid var(--border)",
            background: "var(--surface)",
            padding: "28px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Mode toggle */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid var(--border)",
              marginBottom: 4,
            }}
          >
            {(["signin", "signup"] as AuthMode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setErrorMsg("");
                  setSuccessMsg("");
                }}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  background: "transparent",
                  border: "none",
                  borderBottom: mode === m ? "2px solid var(--green)" : "2px solid transparent",
                  color: mode === m ? "var(--green)" : "var(--text-dim)",
                  cursor: "pointer",
                  marginBottom: -1,
                }}
              >
                {m === "signin" ? "SIGN IN" : "SIGN UP"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Email */}
            <div>
              <label style={labelStyle}>EMAIL</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={loading}
                style={inputStyle}
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <label style={labelStyle}>PASSWORD</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
                style={inputStyle}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </div>

            {/* Confirm password (sign up only) */}
            {mode === "signup" && (
              <div>
                <label style={labelStyle}>CONFIRM PASSWORD</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  style={inputStyle}
                  autoComplete="new-password"
                />
              </div>
            )}

            {/* Error message */}
            {errorMsg && (
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
            )}

            {/* Success message */}
            {successMsg && (
              <div
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 11,
                  color: "var(--green)",
                  padding: "8px 12px",
                  border: "1px solid var(--green-border)",
                  background: "var(--green-dim)",
                }}
              >
                {successMsg}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "12px 16px",
                fontFamily: "'Space Mono', monospace",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.1em",
                background: loading ? "var(--green-dim)" : "var(--green)",
                color: loading ? "var(--green)" : "#000",
                border: loading ? "1px solid var(--green-border)" : "none",
                cursor: loading ? "not-allowed" : "pointer",
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.opacity = "0.85";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
            >
              {loading ? "PLEASE WAIT..." : mode === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
