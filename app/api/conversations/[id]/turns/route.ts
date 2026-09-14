import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, content } = await req.json().catch(() => ({}));
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Empty content" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("turns")
    .insert({ conversation_id: id, role, content: content.trim() })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}