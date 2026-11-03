import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = new URL(req.url).searchParams.get("q") || "";
  const query = raw.trim();
  if (query.length < 2 || query.length > 120) {
    return NextResponse.json(
      { error: "Search text must be between 2 and 120 characters" },
      { status: 400 }
    );
  }
  // Ordinary PostgREST search; SQL LIKE metacharacters must not broaden the
  // query. RLS on turns and ownership join both restrict results to this user.
  const escaped = query.replace(/[\\%_]/g, (char) => "\\" + char);
  const { data, error } = await supabase.from("turns")
    .select("id,conversation_id,role,content,created_at,conversations!inner(user_id)")
    .eq("conversations.user_id", user.id)
    .in("role", ["user", "assistant"])
    .ilike("content", `%${escaped}%`)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) {
    console.error("conversation search failed", error.message);
    return NextResponse.json({ error: "Unable to search history" }, { status: 500 });
  }
  const matches = (data ?? []).map((turn) => ({
    conversation_id: turn.conversation_id,
    role: turn.role,
    content: turn.content.slice(0, 500),
    created_at: turn.created_at
  }));
  return NextResponse.json({ matches }, { headers: { "Cache-Control": "no-store" } });
}
