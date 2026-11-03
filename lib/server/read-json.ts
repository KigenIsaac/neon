import { NextResponse } from "next/server";

/** Read JSON with a hard byte limit *before* parsing the body. */
export async function readBoundedJson(
  req: Request,
  maxBytes: number
): Promise<{ value: unknown; error: NextResponse | null }> {
  if (!req.body) {
    return { value: null, error: NextResponse.json({ error: "Missing JSON body" }, { status: 400 }) };
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return { value: null, error: NextResponse.json({ error: "Request body too large" }, { status: 413 }) };
      }
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { value: null, error: NextResponse.json({ error: "Expected JSON object" }, { status: 400 }) };
    }
    return { value, error: null };
  } catch {
    return { value: null, error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  } finally {
    reader.releaseLock();
  }
}
