import { createModel } from "vosk-browser";

/**
 * The page inside Ghost's hidden voice window. It is served from the loopback
 * server (http://127.0.0.1:<port>/voice.html) rather than file://, because Vosk's
 * worker needs a real origin for IndexedDB and fetch; a file:// page's workers are
 * opaque and stall. The page opens the microphone, feeds Vosk, and posts every
 * partial and final transcript to the main process, which relays it to the menu.
 * The menu never sees audio - only text - and nothing leaves the machine.
 */

declare global {
  interface Window {
    voice: { send: (event: string, payload: unknown) => void };
  }
}

const params = new URLSearchParams(location.search);
const modelUrl = params.get("model") ?? "";
const micId = params.get("mic") ?? "";

async function main(): Promise<void> {
  const say = (event: string, payload: unknown) => window.voice.send(event, payload);
  try {
    say("status", "Loading the voice model…");
    const model = await createModel(modelUrl, 1);
    const recognizer = new model.KaldiRecognizer(16000);
    recognizer.setWords(false);
    recognizer.on("result", (m) => {
      const text = (m as { result?: { text?: string } }).result?.text?.trim() ?? "";
      if (text) say("final", text);
    });
    recognizer.on("partialresult", (m) => {
      const partial = (m as { result?: { partial?: string } }).result?.partial?.trim() ?? "";
      if (partial) say("partial", partial);
    });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      video: false,
    });
    const context = new AudioContext({ sampleRate: 16000 });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      try {
        recognizer.acceptWaveformFloat(e.inputBuffer.getChannelData(0), e.inputBuffer.sampleRate);
      } catch {
        // torn down mid-buffer
      }
    };
    source.connect(processor);
    processor.connect(context.destination);
    say("ready", true);
  } catch (err) {
    say("error", String((err as Error).message ?? err));
  }
}

void main();
