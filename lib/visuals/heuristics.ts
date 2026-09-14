import type { Scene } from "@/types";

const ACCENTS = ["#5fd0ff", "#38e8c8", "#a78bfa", "#f5a97f", "#ff7aa2"];

export function inferScene(text: string): Scene | null {
  const s = String(text);
  if (/(I think|I feel|maybe|perhaps|let me|one moment|hold on)/i.test(s)) return null;

  const unitPairs = [
    ...s.matchAll(
      /([A-Z][A-Za-z][A-Za-z ]{1,22}?)\s+(?:is|was|reached|at|of|hit)\s+\$?(\d[\d,.]*(?:\.\d+)?)\s*(%|B|M|K|ms|x|billion|million|thousand|Hz|GB|MB|KB)/g
    )
  ];
  if (unitPairs.length >= 2) {
    return {
      layout: "metrics",
      boxes: unitPairs.slice(0, 4).map((m, i) => ({
        kind: "metric",
        title: m[1].trim(),
        value: m[2],
        unit: m[3],
        label: "Reported figure",
        accent: ACCENTS[i % ACCENTS.length]
      }))
    };
  }

  if (/(compared with|compared to|versus|vs\.?|difference between)/i.test(s)) {
    const parts = s
      .split(/(?:compared with|compared to|versus|vs\.?)/i)
      .map((x) => x.trim())
      .filter((x) => x.length > 12);
    if (parts.length >= 2) {
      return {
        layout: "compare",
        boxes: parts.slice(0, 2).map((p, i) => ({
          kind: "text",
          title: i ? "Comparison" : "Primary",
          body: p.slice(0, 200),
          accent: ACCENTS[i]
        }))
      };
    }
  }

  return null;
}