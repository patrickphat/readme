/// <reference lib="webworker" />

// Runs in a Web Worker — WASM inference happens here, never blocking the main thread.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tts: any = null;

type InMsg =
  | { id: string; type: "load" }
  | { id: string; type: "generate"; text: string; voice: string };

type OutMsg =
  | { id: string; type: "progress"; msg: string }
  | { id: string; type: "loaded" }
  | { id: string; type: "audio"; audio: Float32Array; sampling_rate: number }
  | { id: string; type: "error"; msg: string };

function send(data: OutMsg, transfer?: Transferable[]) {
  if (transfer) {
    (self as unknown as Worker).postMessage(data, transfer);
  } else {
    (self as unknown as Worker).postMessage(data);
  }
}

self.addEventListener("message", async (e: MessageEvent<InMsg>) => {
  const { id, type } = e.data;

  try {
    if (type === "load") {
      const { env, KokoroTTS } = await import(
        /* webpackChunkName: "kokoro" */ "kokoro-js"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any;

      env.allowLocalModels = false;
      env.useBrowserCache = true;

      tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8",
        device: "wasm",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (info: any) => {
          let msg = "";
          if (info.status === "initiate") msg = "Downloading AI voice model (~83 MB)…";
          else if (info.status === "progress" && info.progress != null)
            msg = `Downloading${info.file ? ` ${(info.file as string).split("/").pop()}` : ""}: ${Math.round(info.progress as number)}%`;
          else if (info.status === "done") msg = "Finalizing…";
          if (msg) send({ id, type: "progress", msg });
        },
      });
      send({ id, type: "loaded" });

    } else if (type === "generate") {
      if (!tts) throw new Error("Model not loaded");
      const result = await tts.generate(e.data.text, { voice: e.data.voice });
      // Transfer the buffer (zero-copy) back to main thread
      const audio = result.audio as Float32Array;
      send(
        { id, type: "audio", audio, sampling_rate: result.sampling_rate as number },
        [audio.buffer as ArrayBuffer],
      );
    }
  } catch (err) {
    send({ id, type: "error", msg: String(err) });
  }
});
