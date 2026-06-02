// Kokoro TTS engine — delegates inference to a Web Worker so WASM never
// blocks the main thread. Audio is played via Web Audio API.

export const KOKORO_VOICES = [
  { id: "af_heart",    name: "Heart ♀ US" },
  { id: "af_bella",    name: "Bella ♀ US" },
  { id: "af_nicole",   name: "Nicole ♀ US" },
  { id: "af_sarah",    name: "Sarah ♀ US" },
  { id: "af_sky",      name: "Sky ♀ US" },
  { id: "am_adam",     name: "Adam ♂ US" },
  { id: "am_michael",  name: "Michael ♂ US" },
  { id: "bf_emma",     name: "Emma ♀ UK" },
  { id: "bf_isabella", name: "Isabella ♀ UK" },
  { id: "bm_george",   name: "George ♂ UK" },
  { id: "bm_lewis",    name: "Lewis ♂ UK" },
] as const;

export type KokoroVoiceId = (typeof KOKORO_VOICES)[number]["id"];
export const DEFAULT_KOKORO_VOICE: KokoroVoiceId = "af_heart";

// ── Worker bridge ─────────────────────────────────────────────────────────────

type WorkerResponse =
  | { id: string; type: "progress"; msg: string }
  | { id: string; type: "loaded" }
  | { id: string; type: "audio"; audio: Float32Array; sampling_rate: number }
  | { id: string; type: "error"; msg: string };

let workerSingleton: Worker | null = null;
let msgCounter = 0;
const pending = new Map<string, {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (msg: string) => void;
}>();

function getWorker(): Worker {
  if (workerSingleton) return workerSingleton;
  workerSingleton = new Worker(
    new URL("../workers/kokoro.worker.ts", import.meta.url),
    { type: "module" }
  );
  workerSingleton.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const { id, type } = e.data;
    const cb = pending.get(id);
    if (!cb) return;
    if (type === "progress") {
      cb.onProgress?.(e.data.msg);
    } else if (type === "loaded") {
      pending.delete(id);
      cb.resolve(undefined);
    } else if (type === "audio") {
      pending.delete(id);
      cb.resolve({ audio: e.data.audio, sampling_rate: e.data.sampling_rate });
    } else if (type === "error") {
      pending.delete(id);
      cb.reject(new Error(e.data.msg));
    }
  };
  workerSingleton.onerror = (e) => {
    console.error("Kokoro worker error:", e);
  };
  return workerSingleton;
}

function workerCall<T>(
  msg: object,
  onProgress?: (msg: string) => void
): Promise<T> {
  const id = String(msgCounter++);
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
      onProgress,
    });
    getWorker().postMessage({ id, ...msg });
  });
}

// ── Engine class ─────────────────────────────────────────────────────────────

let engineInstance: KokoroEngine | null = null;
let loadPromise: Promise<KokoroEngine> | null = null;

export class KokoroEngine {
  readonly ctx: AudioContext;
  private src: AudioBufferSourceNode | null = null;
  private wordTick: ReturnType<typeof setInterval> | null = null;
  private _paused = false;
  private _ctxTimeAtStart = 0;
  private _audioOffsetAtStart = 0;

  private constructor() {
    this.ctx = new AudioContext();
  }

  // ── Singleton loader ──────────────────────────────────────────────────────

  static async load(onProgress: (msg: string) => void): Promise<KokoroEngine> {
    if (engineInstance) return engineInstance;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      // Kick off the worker and wait for the model to be ready
      await workerCall<void>({ type: "load" }, onProgress);
      engineInstance = new KokoroEngine();
      loadPromise = null;
      return engineInstance;
    })().catch((e) => {
      loadPromise = null;
      throw e;
    });

    return loadPromise;
  }

  static getIfReady(): KokoroEngine | null {
    return engineInstance;
  }

  // ── Audio generation (runs in worker, non-blocking) ───────────────────────

  async generate(
    text: string,
    voice: string
  ): Promise<{ audio: Float32Array; sampling_rate: number }> {
    return workerCall<{ audio: Float32Array; sampling_rate: number }>({
      type: "generate",
      text,
      voice,
    });
  }

  // ── Playback (Web Audio API, main thread) ─────────────────────────────────

  play(
    raw: { audio: Float32Array; sampling_rate: number },
    rate: number,
    wordCount: number,
    globalOffset: number,
    onWord: (globalWordIdx: number) => void,
    onEnd: () => void,
  ): void {
    this.stop();
    this._paused = false;

    const duration = raw.audio.length / raw.sampling_rate;
    const buf = this.ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
    buf.copyToChannel(raw.audio as Float32Array<ArrayBuffer>, 0);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(this.ctx.destination);
    this.src = src;

    this._ctxTimeAtStart = this.ctx.currentTime;
    this._audioOffsetAtStart = 0;

    const effectiveDuration = duration / rate;
    const timePerWord = wordCount > 0 ? effectiveDuration / wordCount : 0;
    let lastWordIdx = -1;

    if (timePerWord > 0) {
      this.wordTick = setInterval(() => {
        const elapsed =
          (this.ctx.currentTime - this._ctxTimeAtStart) + this._audioOffsetAtStart;
        const wi = Math.min(Math.floor(elapsed / timePerWord), wordCount - 1);
        if (wi !== lastWordIdx && wi >= 0) {
          lastWordIdx = wi;
          onWord(globalOffset + wi);
        }
      }, 50);
    }

    src.onended = () => {
      this.clearTick();
      if (!this._paused) onEnd();
    };

    if (this.ctx.state === "suspended") this.ctx.resume();
    src.start();
  }

  pause(): void {
    if (this._paused) return;
    this._paused = true;
    this._audioOffsetAtStart += this.ctx.currentTime - this._ctxTimeAtStart;
    this.clearTick();
    this.ctx.suspend();
  }

  resume(): void {
    if (!this._paused) return;
    this._paused = false;
    this._ctxTimeAtStart = this.ctx.currentTime;
    this.ctx.resume();
  }

  stop(): void {
    this.clearTick();
    this._paused = false;
    if (this.src) {
      this.src.onended = null;
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src = null;
    }
  }

  get isPaused(): boolean { return this._paused; }

  private clearTick(): void {
    if (this.wordTick) { clearInterval(this.wordTick); this.wordTick = null; }
  }
}
