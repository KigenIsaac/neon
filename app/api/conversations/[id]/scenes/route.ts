import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SCENE_BYTES = 64 * 1024;

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

  const body = await req.json().catch(() => null);
  const scene = body?.scene;
  const turnId = body?.turn_id ?? null;

  if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
    return NextResponse.json({ error: "Missing scene" }, { status: 400 });
  }

  if (turnId !== null && (typeof turnId !== "string" || !UUID_RE.test(turnId))) {
    return NextResponse.json({ error: "Invalid turn id" }, { status: 400 });
  }

  let sceneBytes = 0;
  try {
    sceneBytes = new TextEncoder().encode(JSON.stringify(scene)).byteLength;
  } catch {
    return NextResponse.json({ error: "Invalid scene payload" }, { status: 400 });
  }

  if (sceneBytes > MAX_SCENE_BYTES) {
    return NextResponse.json({ error: "Scene payload too large" }, { status: 413 });
  }

  const { error } = await supabase
    .from("scenes")
    .insert({
      conversation_id: id,
      turn_id: turnId,
      payload: scene
    });

  if (error) {
    console.error("scene persistence failed", error);
    return NextResponse.json(
      { error: "Unable to persist scene" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
