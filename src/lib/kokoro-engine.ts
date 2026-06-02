// Kokoro TTS engine — browser-only, loaded lazily on first use.
// Singleton pattern so the model is only downloaded once per session.

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

export interface RawAudio {
  audio: Float32Array;
  sampling_rate: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TTS = any;

let singleton: KokoroEngine | null = null;
let loadPromise: Promise<KokoroEngine> | null = null;

export class KokoroEngine {
  private tts: TTS;
  readonly ctx: AudioContext;
  private src: AudioBufferSourceNode | null = null;
  private wordTick: ReturnType<typeof setInterval> | null = null;
  private _paused = false;
  private _ctxTimeAtStart = 0;
  private _audioOffsetAtStart = 0; // seconds already played before current start

  private constructor(tts: TTS) {
    this.tts = tts;
    this.ctx = new AudioContext();
  }

  // ── Singleton loader ─────────────────────────────────────────────────────

  static async load(onProgress: (msg: string) => void): Promise<KokoroEngine> {
    if (singleton) return singleton;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      const tts = await (KokoroTTS as { from_pretrained: Function }).from_pretrained(
        "onnx-community/Kokoro-82M-v1.0",
        {
          dtype: "q8",    // ~83 MB — good quality/size balance
          device: "wasm", // wasm works everywhere; webgpu faster but not on iOS
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          progress_callback: (info: any) => {
            if (info.status === "initiate") {
              onProgress("Downloading AI voice model (~83 MB)…");
            } else if (info.status === "progress" && info.progress != null) {
              const file = (info.file as string | undefined)?.split("/").pop() ?? "";
              onProgress(`Downloading${file ? ` ${file}` : ""}: ${Math.round(info.progress as number)}%`);
            } else if (info.status === "done") {
              onProgress("Finalizing…");
            }
          },
        }
      );
      singleton = new KokoroEngine(tts);
      loadPromise = null;
      return singleton;
    })().catch((e) => {
      loadPromise = null;
      throw e;
    });

    return loadPromise;
  }

  static getIfReady(): KokoroEngine | null {
    return singleton;
  }

  // ── Audio generation ─────────────────────────────────────────────────────

  async generate(text: string, voice: string): Promise<RawAudio> {
    return this.tts.generate(text, { voice }) as Promise<RawAudio>;
  }

  // ── Playback ─────────────────────────────────────────────────────────────

  play(
    raw: RawAudio,
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
    // re-arm word ticker
    // (caller is responsible for re-starting if needed — see Reader)
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
