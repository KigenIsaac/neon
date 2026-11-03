import type { AgentConfig } from "@/types";
import { LLM_PROMPT } from "./prompt";

export const AGENT_CONFIG: AgentConfig = {
  DEEPGRAM_AGENT_URL: "wss://agent.deepgram.com/v1/agent/converse",
  INPUT_SAMPLE_RATE: 24000,
  OUTPUT_SAMPLE_RATE: 24000,
  STT_MODEL: "nova-3",
  TTS_MODEL: "aura-2-zeus-en",
  LLM_PROVIDER: "open_ai",
  LLM_MODEL: "gpt-4o-mini",
  GREETING: "Hello BOSS! I am your NEON assistant. How can I help you today?"
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
            name: "get_current_time",
            description: "Call to read the current time and user's local time zone. Do not guess the time.",
            parameters: { type: "object", properties: {}, additionalProperties: false }
          },
          {
            name: "calculate",
            description: "Call to accurately compute arithmetic expressions. Supports +, -, *, /, %, and parentheses; do not guess calculations.",
            parameters: {
              type: "object", additionalProperties: false,
              properties: { expression: { type: "string", description: "Arithmetic expression, no words" } },
              required: ["expression"]
            }
          },
          {
            name: "find_notes",
            description: "Call to search for a note the user previously asked you to save. Search is private to the authenticated user.",
            parameters: {
              type: "object", additionalProperties: false,
              properties: { query: { type: "string", description: "Search phrase; empty for recent notes" } },
              required: ["query"]
            }
          },
          {
            name: "save_note",
            description: "Call only if the user explicitly asks you to remember or save a note. Always requires an on-screen confirmation. Never save passwords or access tokens.",
            defer_until_eot: true,
            parameters: {
              type: "object", additionalProperties: false,
              properties: { content: { type: "string", description: "Note to remember, up to 600 characters" } },
              required: ["content"]
            }
          },
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