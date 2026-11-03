import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readBoundedJson } from "@/lib/server/read-json";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONTENT_LENGTH = 10000;

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid conversation id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await readBoundedJson(req, 40 * 1024);
  if (parsed.error) return parsed.error;
  const body = parsed.value as { role?: unknown; content?: unknown };
  const role = body?.role;
  const content = body?.content;

  if (role !== "user" && role !== "assistant") {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Empty content" }, { status: 400 });
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: "Content too large" }, { status: 413 });
  }

  const { data, error } = await supabase
    .from("turns")
    .insert({
      conversation_id: id,
      role,
      content: content.trim()
    })
    .select("id")
    .single();

  if (error) {
    console.error("turn persistence failed", error);
    return NextResponse.json(
      { error: "Unable to persist conversation turn" },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: data.id });
}
