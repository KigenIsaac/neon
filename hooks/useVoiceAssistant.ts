"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentMicrophone, AgentPlayer, AgentSession } from "@deepgram/agents";
import type { AgentSessionConfig } from "@deepgram/agents";
import {
  DEEPGRAM_INPUT_RATE, DEEPGRAM_OUTPUT_RATE,
  DEEPGRAM_MICROPHONE_OPTIONS, DEEPGRAM_RECONNECT_OPTIONS,
  appearsToBeLatePacket, type PlaybackDiagnostics
} from "@/lib/audio/sdk-profile";
import { buildSettings, type HistoryTurn } from "@/lib/agent/settings";
import { inferScene } from "@/lib/visuals/heuristics";
import { parseScene } from "@/lib/visuals/validation";
import { runAgentTool } from "@/lib/agent/tools";
import type { Scene, StatusMode } from "@/types";
import type { Session } from "@supabase/supabase-js";

const IDLE_MS = 20000;
const TAIL_MS = 4000;
const MAX_HOLD_MS = 120000;

/** The vendor SDK owns WebSocket reconnects, capture, and output playback. */
type SceneState = "idle" | "held" | "tail";
interface VisualSceneArguments { scene?: unknown; }
interface ClientFunctionCall {
  id?: string;
  name: string;
  client_side?: boolean;
  arguments?: string | Record<string, unknown>;
  input?: string;
}
export interface UseVoiceAssistantResult {
  started: boolean;
  status: { mode: StatusMode; text: string };
  transcript: string;
  messages: HistoryTurn[];
  lastLatencyMs: number | null;
  audioDiagnostics: PlaybackDiagnostics | null;
  microphoneDevice: string | null;
  speechInterruptions: number;
  storageWarning: boolean;
  greeting: string;
  scene: Scene | null;
  level: number;
  muted: boolean;
  pendingSaveNote: string | null;
  resolveSaveNote: (approved: boolean) => void;
  start: (conversationId?: string, mode?: "voice" | "text") => Promise<void>;
  shutdown: () => void;
  retry: () => Promise<void>;
  toggleMute: () => Promise<void>;
  sendText: (text: string) => boolean;
}

async function getScopedAgentToken(): Promise<string> {
  const response = await fetch("/api/deepgram/token", { method: "POST", cache: "no-store" });
  const payload: unknown = await response.json().catch(() => ({}));
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Voice token request failed (HTTP " + response.status + ")");
  }
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("Deepgram returned an invalid voice token");
  }
  return body.access_token;
}

