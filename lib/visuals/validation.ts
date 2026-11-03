import type { Scene, SceneBox, SceneKind, SceneLayout } from "@/types";

const LAYOUTS = new Set<SceneLayout>(["hero", "compare", "trio", "metrics", "quad", "radial", "rail"]);
const KINDS = new Set<SceneKind>(["text", "list", "steps", "metric", "chip", "chart", "progress", "table"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function textField(data: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = data[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("Invalid " + key);
  return value.slice(0, max);
}

export function parseScene(value: unknown): Scene | null {
  if (!isRecord(value) || !LAYOUTS.has(value.layout as SceneLayout) ||
      !Array.isArray(value.boxes) || value.boxes.length === 0 || value.boxes.length > 8) {
    return null;
  }
  try {
    const boxes: SceneBox[] = value.boxes.map((raw: unknown) => {
      if (!isRecord(raw) || !KINDS.has(raw.kind as SceneKind)) throw new Error("Invalid box");
      const box: SceneBox = { kind: raw.kind as SceneKind };
      for (const [key, length] of [
        ["id", 64], ["title", 100], ["tag", 32], ["body", 600],
        ["text", 600], ["unit", 20], ["label", 120]
      ] as const) {
        const field = textField(raw, key, length);
        if (field !== undefined) box[key] = field;
      }
      const accent = textField(raw, "accent", 30);
      if (accent && /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(accent)) {
        box.accent = accent;
      }
      if (raw.value !== undefined) {
        if (typeof raw.value === "string") box.value = raw.value.slice(0, 100);
        else if (typeof raw.value === "number" && Number.isFinite(raw.value)) box.value = raw.value;
        else throw new Error("Invalid metric value");
      }
      if (raw.items !== undefined) {
        if (!Array.isArray(raw.items) || raw.items.length > 8 ||
            !raw.items.every((v: unknown) => typeof v === "string")) throw new Error("Invalid items");
        box.items = raw.items.map((v: string) => v.slice(0, 200));
      }
      if (raw.values !== undefined) {
        if (!Array.isArray(raw.values) || raw.values.length > 12 ||
            !raw.values.every((v: unknown) => typeof v === "number" && Number.isFinite(v))) {
          throw new Error("Invalid chart values");
        }
        box.values = raw.values.map((v: number) => Math.max(-1e9, Math.min(1e9, v)));
      }
      if (raw.labels !== undefined) {
        if (!Array.isArray(raw.labels) || raw.labels.length > 12 ||
            !raw.labels.every((v: unknown) => typeof v === "string")) throw new Error("Invalid labels");
        box.labels = raw.labels.map((v: string) => v.slice(0, 100));
      }
      if (raw.rows !== undefined) {
        if (!Array.isArray(raw.rows) || raw.rows.length > 7) throw new Error("Invalid table");
        box.rows = raw.rows.map((row: unknown) => {
          if (Array.isArray(row) && row.length === 2 &&
              row.every((v) => typeof v === "string")) {
            return [row[0].slice(0, 120), row[1].slice(0, 120)] as [string, string];
          }
          if (isRecord(row) && typeof row.label === "string" && typeof row.value === "string") {
            return { label: row.label.slice(0, 120), value: row.value.slice(0, 120) };
          }
          throw new Error("Invalid table row");
        });
      }
      return box;
    });
    return { id: textField(value, "id", 64), layout: value.layout as SceneLayout, boxes };
  } catch {
    return null;
  }
}
