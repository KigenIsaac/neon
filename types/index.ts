export type StatusMode = "idle" | "listening" | "thinking" | "speaking" | "error";

export type SceneLayout =
  | "hero" | "compare" | "trio" | "metrics" | "quad" | "radial" | "rail";

export type SceneKind =
  | "text" | "list" | "steps" | "metric"
  | "chip" | "chart" | "progress" | "table";

export interface SceneBox {
  id?: string;
  kind: SceneKind;
  title?: string;
  tag?: string;
  accent?: string;
  body?: string;
  text?: string;
  items?: string[];
  rows?: Array<[string, string] | { label: string; value: string }>;
  value?: string | number;
  unit?: string;
  label?: string;
  values?: number[];
  labels?: string[];
}

export interface Scene {
  id?: string;
  layout: SceneLayout;
  boxes: SceneBox[];
}

export interface AgentConfig {
  DEEPGRAM_AGENT_URL: string;
  INPUT_SAMPLE_RATE: number;
  OUTPUT_SAMPLE_RATE: number;
  STT_MODEL: string;
  TTS_MODEL: string;
  LLM_PROVIDER: string;
  LLM_MODEL: string;
  GREETING: string;
}