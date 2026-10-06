"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine } from "@/lib/audio/engine";
import { AGENT_CONFIG, buildSettings } from "@/lib/agent/settings";
import { inferScene } from "@/lib/visuals/heuristics";
import type { Scene, StatusMode } from "@/types";
import type { Session } from "@supabase/supabase-js";

const IDLE_MS = 20000;
const TAIL_MS = 4000;
const MAX_HOLD_MS = 120000;

type SceneState = "idle" | "held" | "tail";

interface AgentFunctionCall {
  id: string;
  name: string;
  client_side?: boolean;
  arguments?: string | Record<string, unknown>;
}

interface AgentMessage {
  type?: string;
  content?: string;
  role?: string;
  description?: string;
  message?: string;
  code?: string | number;
  error?: { message?: string; description?: string };
  functions?: AgentFunctionCall[];
}

interface VisualSceneArguments {
  scene?: unknown;
}

function isScene(value: unknown): value is Scene {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { layout?: unknown; boxes?: unknown };
  return (
    typeof candidate.layout === "string" &&
    Array.isArray(candidate.boxes)
  );
}

export interface UseVoiceAssistantResult {
  started: boolean;
  status: { mode: StatusMode; text: string };
  transcript: string;
  greeting: string;
  scene: Scene | null;
  level: number;
  start: () => Promise<void>;
  shutdown: () => void;
}

