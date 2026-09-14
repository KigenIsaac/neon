import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing DEEPGRAM_API_KEY" },
      { status: 500 }
    );
  }

  const res = await fetch(
    "https://api.deepgram.com/v1/auth/grant",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ttl_seconds: 120,
      }),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const normalized = detail.trim();

    return NextResponse.json(
      {
        error: "Deepgram token mint failed",
        detail:
          normalized || "No response body returned by Deepgram.",
        status: res.status,
      },
      { status: res.status }
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };

  return NextResponse.json({
    access_token: data.access_token,
    expires_in: data.expires_in ?? 120,
  });
}