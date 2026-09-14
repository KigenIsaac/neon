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

  const { turn_id = null, scene } = await req.json().catch(() => ({}));
  if (!scene || typeof scene !== "object") {
    return NextResponse.json({ error: "Missing scene" }, { status: 400 });
  }

  const { error } = await supabase
    .from("scenes")
    .insert({ conversation_id: id, turn_id, payload: scene });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}