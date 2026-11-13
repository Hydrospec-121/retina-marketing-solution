"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const staffLandingPath = (role: string | undefined): string | null => {
  if (role === "owner") return "/admin";
  if (role === "inventory_manager") return "/admin/inventory";
  if (["manager", "sales", "accountant"].includes(role ?? "")) {
    return "/admin/sales/history";
  }
  return null;
};

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    // Show the login form if session recovery takes too long.
    const fallback = window.setTimeout(() => {
      if (active) setChecking(false);
    }, 4000);

    supabase.auth
      .getSession()
      .then(async ({ data, error: sessionError }) => {
        if (!active) return;

        window.clearTimeout(fallback);

        if (!sessionError && data.session) {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", data.session.user.id)
            .single();
          if (!active) return;
          const landingPath = profileError ? null : staffLandingPath(profile?.role);
          if (landingPath) {
            router.replace(landingPath);
          } else {
            if (profile?.role && !profileError) await supabase.auth.signOut();
            setError(
              profileError
                ? "Could not verify staff access. Please try again or contact your system administrator."
                : "This account is not authorised for the Retina staff workspace."
            );
            setChecking(false);
          }

          if (landingPath) {
            // Avoid leaving the user stuck if navigation is delayed.
            window.setTimeout(() => {
              if (active) setChecking(false);
            }, 2500);
          }
        } else {
          setChecking(false);
        }
      })
      .catch(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
      window.clearTimeout(fallback);
    };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");

    try {
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (signInError || !data.user) {
        setError(
          signInError?.message ?? "Unable to sign in. Please try again."
        );
        setLoading(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single();

      const landingPath = profileError ? null : staffLandingPath(profile?.role);
      if (!landingPath) {
        await supabase.auth.signOut();

        setError(
          profileError
            ? "Could not verify staff access. Contact your system administrator."
            : "This account is not authorised for the Retina staff workspace."
        );

        setLoading(false);
        return;
      }

      router.replace(landingPath);
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <main className="login-screen">
        <p>Checking your session…</p>
      </main>
    );
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <Link className="brand" href="/">
          <span className="brand-mark">R</span>
          <span>
            RETINA
            <small>BUSINESS HUB</small>
          </span>
        </Link>

        <div className="eyebrow">STAFF ACCESS</div>

        <h1>
          Welcome <em>back.</em>
        </h1>

        <p>
          Sign in to access the Retina staff workspace.
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="email">Email address</label>

          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@example.com"
          />

          <label htmlFor="password">Password</label>

          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button
            className="button button-primary"
            type="submit"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign in to dashboard →"}
          </button>
        </form>

        <small className="login-foot">
          Authorised staff accounts only · Retina Marketing Solution
        </small>
      </section>
    </main>
  );
}
