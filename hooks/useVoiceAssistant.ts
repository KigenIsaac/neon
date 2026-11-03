"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine } from "@/lib/audio/engine";
import { AGENT_CONFIG, buildSettings, type HistoryTurn } from "@/lib/agent/settings";
import { inferScene } from "@/lib/visuals/heuristics";
import { parseScene } from "@/lib/visuals/validation";
import { runAgentTool } from "@/lib/agent/tools";
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
  thought_signature?: string;
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

export interface UseVoiceAssistantResult {
  started: boolean;
  status: { mode: StatusMode; text: string };
  transcript: string;
  messages: HistoryTurn[];
  greeting: string;
  scene: Scene | null;
  level: number;
  muted: boolean;
  pendingSaveNote: string | null;
  resolveSaveNote: (approved: boolean) => void;
  start: (conversationId?: string) => Promise<void>;
  shutdown: () => void;
  retry: () => Promise<void>;
  toggleMute: () => Promise<void>;
  sendText: (text: string) => boolean;
}

export function useVoiceAssistant(session: Session | null): UseVoiceAssistantResult {
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<{ mode: StatusMode; text: string }>({ mode: "idle", text: "idle" });
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<HistoryTurn[]>([]);
  const [greeting, setGreeting] = useState("");
  const [scene, setScene] = useState<Scene | null>(null);

  const engineRef = useRef<AudioEngine | null>(null);
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [pendingSaveNote, setPendingSaveNote] = useState<string | null>(null);
  const saveDecisionRef = useRef<((approved: boolean) => void) | null>(null);
  const mutedRef = useRef(false);
  const pendingCallsRef = useRef(new Map<string, AbortController>());
  const wsRef = useRef<WebSocket | null>(null);
  const settingsSentRef = useRef(false);
  const listeningRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const recentHistoryRef = useRef<HistoryTurn[]>([]);
  const sceneFromToolRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneStateRef = useRef<SceneState>("idle");
  const lastSceneKeyRef = useRef<string | null>(null);
  const shuttingDownRef = useRef(false);
  const startingRef = useRef(false);
  const connectAgentRef = useRef<(() => Promise<void>) | null>(null);
  const connectInFlightRef = useRef(false);
  const handshakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolveSaveNote = useCallback((approved: boolean) => {
    const decision = saveDecisionRef.current;
    saveDecisionRef.current = null;
    setPendingSaveNote(null);
    decision?.(approved);
  }, []);

  const askSaveNote = useCallback((note: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (saveDecisionRef.current) saveDecisionRef.current(false);
      saveDecisionRef.current = resolve;
      setPendingSaveNote(note);
    }), []);

  const sceneKey = useCallback((s: Scene) => {
    return JSON.stringify(s);
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

  const respondToFunction = useCallback((
    id: string, name: string, content: string, thoughtSignature?: string
  ) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "FunctionCallResponse", id, name, content,
      ...(thoughtSignature ? { thought_signature: thoughtSignature } : {})
    }));
  }, []);

  const handleAgentMessage = useCallback((data: AgentMessage) => {
    switch (data.type) {
      case "Welcome": {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && !settingsSentRef.current) {
          ws.send(JSON.stringify(buildSettings(recentHistoryRef.current)));
          settingsSentRef.current = true;
        }
        break;
      }
      case "SettingsApplied":
        if (handshakeTimeoutRef.current) {
          clearTimeout(handshakeTimeoutRef.current);
          handshakeTimeoutRef.current = null;
        }
        if (!mutedRef.current) {
          void engineRef.current?.startMicrophone();
          listeningRef.current = true;
          setStatus({ mode: "listening", text: "listening..." });
        } else {
          setStatus({ mode: "idle", text: "microphone muted" });
        }
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
          setMessages((previous) => [...previous, { role: "user" as const, content }].slice(-100));
          setStatus({ mode: "thinking", text: "thinking..." });
          persistTurn("user", content);
        } else if (data.role === "assistant") {
          setTranscript(content);
          setMessages((previous) => [...previous, { role: "assistant" as const, content }].slice(-100));
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
      case "FunctionCallCancelled": {
        for (const call of data.functions ?? []) {
          const task = pendingCallsRef.current.get(call.id);
          if (task) {
            task.abort();
            pendingCallsRef.current.delete(call.id);
            if (call.name === "save_note") resolveSaveNote(false);
          }
        }
        break;
      }
      case "FunctionCallRequest": {
        for (const call of data.functions ?? []) {
          if (call.client_side === false || !call.id || !call.name) continue;
          const controller = new AbortController();
          pendingCallsRef.current.set(call.id, controller);
          void (async () => {
            let response: string;
            try {
              const parsed: unknown = typeof call.arguments === "string"
                ? JSON.parse(call.arguments)
                : (call.arguments ?? {});
              if (call.name === "visual_scene") {
                const candidate = parsed && typeof parsed === "object" && "scene" in parsed
                  ? (parsed as VisualSceneArguments).scene : parsed;
                const next = parseScene(candidate);
                if (next && !controller.signal.aborted) {
                  sceneFromToolRef.current = true;
                  illustrate(next);
                  void persistScene(next);
                }
                response = JSON.stringify({ rendered: !!next });
              } else {
                response = await runAgentTool(call.name, parsed, {
                  signal: controller.signal,
                  confirmSave: askSaveNote
                });
              }
            } catch (err) {
              response = JSON.stringify({
                error: err instanceof Error ? err.message : "Tool failed"
              });
            }
            // Deepgram may cancel speculative calls when the user resumes speaking.
            if (!controller.signal.aborted) {
              respondToFunction(call.id, call.name, response, call.thought_signature);
            }
            if (pendingCallsRef.current.get(call.id) === controller) {
              pendingCallsRef.current.delete(call.id);
            }
          })();
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
  }, [illustrate, persistScene, persistTurn, respondToFunction, askSaveNote, resolveSaveNote]);

  const connectAgent = useCallback(async () => {
    if (shuttingDownRef.current || connectInFlightRef.current) return;
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) return;

    connectInFlightRef.current = true;
    setStatus({ mode: "thinking", text: "connecting AI..." });
    settingsSentRef.current = false;

    // Use authenticated, user-scoped saved turns to survive a socket reconnect.
    // Only user/assistant text becomes conversational context, never system prompts.
    const id = conversationIdRef.current;
    if (id) {
      try {
        const historyRes = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
        if (historyRes.ok) {
          const data = await historyRes.json() as { turns?: Array<{role: string; content: string}> };
          recentHistoryRef.current = (data.turns ?? [])
            .filter((turn): turn is HistoryTurn =>
              (turn.role === "user" || turn.role === "assistant") &&
              typeof turn.content === "string"
            )
            .slice(-24);
          setMessages(recentHistoryRef.current);
        }
      } catch (error) {
        console.warn("conversation context unavailable", error);
      }
    }

    if (shuttingDownRef.current) {
      connectInFlightRef.current = false;
      return;
    }

    let token: string;
    try {
      const res = await fetch("/api/deepgram/token", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Voice token request failed (${res.status})`);
      }
      const payload = (await res.json()) as { access_token?: unknown };
      if (typeof payload.access_token !== "string" || !payload.access_token) {
        throw new Error("token endpoint returned an invalid token");
      }
      token = payload.access_token;
    } catch (err) {
      console.error("token fetch failed", err);
      connectInFlightRef.current = false;
      if (shuttingDownRef.current) return;
      setStatus({ mode: "error", text: err instanceof Error ? err.message : "Voice connection failed" });
      return;
    }

    if (shuttingDownRef.current) {
      connectInFlightRef.current = false;
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(AGENT_CONFIG.DEEPGRAM_AGENT_URL, ["bearer", token]);
    } catch (error) {
      connectInFlightRef.current = false;
      console.error("Unable to open voice socket", error);
      setStatus({ mode: "error", text: "Unable to connect. Select Retry." });
      return;
    }
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    connectInFlightRef.current = false;

    ws.onopen = () => {
      if (wsRef.current !== ws || shuttingDownRef.current) return;
      reconnectAttemptsRef.current = 0;
      // Prevent an apparently connected socket from hanging forever
      // when the agent fails to acknowledge the settings handshake.
      if (handshakeTimeoutRef.current) clearTimeout(handshakeTimeoutRef.current);
      handshakeTimeoutRef.current = setTimeout(() => {
        if (wsRef.current === ws && !shuttingDownRef.current) ws.close();
      }, 15000);
    };

    ws.onmessage = async (event) => {
      if (wsRef.current !== ws || shuttingDownRef.current) return;
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
      if (wsRef.current !== ws) return;
      if (handshakeTimeoutRef.current) {
        clearTimeout(handshakeTimeoutRef.current);
        handshakeTimeoutRef.current = null;
      }
      for (const controller of pendingCallsRef.current.values()) controller.abort();
      pendingCallsRef.current.clear();
      resolveSaveNote(false);
      listeningRef.current = false;
      engineRef.current?.stopMicrophone();
      engineRef.current?.stopPlayback();
      wsRef.current = null;

      if (shuttingDownRef.current) return;

      const attempts = reconnectAttemptsRef.current++;
      if (attempts >= 6) {
        setStatus({ mode: "error", text: "Connection lost. Select Retry." });
        return;
      }
      setStatus({ mode: "thinking", text: "reconnecting..." });
      const delay = Math.min(15000, 1000 * Math.pow(1.7, attempts));
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        void connectAgentRef.current?.();
      }, delay);
    };
  }, [handleAgentMessage, resolveSaveNote]);

  useEffect(() => {
    connectAgentRef.current = connectAgent;
    return () => {
      if (connectAgentRef.current === connectAgent) {
        connectAgentRef.current = null;
      }
    };
  }, [connectAgent]);

  const start = useCallback(async (existingConversationId?: string) => {
    if (started || startingRef.current) return;
    if (!session) return;

    startingRef.current = true;
    shuttingDownRef.current = false;
    mutedRef.current = false;
    setMuted(false);
    reconnectAttemptsRef.current = 0;
    conversationIdRef.current = null;
    recentHistoryRef.current = [];
    setMessages([]);
    try {
      if (existingConversationId) {
        const res = await fetch(`/api/conversations/${encodeURIComponent(existingConversationId)}`, {
          cache: "no-store"
        });
        if (!res.ok) throw new Error("Unable to resume that conversation");
        conversationIdRef.current = existingConversationId;
      } else {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Voice session" })
        });
        if (!res.ok) throw new Error("Unable to create conversation");
        const data = await res.json() as { id?: unknown };
        if (typeof data.id !== "string") throw new Error("Invalid conversation ID");
        conversationIdRef.current = data.id;
      }
    } catch (error) {
      startingRef.current = false;
      setStatus({
        mode: "error",
        text: error instanceof Error ? error.message : "History service unavailable"
      });
      return;
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
      setStatus({ mode: "error", text: "Microphone initialization failed" });
      await engine.shutdown();
      if (engineRef.current === engine) engineRef.current = null;
    } finally {
      startingRef.current = false;
    }
  }, [started, session, connectAgent, holdScene, releaseScene]);

  const shutdown = useCallback(() => {
    shuttingDownRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (handshakeTimeoutRef.current) clearTimeout(handshakeTimeoutRef.current);
    if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
    for (const controller of pendingCallsRef.current.values()) controller.abort();
    pendingCallsRef.current.clear();
    resolveSaveNote(false);
    mutedRef.current = false;
    setMuted(false);
    listeningRef.current = false;
    void engineRef.current?.shutdown();
    engineRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setStarted(false);
    setStatus({ mode: "idle", text: "idle" });
    setScene(null);
  }, [resolveSaveNote]);

  const retry = useCallback(async () => {
    if (!started) {
      await start();
      return;
    }
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectAttemptsRef.current = 0;
    await connectAgent();
  }, [started, start, connectAgent]);

  const toggleMute = useCallback(async () => {
    if (!started || !engineRef.current) return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      engineRef.current.stopMicrophone();
      listeningRef.current = false;
      setStatus({ mode: "idle", text: "microphone muted" });
    } else {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        await engineRef.current.startMicrophone();
        listeningRef.current = true;
        setStatus({ mode: "listening", text: "listening..." });
      } else {
        setStatus({ mode: "error", text: "Select Retry to reconnect" });
      }
    }
  }, [started]);

  const sendText = useCallback((raw: string) => {
    const content = raw.trim();
    const ws = wsRef.current;
    if (!content || content.length > 2000 || !ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "InjectUserMessage", content }));
    setTranscript(content);
    setStatus({ mode: "thinking", text: "thinking..." });
    return true;
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

  return { started, status, transcript, messages, greeting, scene, level, muted, pendingSaveNote, resolveSaveNote, start, shutdown, retry, toggleMute, sendText };
}
