/**
 * Small, explicitly allowlisted client-side tools.
 * No eval, arbitrary HTTP requests, shell access or silent persistent writes.
 */
export function calculateExpression(expression: string): number {
  if (typeof expression !== "string" || expression.length > 120 || !expression.trim()) {
    throw new Error("Expression must be 1–120 characters");
  }
  const tokens: string[] = [];
  const pattern = /\s*([+*/()%\-]|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/gy;
  let pos = 0;
  while (pos < expression.length) {
    pattern.lastIndex = pos;
    const match = pattern.exec(expression);
    if (!match || match[0].length === 0) throw new Error("Unsupported calculation syntax");
    tokens.push(match[1]);
    if (tokens.length > 80) throw new Error("Expression is too complex");
    pos = pattern.lastIndex;
  }
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const finite = (value: number) => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) {
      throw new Error("Result exceeds safe calculation bounds");
    }
    return value;
  };

  const parseValue = (depth: number): number => {
    if (depth > 16) throw new Error("Expression nesting is too deep");
    const token = take();
    if (token === "+" || token === "-") {
      const rhs = parseValue(depth + 1);
      return token === "-" ? -rhs : rhs;
    }
    if (token === "(") {
      const value = parseSum(depth + 1);
      if (take() !== ")") throw new Error("Unmatched parenthesis");
      return value;
    }
    if (!token || !/^(?:\d|\.)/.test(token)) throw new Error("Expected a number");
    return finite(Number(token));
  };
  const parseProduct = (depth: number): number => {
    let result = parseValue(depth);
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = take();
      const rhs = parseValue(depth);
      if ((op === "/" || op === "%") && rhs === 0) throw new Error("Division by zero");
      result = finite(op === "*" ? result * rhs : op === "/" ? result / rhs : result % rhs);
    }
    return result;
  };
  const parseSum = (depth: number): number => {
    let result = parseProduct(depth);
    while (peek() === "+" || peek() === "-") {
      const op = take();
      const rhs = parseProduct(depth);
      result = finite(op === "+" ? result + rhs : result - rhs);
    }
    return result;
  };
  const result = parseSum(0);
  if (cursor !== tokens.length) throw new Error("Unexpected token");
  return Object.is(result, -0) ? 0 : result;
}

export interface ToolOptions {
  signal?: AbortSignal;
  confirmSave: (note: string) => boolean | Promise<boolean>;
}

async function readResponse(res: Response): Promise<Record<string, unknown>> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data && typeof data === "object" && "error" in data
      ? String((data as {error: unknown}).error) : "Request failed";
    throw new Error(message);
  }
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

export async function runAgentTool(
  name: string,
  raw: unknown,
  options: ToolOptions
): Promise<string> {
  const args = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  switch (name) {
    case "calculate": {
      if (typeof args.expression !== "string") throw new Error("Missing expression");
      return JSON.stringify({ result: calculateExpression(args.expression) });
    }
    case "get_current_time": {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const now = new Date();
      return JSON.stringify({
        utc_date_time: now.toISOString(),
        local_date_time: now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" }),
        user_time_zone: zone
      });
    }
    case "find_notes": {
      if (args.query !== undefined && typeof args.query !== "string") {
        throw new Error("Query must be text");
      }
      const q = typeof args.query === "string" ? args.query.trim() : "";
      if (q.length > 120) throw new Error("Query too long");
      const res = await fetch("/api/notes?query=" + encodeURIComponent(q), {
        cache: "no-store", signal: options.signal
      });
      const data = await readResponse(res);
      return JSON.stringify({ notes: data.notes ?? [] });
    }
    case "save_note": {
      const note = typeof args.content === "string" ? args.content.trim() : "";
      if (!note || note.length > 600) throw new Error("Note must be between 1 and 600 characters");
      if (!(await options.confirmSave(note))) return JSON.stringify({ saved: false, reason: "User declined" });
      if (options.signal?.aborted) return JSON.stringify({ saved: false, reason: "Cancelled" });
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: note }),
        signal: options.signal
      });
      const data = await readResponse(res);
      return JSON.stringify({ saved: true, id: data.id });
    }
    default: throw new Error("Unsupported tool: " + name);
  }
}