export function useVoiceAssistant(session: Session | null): UseVoiceAssistantResult {
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<{ mode: StatusMode; text: string }>({ mode: "idle", text: "idle" });
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<HistoryTurn[]>([]);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [audioDiagnostics, setAudioDiagnostics] = useState<PlaybackDiagnostics | null>(null);
  const [microphoneDevice, setMicrophoneDevice] = useState<string | null>(null);
  const [speechInterruptions, setSpeechInterruptions] = useState(0);
  const [storageWarning, setStorageWarning] = useState(false);
  const [greeting, setGreeting] = useState("");
  const [scene, setScene] = useState<Scene | null>(null);
  const sceneRef = useRef<Scene | null>(null);

  const sdkSessionRef = useRef<AgentSession | null>(null);
  const micRef = useRef<AgentMicrophone | null>(null);
  const playerRef = useRef<AgentPlayer | null>(null);
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [pendingSaveNote, setPendingSaveNote] = useState<string | null>(null);
  const saveDecisionRef = useRef<((approved: boolean) => void) | null>(null);
  const mutedRef = useRef(false);
  const textOnlyRef = useRef(false);
  const agentReadyRef = useRef(false);
  const agentSpeakingRef = useRef(false);
  const pendingCallsRef = useRef(new Map<string, AbortController>());
  const meterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackDrainRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAudioAtRef = useRef(0);
  const latePacketsRef = useRef(0);
  const lastTelemetryAtRef = useRef(0);
  const connectionEpochRef = useRef(0);
  const conversationIdRef = useRef<string | null>(null);
  const recentHistoryRef = useRef<HistoryTurn[]>([]);
  const sceneFromToolRef = useRef(false);
  const sceneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneStateRef = useRef<SceneState>("idle");
  const lastSceneKeyRef = useRef<string | null>(null);
  const shuttingDownRef = useRef(false);
  const startingRef = useRef(false);

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
        sceneRef.current = null;
        sceneRef.current = null;
        setScene(null);
        lastSceneKeyRef.current = null;
        sceneStateRef.current = "idle";
      }, TAIL_MS);
    }, MAX_HOLD_MS);
  }, []);

  const illustrate = useCallback((next: Scene) => {
    const key = sceneKey(next);
    if (key === lastSceneKeyRef.current && sceneRef.current) return;
    lastSceneKeyRef.current = key;
    sceneRef.current = next;
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
  }, [sceneKey, armHoldCap]);

  const holdScene = useCallback(() => {
    if (!sceneRef.current) return;
    sceneStateRef.current = "held";
    armHoldCap();
  }, [armHoldCap]);

  const releaseScene = useCallback(() => {
    if (sceneStateRef.current !== "held") return;
    sceneStateRef.current = "tail";
    if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
    sceneTimerRef.current = setTimeout(() => {
      sceneTimerRef.current = null;
      sceneRef.current = null;
      setScene(null);
      lastSceneKeyRef.current = null;
      sceneStateRef.current = "idle";
    }, TAIL_MS);
  }, []);

  const persistTurn = useCallback(async (role: "user" | "assistant", content: string) => {
    const id = conversationIdRef.current;
    if (!id) return;
    try {
      const result = await fetch(`/api/conversations/${id}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content })
      });
      if (!result.ok) throw new Error(`Turn storage returned HTTP ${result.status}`);
    } catch (err) {
      console.warn("turn persist failed", err);
      setStorageWarning(true);
    }
  }, []);

  const persistScene = useCallback(async (next: Scene) => {
    const id = conversationIdRef.current;
    if (!id) return;
    try {
      const result = await fetch(`/api/conversations/${id}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene: next })
      });
      if (!result.ok) throw new Error(`Scene storage returned HTTP ${result.status}`);
    } catch (err) {
      console.warn("scene persist failed", err);
      setStorageWarning(true);
    }
  }, []);


  const abortPendingCalls = useCallback(() => {
    for (const controller of pendingCallsRef.current.values()) controller.abort();
    pendingCallsRef.current.clear();
    resolveSaveNote(false);
  }, [resolveSaveNote]);

  const clearDrainTimer = useCallback(() => {
    if (playbackDrainRef.current) clearTimeout(playbackDrainRef.current);
    playbackDrainRef.current = null;
  }, []);

  const cleanupAgent = useCallback(() => {
    connectionEpochRef.current++;
    agentReadyRef.current = false;
    agentSpeakingRef.current = false;
    clearDrainTimer();
    if (meterTimerRef.current) clearInterval(meterTimerRef.current);
    meterTimerRef.current = null;
    abortPendingCalls();
    const mic = micRef.current;
    micRef.current = null;
    mic?.stop(); // Unlike SDK mute(), this actually releases the hardware.
    const sdk = sdkSessionRef.current;
    sdkSessionRef.current = null;
    if (sdk) {
      sdk.removeAllListeners();
      sdk.disconnect(); // Cancels the SDK's own retry/heartbeat machinery.
    }
    const player = playerRef.current;
    playerRef.current = null;
    player?.dispose();
    setMicrophoneDevice(null);
    setLevel(0);
  }, [abortPendingCalls, clearDrainTimer]);

  const connectAgent = useCallback(async () => {
    if (shuttingDownRef.current || sdkSessionRef.current) return;
    const epoch = ++connectionEpochRef.current;
    const current = (sdk: AgentSession) =>
      !shuttingDownRef.current &&
      connectionEpochRef.current === epoch &&
      sdkSessionRef.current === sdk;

    // Historical messages are loaded once for resume/manual retry.
    // AgentSession itself accumulates and restores new conversation context on
    // automatic reconnects, avoiding our previous duplicate reconnect logic.
    const id = conversationIdRef.current;
    if (id) {
      try {
        const response = await fetch("/api/conversations/" + encodeURIComponent(id), { cache: "no-store" });
        if (response.ok) {
          const data = await response.json() as { turns?: Array<{role: string; content: string}> };
          recentHistoryRef.current = (data.turns ?? [])
            .filter((turn): turn is HistoryTurn =>
              (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string")
            .slice(-24);
          setMessages(recentHistoryRef.current);
        }
      } catch (error) {
        console.warn("Could not restore saved conversation", error);
      }
    }
    if (shuttingDownRef.current || connectionEpochRef.current !== epoch) return;

    const agentSettings = buildSettings(recentHistoryRef.current);
    const config: AgentSessionConfig = {
      auth: { tokenFactory: getScopedAgentToken },
      agent: agentSettings.agent as unknown as AgentSessionConfig["agent"],
      audio: {
        input: { encoding: "linear16", sampleRate: DEEPGRAM_INPUT_RATE },
        output: { encoding: "linear16", sampleRate: DEEPGRAM_OUTPUT_RATE }
      },
      keepAliveInterval: 10000,
      reconnect: { ...DEEPGRAM_RECONNECT_OPTIONS }
    };

    const sdk = new AgentSession(config);
    const mic = new AgentMicrophone((buffer) => {
      if (current(sdk) && agentReadyRef.current && !mutedRef.current) {
        sdk.sendAudio(buffer);
      }
    }, { ...DEEPGRAM_MICROPHONE_OPTIONS });
    // Construct on the original user gesture wherever possible. The SDK
    // owns its own native PCM queue, automatic resampling, and cancellation.
    const player = playerRef.current ?? new AgentPlayer({ sampleRate: DEEPGRAM_OUTPUT_RATE });
    playerRef.current = player;
    sdkSessionRef.current = sdk;
    micRef.current = mic;
    setStatus({ mode: "thinking", text: "connecting with Deepgram..." });

    const diagnostics = () => {
      const remaining = player.getRemainingPlaybackTime() * 1000;
      setAudioDiagnostics({
        outputSampleRate: DEEPGRAM_OUTPUT_RATE,
        queuedMs: Math.max(0, Math.round(remaining)),
        packetGaps: latePacketsRef.current,
        outputLatencyMs: null
      });
    };
    const markAudioFinished = () => {
      if (!current(sdk)) return;
      agentSpeakingRef.current = false;
      setLevel(0);
      releaseScene();
      if (!mutedRef.current) {
        setStatus({ mode: "listening", text: "listening..." });
      } else {
        setStatus({ mode: "idle", text: textOnlyRef.current ? "text mode" : "microphone muted" });
      }
      diagnostics();
    };
    const checkDrain = () => {
      if (!current(sdk)) return;
      const remaining = player.getRemainingPlaybackTime();
      if (remaining > 0.025) {
        playbackDrainRef.current = setTimeout(checkDrain, Math.min(300, Math.max(25, remaining * 500)));
      } else {
        playbackDrainRef.current = null;
        markAudioFinished();
      }
    };

    sdk.on("connected", () => {
      if (current(sdk)) setStatus({ mode: "thinking", text: "initializing voice agent..." });
    });
    sdk.on("reconnecting", (attempt) => {
      if (!current(sdk)) return;
      agentReadyRef.current = false;
      agentSpeakingRef.current = false;
      mic.stop();
      player.interrupt();
      clearDrainTimer();
      abortPendingCalls();
      setMicrophoneDevice(null);
      setStatus({ mode: "thinking", text: "reconnecting to Deepgram (attempt " + attempt + ")..." });
    });
    sdk.on("settings-applied", () => {
      if (!current(sdk)) return;
      agentReadyRef.current = true;
      if (mutedRef.current) {
        setStatus({ mode: "idle", text: textOnlyRef.current ? "text mode" : "microphone muted" });
        return;
      }
      void mic.start().then(() => {
        if (!current(sdk) || mutedRef.current) { mic.stop(); return; }
        setMicrophoneDevice("Browser-selected microphone");
        setStatus({ mode: "listening", text: "listening..." });
      }).catch((err: unknown) => {
        if (!current(sdk)) return;
        console.warn("Deepgram microphone unavailable", err);
        mutedRef.current = true;
        setMuted(true);
        setMicrophoneDevice(null);
        setStatus({ mode: "idle", text: "microphone unavailable; use keyboard input" });
      });
    });
    sdk.on("audio", (chunk) => {
      if (!current(sdk)) return;
      const now = performance.now();
      const wasSpeaking = agentSpeakingRef.current;
      const queuedBefore = player.getRemainingPlaybackTime() * 1000;
      if (lastAudioAtRef.current &&
          appearsToBeLatePacket(now - lastAudioAtRef.current, queuedBefore, wasSpeaking)) {
        latePacketsRef.current++;
      }
      lastAudioAtRef.current = now;
      try {
        player.queue(chunk);
        if (!wasSpeaking) {
          agentSpeakingRef.current = true;
          holdScene();
        }
        setStatus({ mode: "speaking", text: "speaking..." });
      } catch (error) {
        console.error("Deepgram AgentPlayer playback failed", error);
        setStatus({ mode: "error", text: "Unable to play audio on this device" });
      }
      if (now - lastTelemetryAtRef.current > 300) {
        lastTelemetryAtRef.current = now;
        diagnostics();
      }
    });
    sdk.on("user-started-speaking", () => {
      if (!current(sdk)) return;
      if (player.getRemainingPlaybackTime() > 0.02) {
        setSpeechInterruptions((count) => count + 1);
      }
      player.interrupt();
      clearDrainTimer();
      agentSpeakingRef.current = false;
      sceneFromToolRef.current = false;
      abortPendingCalls();
      releaseScene();
      setStatus({ mode: "listening", text: "listening..." });
    });
    sdk.on("conversation-text", (data) => {
      if (!current(sdk)) return;
      const content = typeof data.content === "string" ? data.content.trim() : "";
      if (!content) return;
      if (data.role !== "user" && data.role !== "assistant") return;
      setTranscript(content);
      setMessages((old) => [...old, { role: data.role as "user" | "assistant", content }].slice(-100));
      void persistTurn(data.role as "user" | "assistant", content);
      if (data.role === "user") {
        setStatus({ mode: "thinking", text: "thinking..." });
      } else {
        if (!sceneFromToolRef.current) {
          const inferred = inferScene(content);
          if (inferred) {
            illustrate(inferred);
            void persistScene(inferred);
          }
        }
        setStatus({ mode: "speaking", text: "speaking..." });
      }
    });
    sdk.on("agent-thinking", () => {
      if (current(sdk)) setStatus({ mode: "thinking", text: "thinking..." });
    });
    sdk.on("agent-started-speaking", () => {
      if (current(sdk)) setStatus({ mode: "speaking", text: "speaking..." });
    });
    sdk.on("agent-audio-done", () => {
      if (!current(sdk)) return;
      clearDrainTimer();
      checkDrain();
    });
    sdk.on("latency-report", (data) => {
      if (!current(sdk)) return;
      const report = data as unknown as { total_latency?: number };
      if (typeof report.total_latency === "number" &&
          Number.isFinite(report.total_latency) &&
          report.total_latency >= 0 && report.total_latency < 120) {
        setLastLatencyMs(Math.round(report.total_latency * 1000));
      }
    });
    sdk.on("function-call-request", (data) => {
      if (!current(sdk)) return;
      for (const item of data.functions ?? []) {
        const call = item as unknown as ClientFunctionCall;
        if (call.client_side === false || !call.name) continue;
        const id = call.id || "";
        const controller = new AbortController();
        if (id) pendingCallsRef.current.set(id, controller);
        void (async () => {
          let response = "";
          try {
            const raw = call.arguments ?? call.input ?? "{}";
            const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (call.name === "visual_scene") {
              const candidate = parsed && typeof parsed === "object" && "scene" in parsed
                ? (parsed as VisualSceneArguments).scene : parsed;
              const scene = parseScene(candidate);
              if (scene && !controller.signal.aborted && current(sdk)) {
                sceneFromToolRef.current = true;
                illustrate(scene);
                void persistScene(scene);
              }
              response = JSON.stringify({ rendered: !!scene });
            } else {
              response = await runAgentTool(call.name, parsed, {
                signal: controller.signal,
                confirmSave: askSaveNote
              });
            }
          } catch (error) {
            response = JSON.stringify({ error: error instanceof Error ? error.message : "Tool failed" });
          }
          if (current(sdk) && !controller.signal.aborted) {
            sdk.sendFunctionCallResponse(call.id, call.name, response);
          }
          if (id && pendingCallsRef.current.get(id) === controller) pendingCallsRef.current.delete(id);
        })();
      }
    });
    sdk.on("error", (data) => {
      if (!current(sdk)) return;
      const message = (data as { description?: string; message?: string }).description ||
        (data as { message?: string }).message || "Deepgram voice agent error";
      setStatus({ mode: "error", text: message });
    });
    sdk.on("warning", (data) => {
      if (current(sdk)) console.warn("Deepgram agent warning", data);
    });
    sdk.on("sdk-error", (error) => {
      if (!current(sdk)) return;
      console.error("Deepgram SDK error", error);
      setStatus({ mode: "error", text: error.message || "Voice connection error" });
    });
    sdk.on("disconnected", (reason) => {
      if (!current(sdk)) return;
      agentReadyRef.current = false;
      mic.stop();
      player.interrupt();
      clearDrainTimer();
      abortPendingCalls();
      setStatus({ mode: "error", text: "Voice disconnected: " + reason + ". Select Retry." });
    });
    mic.on("error", (err) => {
      if (current(sdk)) console.warn("Deepgram microphone error", err);
    });

    if (meterTimerRef.current) clearInterval(meterTimerRef.current);
    meterTimerRef.current = setInterval(() => {
      if (!current(sdk)) return;
      const reading = player.getRemainingPlaybackTime() > 0.03
        ? player.getOutputVolume() : (mutedRef.current ? 0 : mic.getInputVolume());
      setLevel(Math.max(0, Math.min(1, Number.isFinite(reading) ? reading : 0)));
    }, 65);

    try {
      // AgentSession owns auth, socket, settings handshake, retries and keepalive.
      await sdk.connect();
    } catch (error) {
      if (!current(sdk)) return;
      console.error("Deepgram connection failed", error);
      setStatus({ mode: "error", text: error instanceof Error ? error.message : "Connection failed" });
    }
  }, [abortPendingCalls, askSaveNote, clearDrainTimer, holdScene, illustrate, persistScene, persistTurn, releaseScene]);

  const start = useCallback(async (existingConversationId?: string, mode: "voice" | "text" = "voice") => {
    if (startingRef.current || started || !session) return;
    startingRef.current = true;
    shuttingDownRef.current = false;
    mutedRef.current = mode === "text";
    textOnlyRef.current = mode === "text";
    setMuted(mode === "text");
    setMessages([]);
    setTranscript("");
    setGreeting("");
    setStorageWarning(false);
    setLastLatencyMs(null);
    setAudioDiagnostics(null);
    setSpeechInterruptions(0);
    setMicrophoneDevice(null);
    latePacketsRef.current = 0;
    lastAudioAtRef.current = 0;
    lastTelemetryAtRef.current = 0;
    recentHistoryRef.current = [];
    conversationIdRef.current = null;

    // Unlock output as part of this actual button click, before the first
    // await. This prevents delayed-TTS AudioContext creation from being
    // blocked by desktop autoplay policies.
    try {
      const player = new AgentPlayer({ sampleRate: DEEPGRAM_OUTPUT_RATE });
      player.setVolume(0.95);
      player.queue(new Int16Array(240).buffer); // 10ms silence, no audible sound
      playerRef.current = player;
    } catch (error) {
      console.warn("Unable to initialize Deepgram output on initial gesture", error);
    }

    try {
      if (existingConversationId) {
        const response = await fetch("/api/conversations/" + encodeURIComponent(existingConversationId), {
          cache: "no-store"
        });
        if (!response.ok) throw new Error("Unable to resume that conversation");
        conversationIdRef.current = existingConversationId;
      } else {
        const response = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Voice session" })
        });
        if (!response.ok) throw new Error("Unable to create conversation");
        const data = await response.json() as { id?: unknown };
        if (typeof data.id !== "string") throw new Error("Missing conversation identifier");
        conversationIdRef.current = data.id;
      }
      setStarted(true);
      await connectAgent();
    } catch (error) {
      if (!shuttingDownRef.current) {
        setStatus({ mode: "error", text: error instanceof Error ? error.message : "Unable to start NEON" });
      }
    } finally {
      startingRef.current = false;
    }
  }, [connectAgent, session, started]);

  const shutdown = useCallback(() => {
    shuttingDownRef.current = true;
    cleanupAgent();
    mutedRef.current = false;
    textOnlyRef.current = false;
    setMuted(false);
    setStarted(false);
    setStatus({ mode: "idle", text: "idle" });
    if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
    sceneRef.current = null;
    setScene(null);
    lastSceneKeyRef.current = null;
  }, [cleanupAgent]);

  const retry = useCallback(async () => {
    if (!started) {
      await start();
      return;
    }
    cleanupAgent();
    shuttingDownRef.current = false;
    // A manual retry creates a new SDK session and refreshes DB-backed context.
    await connectAgent();
  }, [cleanupAgent, connectAgent, start, started]);

  const toggleMute = useCallback(async () => {
    if (!started) return;
    const mic = micRef.current;
    const sdk = sdkSessionRef.current;
    const next = !mutedRef.current;
    if (next) {
      mutedRef.current = true;
      setMuted(true);
      mic?.stop();
      setMicrophoneDevice(null);
      setStatus({ mode: "idle", text: "microphone muted" });
      return;
    }
    if (!sdk || !agentReadyRef.current) {
      setStatus({ mode: "error", text: "Not connected. Select Retry." });
      return;
    }
    mutedRef.current = false;
    try {
      await mic?.start();
      if (shuttingDownRef.current || sdkSessionRef.current !== sdk || mutedRef.current) {
        mic?.stop();
        return;
      }
      textOnlyRef.current = false;
      setMuted(false);
      setMicrophoneDevice("Browser-selected microphone");
      setStatus({ mode: "listening", text: "listening..." });
    } catch (error) {
      console.warn("Microphone unavailable", error);
      mutedRef.current = true;
      setMuted(true);
      setMicrophoneDevice(null);
      setStatus({ mode: "error", text: "Microphone unavailable; keep using text" });
    }
  }, [started]);

  const sendText = useCallback((raw: string) => {
    const text = raw.trim();
    const sdk = sdkSessionRef.current;
    if (!text || text.length > 2000 || !sdk || !agentReadyRef.current) return false;
    try {
      sdk.injectUserMessage(text);
      setTranscript(text);
      setStatus({ mode: "thinking", text: "thinking..." });
      return true;
    } catch (error) {
      console.warn("Deepgram text injection failed", error);
      return false;
    }
  }, []);

  useEffect(() => {
    const onExit = () => shutdown();
    window.addEventListener("pagehide", onExit);
    return () => {
      window.removeEventListener("pagehide", onExit);
      shutdown();
    };
  }, [shutdown]);

  return {
    started, status, transcript, messages, lastLatencyMs, audioDiagnostics,
    microphoneDevice, speechInterruptions, storageWarning, greeting, scene,
    level, muted, pendingSaveNote, resolveSaveNote, start, shutdown, retry,
    toggleMute, sendText
  };
}
