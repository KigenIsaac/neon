import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_TITLE_LENGTH = 120;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
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
