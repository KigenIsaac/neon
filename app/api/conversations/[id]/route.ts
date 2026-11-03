import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid conversation ID" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: conversation, error: ownershipError } = await supabase
    .from("conversations").select("id,title")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (ownershipError) {
    return NextResponse.json({ error: "Unable to load conversation" }, { status: 500 });
  }
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  // Never inject database 'system' turns into the LLM's system context.
  const { data, error } = await supabase.from("turns")
    .select("id,role,content,created_at")
    .eq("conversation_id", id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(24);
  if (error) {
    console.error("conversation history load failed", error.message);
    return NextResponse.json({ error: "Unable to load conversation" }, { status: 500 });
  }
  return NextResponse.json({
    conversation, turns: (data ?? []).reverse()
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid conversation ID" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { error } = await supabase.from("conversations").delete()
    .eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Unable to remove conversation" }, { status: 500 });
  return new Response(null, { status: 204 });
}
