"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (session) {
        setSession(session);
        setLoading(false);
        return;
      }
      if (process.env.NEXT_PUBLIC_ENABLE_ANON_AUTH !== "false") {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) console.error("anonymous sign-in failed:", error);
        if (!mounted) return;
        setSession(data.session ?? null);
      }
      if (mounted) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}