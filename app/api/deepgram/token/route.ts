import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    console.error("DEEPGRAM_API_KEY is not configured");
    return NextResponse.json(
      { error: "Voice service is not configured" },
      { status: 500 }
    );
  }

  try {
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
      console.error("Deepgram token mint failed", { status: res.status });
      return NextResponse.json(
        { error: "Unable to start voice service" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      console.error("Deepgram returned no access token");
      return NextResponse.json(
        { error: "Voice service returned an invalid response" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        access_token: data.access_token,
        expires_in: data.expires_in ?? 120,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Deepgram token request failed", error);
    return NextResponse.json(
      { error: "Unable to start voice service" },
      { status: 502 }
    );
  }
}
