"use client";
import { useSession } from "@/hooks/useSession";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";
import { NeonOrb } from "./NeonOrb";
import { StartOverlay } from "./StartOverlay";
import { StatusBar } from "./StatusBar";
import { TranscriptPanel } from "./TranscriptPanel";
import { SceneStage } from "./SceneStage";

export function VoiceConsole() {
  const { session } = useSession();
  const { started, status, transcript, greeting, scene, start } = useVoiceAssistant(session);

  return (
    <>
      <NeonOrb />
      <StartOverlay visible={!started} onStart={start} />
      <SceneStage scene={scene} />
      <main className="ui-overlay">
        <div id="greeting" className={greeting ? "show" : ""}>{greeting}</div>
        <div className="status-container">
          <StatusBar mode={status.mode} text={status.text} />
          <TranscriptPanel text={transcript} />
        </div>
      </main>
    </>
  );
}