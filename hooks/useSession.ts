"use client";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoading(true);
    setError("");
    setAttempt((x) => x + 1);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    void (async () => {
      try {
        const result = await supabase.auth.getSession();
        if (result.error) throw result.error;
        if (!mounted) return;
        if (result.data.session) {
          setSession(result.data.session);
          return;
        }
        if (process.env.NEXT_PUBLIC_ENABLE_ANON_AUTH === "false") {
          setError("Anonymous sessions are disabled. A sign-in provider must be configured.");
          return;
        }
        const { data, error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) throw signInError;
        if (!mounted) return;
        setSession(data.session ?? null);
        if (!data.session) setError("Unable to start a session.");
      } catch (err) {
        if (!mounted) return;
        console.error("session initialization failed", err);
        setError("Could not connect to the authentication service.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      if (next) setError("");
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [attempt]);

  return { session, loading, error, retry };
}
