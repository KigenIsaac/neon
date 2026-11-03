import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readBoundedJson } from "@/lib/server/read-json";

const MAX_NOTE_LENGTH = 600;
const MAX_QUERY_LENGTH = 120;

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const query = (url.searchParams.get("query") || "").trim();
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: "Query too long" }, { status: 400 });
  }

  let builder = supabase.from("notes")
    .select("id,content,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (query) {
    // Escape SQL LIKE wildcards: user input must not expand the search scope.
    const pattern = query.replace(/[\\%_]/g, (c) => "\\" + c);
    builder = builder.ilike("content", `%${pattern}%`);
  }
  const { data, error } = await builder;
  if (error) {
    console.error("notes lookup failed", error.message);
    return NextResponse.json({ error: "Unable to find notes" }, { status: 500 });
  }
  return NextResponse.json({ notes: data ?? [] }, {
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await readBoundedJson(req, 2048);
  if (parsed.error) return parsed.error;
  const content = (parsed.value as {content?: unknown}).content;
  if (typeof content !== "string" || !content.trim() || content.trim().length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: "Note must be between 1 and 600 characters" }, { status: 400 });
  }

  const { data, error } = await supabase.from("notes")
    .insert({ user_id: user.id, content: content.trim() })
    .select("id")
    .single();
  if (error) {
    console.error("note creation failed", error.message);
    return NextResponse.json({ error: "Unable to save note" }, { status: 500 });
  }
  return NextResponse.json({ id: data.id }, { status: 201 });
}