export function useVoiceAssistant(session: Session | null): UseVoiceAssistantResult {
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<{ mode: StatusMode; text: string }>({ mode: "idle", text: "idle" });
  const [transcript, setTranscript] = useState("");
  const [greeting, setGreeting] = useState("");
  const [scene, setScene] = useState<Scene | null>(null);

  const engineRef = useRef<AudioEngine | null>(null);
  const [level, setLevel] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const settingsSentRef = useRef(false);
  const listeningRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const sceneFromToolRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneStateRef = useRef<SceneState>("idle");
  const lastSceneKeyRef = useRef<string | null>(null);
  const shuttingDownRef = useRef(false);
  const startingRef = useRef(false);
  const connectAgentRef = useRef<(() => Promise<void>) | null>(null);

  const sceneKey = useCallback((s: Scene) => {
    const sig = (s.boxes || [])
      .map((b) => `${b.kind}:${b.title ?? ""}:${b.value ?? ""}`)
      .join("|");
    return `${s.id ?? ""}#${s.layout}#${sig}`;
  }, []);

  const armHoldCap = useCallback(() => {
    if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
    sceneTimerRef.current = setTimeout(() => {
      sceneTimerRef.current = null;
      if (sceneStateRef.current !== "held") return;
      sceneStateRef.current = "tail";
      sceneTimerRef.current = setTimeout(() => {
        sceneTimerRef.current = null;
        setScene(null);
        lastSceneKeyRef.current = null;
        sceneStateRef.current = "idle";
      }, TAIL_MS);
    }, MAX_HOLD_MS);
  }, []);

  const illustrate = useCallback((next: Scene) => {
    const key = sceneKey(next);
    if (key === lastSceneKeyRef.current && scene) return;
    lastSceneKeyRef.current = key;
    setScene(next);
    if (sceneStateRef.current === "held") {
      armHoldCap();
    } else {
      sceneStateRef.current = "idle";
      if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
      sceneTimerRef.current = setTimeout(() => {
        sceneTimerRef.current = null;
        setScene(null);
        lastSceneKeyRef.current = null;
        sceneStateRef.current = "idle";
      }, IDLE_MS);
    }
  }, [scene, sceneKey, armHoldCap]);

  const holdScene = useCallback(() => {
    if (!scene) return;
    sceneStateRef.current = "held";
    armHoldCap();
  }, [scene, armHoldCap]);

  const releaseScene = useCallback(() => {
    if (sceneStateRef.current !== "held") return;
    sceneStateRef.current = "tail";
    if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
    sceneTimerRef.current = setTimeout(() => {
      sceneTimerRef.current = null;
      setScene(null);
      lastSceneKeyRef.current = null;
      sceneStateRef.current = "idle";
    }, TAIL_MS);
  }, []);

  const persistTurn = useCallback(async (role: "user" | "assistant", content: string) => {
    const id = conversationIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/conversations/${id}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content })
      });
    } catch (err) {
      console.warn("turn persist failed", err);
    }
  }, []);

  const persistScene = useCallback(async (next: Scene) => {
    const id = conversationIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/conversations/${id}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene: next })
      });
    } catch (err) {
      console.warn("scene persist failed", err);
    }
  }, []);

  const respondToFunction = useCallback((id: string, name: string, content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "FunctionCallResponse", id, name, content }));
  }, []);

  const handleAgentMessage = useCallback((data: AgentMessage) => {
    switch (data.type) {
      case "Welcome": {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && !settingsSentRef.current) {
          ws.send(JSON.stringify(buildSettings()));
          settingsSentRef.current = true;
        }
        break;
      }
      case "SettingsApplied":
        engineRef.current?.startMicrophone();
        listeningRef.current = true;
        setStatus({ mode: "listening", text: "listening..." });
        break;
      case "UserStartedSpeaking":
        engineRef.current?.stopPlayback();
        sceneFromToolRef.current = false;
        setStatus({ mode: "listening", text: "listening..." });
        break;
      case "ConversationText": {
        const content = typeof data.content === "string" ? data.content.trim() : "";
        if (!content) return;
        if (data.role === "user") {
          setTranscript(content);
          setStatus({ mode: "thinking", text: "thinking..." });
          persistTurn("user", content);
        } else if (data.role === "assistant") {
          setTranscript(content);
          setStatus({ mode: "speaking", text: "speaking..." });
          persistTurn("assistant", content);
          if (!sceneFromToolRef.current) {
            const inferred = inferScene(content);
            if (inferred) {
              illustrate(inferred);
              persistScene(inferred);
            }
          }
        }
        break;
      }
      case "AgentThinking":
        setStatus({ mode: "thinking", text: "thinking..." });
        break;
      case "AgentStartedSpeaking":
        setStatus({ mode: "speaking", text: "speaking..." });
        break;
      case "AgentAudioDone":
        engineRef.current?.signalServerDone();
        break;
      case "FunctionCallRequest": {
        const calls = data.functions ?? [];
        for (const call of calls) {
          if (call.client_side === false) continue;
          if (call.name === "visual_scene") {
            let parsed: VisualSceneArguments | Scene | null = null;
            try {
              const raw = typeof call.arguments === "string"
                ? JSON.parse(call.arguments)
                : call.arguments;
              parsed = raw as VisualSceneArguments | Scene | null;
            } catch (err) {
              console.warn("visual_scene parse error", err);
            }

            const candidate =
              parsed && typeof parsed === "object" && "scene" in parsed
                ? (parsed as VisualSceneArguments).scene
                : parsed;

            const nextScene = isScene(candidate) ? candidate : null;
            sceneFromToolRef.current = true;

            if (nextScene) {
              illustrate(nextScene);
              persistScene(nextScene);
            }

            respondToFunction(
              call.id,
              call.name,
              nextScene ? "rendered" : "skipped"
            );
            continue;
          }

          respondToFunction(call.id, call.name, "ok");
        }
        break;
      }
      case "Error": {
        const message =
          data.description ||
          data.message ||
          data.error?.message ||
          data.error?.description ||
          (data.code ? `AI error (${data.code})` : "AI error");
        setTranscript(message);
        setStatus({ mode: "error", text: message });
        break;
      }
    }
  }, [illustrate, persistScene, persistTurn, respondToFunction]);

  const connectAgent = useCallback(async () => {
    if (shuttingDownRef.current) return;
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) return;

    setStatus({ mode: "thinking", text: "connecting AI..." });
    settingsSentRef.current = false;

    let token: string;
    try {
      const res = await fetch("/api/deepgram/token", { method: "POST" });
      if (!res.ok) throw new Error(`token endpoint ${res.status}`);
      const payload = (await res.json()) as { access_token?: unknown };
      if (typeof payload.access_token !== "string" || !payload.access_token) {
        throw new Error("token endpoint returned an invalid token");
      }
      token = payload.access_token;
    } catch (err) {
      console.error("token fetch failed", err);
      setStatus({ mode: "error", text: "token fetch failed" });
      return;
    }

    const ws = new WebSocket(AGENT_CONFIG.DEEPGRAM_AGENT_URL, ["bearer", token]);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => { reconnectAttemptsRef.current = 0; };

    ws.onmessage = async (event) => {
      if (typeof event.data !== "string") {
        const buf = event.data instanceof ArrayBuffer
          ? event.data
          : event.data instanceof Blob
            ? await event.data.arrayBuffer()
            : null;
        if (buf) engineRef.current?.playPCM(buf);
        return;
      }

      let parsed: AgentMessage;
      try {
        parsed = JSON.parse(event.data) as AgentMessage;
      } catch {
        return;
      }
      handleAgentMessage(parsed);
    };

    ws.onerror = (err) => console.error("ws error", err);

    ws.onclose = () => {
      listeningRef.current = false;
      engineRef.current?.stopMicrophone();
      engineRef.current?.stopPlayback();
      wsRef.current = null;

      if (shuttingDownRef.current) return;

      setStatus({ mode: "error", text: "reconnecting..." });
      const attempts = reconnectAttemptsRef.current++;
      const delay = Math.min(15000, 1000 * Math.pow(1.7, attempts));

      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        connectAgentRef.current?.();
      }, delay);
    };
  }, [handleAgentMessage]);

  useEffect(() => {
    connectAgentRef.current = connectAgent;
    return () => {
      if (connectAgentRef.current === connectAgent) {
        connectAgentRef.current = null;
      }
    };
  }, [connectAgent]);

  const start = useCallback(async () => {
    if (started || startingRef.current) return;
    if (!session) return;

    startingRef.current = true;
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Voice session" })
      });
      if (res.ok) {
        const data = (await res.json()) as { id?: unknown };
        if (typeof data.id === "string") {
          conversationIdRef.current = data.id;
        }
      }
    } catch (err) {
      console.warn("conversation create failed", err);
    }

    const engine = new AudioEngine({
      onMicChunk: (buf) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try { ws.send(buf); } catch {}
      },
      onInputLevel: (lvl) => {
        setLevel(lvl ?? 0);
      },
      onSpeakingChange: (speaking) => {
        if (speaking) holdScene();
        else releaseScene();
      },
      onDrained: () => {
        if (listeningRef.current) {
          setStatus({ mode: "listening", text: "listening..." });
        }
      }
    });
    engineRef.current = engine;

    try {
      await engine.initialize();
      setGreeting("");
      setStarted(true);
      setStatus({ mode: "thinking", text: "starting..." });
      await connectAgent();
    } catch (err) {
      console.error("start error", err);
      setStatus({ mode: "error", text: "initialization failed" });
    } finally {
      startingRef.current = false;
    }
  }, [started, session, connectAgent, holdScene, releaseScene]);

  const shutdown = useCallback(() => {
    shuttingDownRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
    engineRef.current?.shutdown();
    engineRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setStarted(false);
  }, []);

  useEffect(() => {
    const handlePageHide = () => shutdown();
    const handleBeforeUnload = () => shutdown();

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      shutdown();
    };
  }, [shutdown]);

  return { started, status, transcript, greeting, scene, level, start, shutdown };
}
