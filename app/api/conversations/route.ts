import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readBoundedJson } from "@/lib/server/read-json";

const MAX_TITLE_LENGTH = 120;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await readBoundedJson(req, 1024);
  if (parsed.error) return parsed.error;
  const body = parsed.value as { title?: unknown };
  const title =
    body && typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, MAX_TITLE_LENGTH)
      : "Voice session";

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: user.id,
      title
    })
    .select("id")
    .single();

  if (error) {
    console.error("conversation creation failed", error);
    return NextResponse.json(
      { error: "Unable to create conversation" },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: data.id });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.from("conversations")
    .select("id,title,started_at")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("history list failed", error.message);
    return NextResponse.json({ error: "Unable to load conversations" }, { status: 500 });
  }
  return NextResponse.json({ conversations: data ?? [] }, {
    headers: { "Cache-Control": "no-store" }
  });
}
