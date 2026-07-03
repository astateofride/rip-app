"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: "#080810" }}
    >
      <div className="w-full flex flex-col gap-6" style={{ maxWidth: 420 }}>
        <div style={{ paddingTop: 8, paddingBottom: 4 }}>
          <div
            className="font-display leading-none mb-3"
            style={{ letterSpacing: "0.03em" }}
          >
            <div style={{ fontSize: 72, color: "#f0f0eb", lineHeight: 0.88 }}>
              RIDE
            </div>
            <div style={{ fontSize: 72, color: "#e8c547", lineHeight: 0.88 }}>
              INSTRUCTOR
            </div>
            <div style={{ fontSize: 72, color: "#f0f0eb", lineHeight: 0.88 }}>
              PATHWAY
            </div>
          </div>
          <div
            style={{
              width: 48,
              height: 3,
              background: "#e8c547",
              borderRadius: 2,
              marginBottom: 16,
            }}
          />
          <p className="text-sm leading-relaxed" style={{ color: "#7878a8" }}>
            Choose a new password for your account.
          </p>
        </div>

        <form
          onSubmit={handleReset}
          className="flex flex-col gap-4 rounded-3xl p-5"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <div>
            <label
              className="block text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ color: "#7878a8" }}
            >
              New password
            </label>
            <input
              type="password"
              className="inp"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              required
              minLength={8}
              style={{ fontSize: 16 }}
            />
          </div>
          <div>
            <label
              className="block text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ color: "#7878a8" }}
            >
              Confirm password
            </label>
            <input
              type="password"
              className="inp"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
              required
              style={{ fontSize: 16 }}
            />
          </div>

          {error && (
            <div
              className="px-4 py-3 rounded-xl text-sm font-semibold"
              style={{
                background: "rgba(255,107,157,0.08)",
                border: "1px solid rgba(255,107,157,0.25)",
                color: "#ff6b9d",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="font-display tracking-widest py-4 rounded-2xl transition-all disabled:opacity-30 active:scale-[0.98]"
            style={{
              fontSize: 24,
              background: "#e8c547",
              color: "#080810",
              letterSpacing: "0.06em",
            }}
          >
            {loading ? "SAVING…" : "SET PASSWORD →"}
          </button>
        </form>
      </div>
    </div>
  );
}
