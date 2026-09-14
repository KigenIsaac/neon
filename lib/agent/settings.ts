import type { AgentConfig } from "@/types";
import { LLM_PROMPT } from "./prompt";

export const AGENT_CONFIG: AgentConfig = {
  DEEPGRAM_AGENT_URL: "wss://agent.deepgram.com/v1/agent/converse",
  INPUT_SAMPLE_RATE: 24000,
  OUTPUT_SAMPLE_RATE: 24000,
  STT_MODEL: "nova-3",
  TTS_MODEL: "aura-2-asteria-en",
  LLM_PROVIDER: "open_ai",
  LLM_MODEL: "gpt-4o-mini",
  GREETING: "Hello sir"
};

export function buildSettings() {
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: AGENT_CONFIG.INPUT_SAMPLE_RATE },
      output: {
        encoding: "linear16",
        sample_rate: AGENT_CONFIG.OUTPUT_SAMPLE_RATE,
        container: "none"
      }
    },
    agent: {
      language: "en",
      listen: {
        provider: { type: "deepgram", model: AGENT_CONFIG.STT_MODEL, smart_format: false }
      },
      think: {
        provider: { type: AGENT_CONFIG.LLM_PROVIDER, model: AGENT_CONFIG.LLM_MODEL },
        prompt: LLM_PROMPT,
        functions: [
          {
            name: "visual_scene",
            description:
              "Render a visual illustration on the user's screen while you speak. " +
              "Call this alongside your spoken answer when a scene would materially " +
              "help the user understand what you are explaining.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                scene: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    layout: {
                      type: "string",
                      enum: ["hero", "compare", "trio", "metrics", "quad", "radial", "rail"]
                    },
                    boxes: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          id: { type: "string" },
                          kind: {
                            type: "string",
                            enum: ["text", "list", "steps", "metric", "chip", "chart", "progress", "table"]
                          },
                          title: { type: "string" },
                          tag: { type: "string" },
                          accent: { type: "string" },
                          body: { type: "string" },
                          items: { type: "array", items: { type: "string" } },
                          value: { type: "string" },
                          unit: { type: "string" },
                          label: { type: "string" },
                          values: { type: "array", items: { type: "number" } },
                          labels: { type: "array", items: { type: "string" } }
                        },
                        required: ["id", "kind", "title", "tag", "accent", "body",
                                   "items", "value", "unit", "label", "values", "labels"]
                      }
                    }
                  },
                  required: ["id", "layout", "boxes"]
                }
              },
              required: ["scene"]
            }
          }
        ]
      },
      speak: { provider: { type: "deepgram", model: AGENT_CONFIG.TTS_MODEL } },
      greeting: AGENT_CONFIG.GREETING
    },
    flags: { history: true }
  };
}