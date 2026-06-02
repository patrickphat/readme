"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChapterSidebar } from "@/components/ChapterSidebar";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { AudioControls } from "@/components/AudioControls";
import { SettingsPopover } from "@/components/SettingsPopover";
import { loadChapter, type TextBlock } from "@/lib/epub";
import { getBook, getBookMeta, updateBookChapters, type BookChapter } from "@/lib/db";
import { getCachedEpub, setCachedEpub } from "@/lib/epub-cache";
import { cn } from "@/lib/utils";
import { KokoroEngine, DEFAULT_KOKORO_VOICE, type KokoroVoiceId } from "@/lib/kokoro-engine";

interface ReaderProps {
  bookId: string;
}

interface SpeechChunk {
  text: string;
  wordStarts: number[];
  globalOffset: number;
  isHeading: boolean;
}

const HEADING_TYPES = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function buildChunks(blocks: TextBlock[]): SpeechChunk[] {
  let globalOffset = 0;
  const chunks: SpeechChunk[] = [];
  for (const block of blocks) {
    if (block.words.length === 0) continue;
    const wordStarts: number[] = [];
    let pos = 0;
    for (const word of block.words) {
      wordStarts.push(pos);
      pos += word.length + 1;
    }
    chunks.push({
      text: block.words.join(" "),
      wordStarts,
      globalOffset,
      isHeading: HEADING_TYPES.has(block.type),
    });
    globalOffset += block.words.length;
  }
  return chunks;
}

function findChunkForWord(chunks: SpeechChunk[], globalWordIdx: number): { ci: number; wordWithinChunk: number } {
  let ci = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].globalOffset <= globalWordIdx) ci = i;
    else break;
  }
  return { ci, wordWithinChunk: Math.max(0, globalWordIdx - chunks[ci].globalOffset) };
}

// ── Settings helpers ──────────────────────────────────────────────────────────

async function loadSettings(): Promise<Record<string, string>> {
  try {
    const r = await fetch("/api/settings");
    if (r.ok) return r.json();
  } catch {}
  return {};
}

async function saveSettings(patch: Record<string, string>) {
  try {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {}
}

// ── Progress helpers ──────────────────────────────────────────────────────────

async function loadProgress(bookId: string): Promise<{ chapterIdx: number; wordIdx: number }> {
  try {
    const r = await fetch(`/api/progress/${bookId}`);
    if (r.ok) return r.json();
  } catch {}
  return { chapterIdx: 0, wordIdx: 0 };
}

async function saveProgress(bookId: string, chapterIdx: number, wordIdx: number) {
  try {
    await fetch(`/api/progress/${bookId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterIdx, wordIdx }),
    });
  } catch {}
}

export function Reader({ bookId }: ReaderProps) {
  const router = useRouter();

  // Book state
  const [bookLoading, setBookLoading] = useState(true);
  const [bookTitle, setBookTitle] = useState("");
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);

  // Chapter content
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [chapterLoading, setChapterLoading] = useState(false);

  // Speech state — seeded from localStorage for instant render, then synced from DB
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeWordIdx, setActiveWordIdx] = useState(-1);
  const [playbackRate, setPlaybackRateState] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    return Number(localStorage.getItem("epub-reader-speed") ?? 1) || 1;
  });
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("epub-reader-voice") ?? "";
  });
  const [headingVoiceURI, setHeadingVoiceURIState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("epub-reader-heading-voice") ?? "";
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Kokoro (AI TTS) state ─────────────────────────────────────────────────
  const [useKokoro, setUseKokoro] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("epub-reader-engine") === "kokoro";
  });
  const [kokoroStatus, setKokoroStatus] = useState<"idle" | "loading" | "ready" | "error">(
    () => (KokoroEngine.getIfReady() ? "ready" : "idle")
  );
  const [kokoroProgress, setKokoroProgress] = useState("");
  const [kokoroVoice, setKokoroVoiceState] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_KOKORO_VOICE;
    return localStorage.getItem("epub-reader-kokoro-voice") ?? DEFAULT_KOKORO_VOICE;
  });
  const kokoroVoiceRef = useRef(kokoroVoice);
  const kokoroEngineRef = useRef<KokoroEngine | null>(KokoroEngine.getIfReady());
  const kokoroCancelledRef = useRef(false); // flag: stop pending generate() calls
  const useKokoroRef = useRef(useKokoro);
  useKokoroRef.current = useKokoro;

  // Compute chunks synchronously so they're always current on every render
  const chunks = useMemo(() => buildChunks(blocks), [blocks]);

  // Refs
  const chunksRef = useRef<SpeechChunk[]>([]);
  chunksRef.current = chunks; // always up-to-date, no async gap
  const playbackRateRef = useRef(playbackRate);
  const voiceURIRef = useRef(selectedVoiceURI);
  const headingVoiceURIRef = useRef(headingVoiceURI);
  const headingPauseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // debounce timer for progress saves
  const saveProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // iOS silent audio loop — keeps the audio session alive so speech continues in background
  const silentAudioRef = useRef<{ ctx: AudioContext; source: AudioBufferSourceNode } | null>(null);
  // track whether we've applied the initial saved progress for this book
  const progressAppliedRef = useRef(false);
  const currentIdxRef = useRef(currentIdx);
  const activeWordIdxRef = useRef(activeWordIdx);

  currentIdxRef.current = currentIdx;
  activeWordIdxRef.current = activeWordIdx;

  const totalWords = blocks.reduce((s, b) => s + b.words.length, 0);
  const currentChapterTitle = chapters[currentIdx]?.title ?? "";

  // ── Sync settings from DB once on mount ──────────────────────────────────────
  useEffect(() => {
    loadSettings().then((s) => {
      if (s["epub-reader-speed"]) {
        const rate = Number(s["epub-reader-speed"]) || 1;
        playbackRateRef.current = rate;
        setPlaybackRateState(rate);
        localStorage.setItem("epub-reader-speed", String(rate));
      }
      if (s["epub-reader-voice"]) {
        voiceURIRef.current = s["epub-reader-voice"];
        setSelectedVoiceURI(s["epub-reader-voice"]);
        localStorage.setItem("epub-reader-voice", s["epub-reader-voice"]);
      }
      if (s["epub-reader-heading-voice"]) {
        headingVoiceURIRef.current = s["epub-reader-heading-voice"];
        setHeadingVoiceURIState(s["epub-reader-heading-voice"]);
        localStorage.setItem("epub-reader-heading-voice", s["epub-reader-heading-voice"]);
      }
      if (s["epub-reader-engine"]) {
        const eng = s["epub-reader-engine"];
        localStorage.setItem("epub-reader-engine", eng);
        const isK = eng === "kokoro";
        setUseKokoro(isK);
        useKokoroRef.current = isK;
      }
      if (s["epub-reader-kokoro-voice"]) {
        kokoroVoiceRef.current = s["epub-reader-kokoro-voice"];
        setKokoroVoiceState(s["epub-reader-kokoro-voice"]);
        localStorage.setItem("epub-reader-kokoro-voice", s["epub-reader-kokoro-voice"]);
      }
    });
  }, []);

  // ── Debounced progress save ───────────────────────────────────────────────────
  function scheduleSaveProgress(chapterIdx: number, wordIdx: number) {
    if (saveProgressTimerRef.current) clearTimeout(saveProgressTimerRef.current);
    saveProgressTimerRef.current = setTimeout(() => {
      saveProgress(bookId, chapterIdx, wordIdx);
    }, 1500);
  }

  // ── Load book ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    progressAppliedRef.current = false;
    setBookLoading(true);

    async function load() {
      // Fire all independent fetches in parallel:
      // - progress  (Turso)
      // - epub      (IndexedDB cache — fast if hit)
      // - metadata  (Turso, always needed, no epub blob)
      const [savedProgress, cachedEpub, meta] = await Promise.all([
        loadProgress(bookId),
        getCachedEpub(bookId),
        getBookMeta(bookId),
      ]);

      let resolvedChapters: BookChapter[] = [];
      let epubBuffer: ArrayBuffer;

      if (cachedEpub) {
        // Fast path — epub already local, meta came in parallel
        if (!meta) { router.push("/"); return; }
        setBookTitle(meta.title);
        epubBuffer = cachedEpub;
        resolvedChapters = meta.chapters;
      } else {
        // Slow path — download full epub blob from Turso
        const book = await getBook(bookId);
        if (!book) { router.push("/"); return; }
        setBookTitle(book.title);
        epubBuffer = book.epubData;
        // Cache locally and write metadata in background (don't await)
        setCachedEpub(bookId, book.epubData);

        resolvedChapters = book.chapters ?? [];
        if (resolvedChapters.length === 0) {
          try {
            const { parseEpubFile } = await import("@/lib/epub");
            const blob = new Blob([book.epubData]);
            const file = new File([blob], "book.epub", { type: "application/epub+zip" });
            const reparsed = await parseEpubFile(file);
            resolvedChapters = reparsed.chapters;
            updateBookChapters(book.id, resolvedChapters); // background
          } catch {}
        }
      }

      setEpubData(epubBuffer);

      setChapters(resolvedChapters);

      // Determine starting chapter: use saved progress if non-zero, else skip front matter
      if (savedProgress.chapterIdx > 0 || savedProgress.wordIdx > 0) {
        setCurrentIdx(Math.min(savedProgress.chapterIdx, resolvedChapters.length - 1));
        // word index will be applied once chapter loads — flagged via ref
        progressAppliedRef.current = true;
      } else {
        const FRONT_MATTER = /^(cover|title|copyright|dedication|contents|toc|preface|foreword|introduction|prologue|about)/i;
        const first = resolvedChapters.findIndex((c) => !FRONT_MATTER.test(c.title.trim()));
        if (first > 0) setCurrentIdx(first);
      }

      // stash word idx so chapter-load effect can pick it up
      pendingWordIdxRef.current = savedProgress.wordIdx;
    }

    load().finally(() => setBookLoading(false));
  }, [bookId, router]);

  // pending word index to apply after the chapter finishes loading
  const pendingWordIdxRef = useRef(0);

  // ── Load chapter content ───────────────────────────────────────────────────
  useEffect(() => {
    if (!epubData || chapters.length === 0) return;
    const chapter = chapters[currentIdx];
    if (!chapter) return;

    kokoroCancelledRef.current = true;
    kokoroEngineRef.current?.stop();
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
    setActiveWordIdx(-1);
    setKokoroProgress("");
    setChapterLoading(true);

    loadChapter(epubData, chapter.spineIdx, chapter.title)
      .then((loaded) => {
        setBlocks(loaded.blocks);
        // Apply pending word index after first load
        if (progressAppliedRef.current && pendingWordIdxRef.current > 0) {
          setActiveWordIdx(pendingWordIdxRef.current);
          activeWordIdxRef.current = pendingWordIdxRef.current;
          pendingWordIdxRef.current = 0;
          progressAppliedRef.current = false;
        }
      })
      .catch((err) => { console.error(err); toast.error("Failed to load chapter"); })
      .finally(() => setChapterLoading(false));
  }, [bookId, epubData, chapters, currentIdx]);

  // ── Stop all engines when blocks change ─────────────────────────────────
  useEffect(() => {
    if (headingPauseRef.current) clearTimeout(headingPauseRef.current);
    kokoroCancelledRef.current = true;
    kokoroEngineRef.current?.stop();
    setKokoroProgress("");
    // NOTE: do NOT call window.speechSynthesis.cancel() here — chapter load
    // effect already cancels it, and re-cancelling leaves Chrome in a stale
    // paused=true state that blocks the next play call.
  }, [blocks]);

  // ── Save progress when chapter/word changes ───────────────────────────────
  useEffect(() => {
    if (chapters.length === 0) return;
    scheduleSaveProgress(currentIdx, activeWordIdx >= 0 ? activeWordIdx : 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, activeWordIdx]);

  // ── Keyboard shortcut ──────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "\\" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── iOS background audio: start a silent loop to keep the audio session alive ─
  function ensureSilentLoop() {
    if (silentAudioRef.current) return;
    try {
      const ctx = new AudioContext();
      // 3-second silent buffer looped forever
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(ctx.destination);
      source.start();
      silentAudioRef.current = { ctx, source };
    } catch {}
  }

  // ── MediaSession: lock screen / Control Center controls ───────────────────
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentChapterTitle || bookTitle,
      artist: bookTitle,
      album: "epub reader",
    });
  }, [bookTitle, currentChapterTitle]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => handlePlayPause());
    navigator.mediaSession.setActionHandler("pause", () => handlePlayPause());
    navigator.mediaSession.setActionHandler("previoustrack", () =>
      setCurrentIdx((i) => Math.max(0, i - 1))
    );
    navigator.mediaSession.setActionHandler("nexttrack", () =>
      setCurrentIdx((i) => Math.min(chapters.length - 1, i + 1))
    );
    return () => {
      (["play", "pause", "previoustrack", "nexttrack"] as MediaSessionAction[]).forEach((a) => {
        try { navigator.mediaSession.setActionHandler(a, null); } catch {}
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters.length]);

  // Stop all engines on unmount
  useEffect(() => {
    return () => {
      kokoroCancelledRef.current = true;
      kokoroEngineRef.current?.stop();
      window.speechSynthesis?.cancel();
      silentAudioRef.current?.source.stop();
      silentAudioRef.current?.ctx.close();
      silentAudioRef.current = null;
      if (saveProgressTimerRef.current) clearTimeout(saveProgressTimerRef.current);
      saveProgress(bookId, currentIdxRef.current, Math.max(0, activeWordIdxRef.current));
    };
  }, [bookId]);

  // ── Kokoro speech engine ───────────────────────────────────────────────────

  const speakFromChunkKokoro = useCallback(async (chunkIdx: number, wordWithinChunk = 0) => {
    kokoroCancelledRef.current = false;
    const currentChunks = chunksRef.current;

    if (chunkIdx >= currentChunks.length) {
      setIsPlaying(false);
      setActiveWordIdx(-1);
      return;
    }

    // Ensure engine is loaded
    let engine = kokoroEngineRef.current;
    if (!engine) {
      setKokoroStatus("loading");
      try {
        engine = await KokoroEngine.load((msg) => setKokoroProgress(msg));
        kokoroEngineRef.current = engine;
        setKokoroStatus("ready");
        setKokoroProgress("");
      } catch (e) {
        console.error("Kokoro load failed:", e);
        setKokoroStatus("error");
        setIsPlaying(false);
        return;
      }
    }

    if (kokoroCancelledRef.current) return;

    const chunk = currentChunks[chunkIdx];
    const trimCharStart = chunk.wordStarts[wordWithinChunk] ?? 0;
    const text = chunk.text.slice(trimCharStart);
    if (!text.trim()) { speakFromChunkKokoro(chunkIdx + 1, 0); return; }

    const wordsInChunk = chunk.wordStarts.length - wordWithinChunk;

    setKokoroProgress("Generating audio…");
    let raw;
    try {
      raw = await engine.generate(text, kokoroVoiceRef.current);
    } catch (e) {
      console.error("Kokoro generate failed:", e);
      setIsPlaying(false);
      setKokoroProgress("");
      return;
    }
    setKokoroProgress("");

    if (kokoroCancelledRef.current) return;

    engine.play(
      raw,
      playbackRateRef.current,
      wordsInChunk,
      chunk.globalOffset + wordWithinChunk,
      (globalWordIdx) => setActiveWordIdx(globalWordIdx),
      () => {
        if (kokoroCancelledRef.current) return;
        const next = chunkIdx + 1;
        if (next >= chunksRef.current.length) {
          setIsPlaying(false);
          setActiveWordIdx(-1);
          return;
        }
        const delay = chunk.isHeading ? 800 : 0;
        if (delay > 0) {
          headingPauseRef.current = setTimeout(() => speakFromChunkKokoro(next, 0), delay);
        } else {
          speakFromChunkKokoro(next, 0);
        }
      },
    );
    setIsPlaying(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Web Speech engine ──────────────────────────────────────────────────────

  const speakFromChunk = useCallback((chunkIdx: number, wordWithinChunk = 0) => {
    const chunks = chunksRef.current;
    window.speechSynthesis.cancel();

    if (chunkIdx >= chunks.length) {
      setIsPlaying(false);
      setActiveWordIdx(-1);
      return;
    }

    const chunk = chunks[chunkIdx];
    const trimCharStart = chunk.wordStarts[wordWithinChunk] ?? 0;
    const text = chunk.text.slice(trimCharStart);

    if (!text.trim()) {
      speakFromChunk(chunkIdx + 1, 0);
      return;
    }

    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = playbackRateRef.current;

    {
      const uri = chunk.isHeading ? headingVoiceURIRef.current : voiceURIRef.current;
      if (uri) {
        const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === uri);
        if (voice) utt.voice = voice;
      }
    }

    utt.onboundary = (e) => {
      if (e.name !== "word") return;
      const absChar = trimCharStart + e.charIndex;
      let wi = wordWithinChunk;
      for (let i = wordWithinChunk; i < chunk.wordStarts.length; i++) {
        if (chunk.wordStarts[i] <= absChar) wi = i;
        else break;
      }
      setActiveWordIdx(chunk.globalOffset + wi);
    };

    utt.onend = () => {
      const next = chunkIdx + 1;
      if (next >= chunksRef.current.length) {
        setIsPlaying(false);
        setActiveWordIdx(-1);
        return;
      }
      const delay = chunk.isHeading ? 800 : 0;
      if (delay > 0) {
        headingPauseRef.current = setTimeout(() => speakFromChunk(next, 0), delay);
      } else {
        speakFromChunk(next, 0);
      }
    };

    utt.onerror = (e) => {
      if (e.error === "interrupted" || e.error === "canceled") return;
      console.error("Speech error:", e.error);
      setIsPlaying(false);
    };

    window.speechSynthesis.speak(utt);
    setIsPlaying(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAll() {
    kokoroCancelledRef.current = true;
    kokoroEngineRef.current?.stop();
    window.speechSynthesis?.cancel();
    setKokoroProgress("");
  }

  function startSpeaking(wordIdx: number) {
    const currentChunks = chunksRef.current;
    if (currentChunks.length === 0) return;
    const { ci, wordWithinChunk } = findChunkForWord(currentChunks, wordIdx);
    if (useKokoroRef.current) {
      speakFromChunkKokoro(ci, wordWithinChunk);
    } else {
      ensureSilentLoop();
      window.speechSynthesis.cancel();
      speakFromChunk(ci, wordWithinChunk);
    }
  }

  function handlePlayPause() {
    if (isPlaying) {
      // Pause whichever engine is active
      if (useKokoroRef.current) {
        kokoroEngineRef.current?.pause();
      } else {
        window.speechSynthesis.pause();
      }
      setIsPlaying(false);
    } else if (!useKokoroRef.current && window.speechSynthesis.paused && window.speechSynthesis.speaking) {
      // Resume Web Speech mid-utterance
      window.speechSynthesis.resume();
      setIsPlaying(true);
    } else if (useKokoroRef.current && kokoroEngineRef.current?.isPaused) {
      // Resume Kokoro mid-buffer
      kokoroEngineRef.current.resume();
      setIsPlaying(true);
    } else {
      // Start fresh from current word position
      const startIdx = activeWordIdx >= 0 ? activeWordIdx : 0;
      stopAll();
      startSpeaking(startIdx);
    }
  }

  function handleWordClick(globalIdx: number) {
    stopAll();
    startSpeaking(globalIdx);
  }

  function handleSeekWord(globalIdx: number) {
    setActiveWordIdx(globalIdx);
    if (isPlaying) {
      stopAll();
      startSpeaking(globalIdx);
    }
  }

  function setPlaybackRate(rate: number) {
    playbackRateRef.current = rate;
    setPlaybackRateState(rate);
    localStorage.setItem("epub-reader-speed", String(rate));
    saveSettings({ "epub-reader-speed": String(rate) });
    if (isPlaying) {
      const startIdx = activeWordIdx >= 0 ? activeWordIdx : 0;
      stopAll();
      startSpeaking(startIdx);
    }
  }

  function handleVoiceChange(voiceURI: string) {
    voiceURIRef.current = voiceURI;
    setSelectedVoiceURI(voiceURI);
    localStorage.setItem("epub-reader-voice", voiceURI);
    saveSettings({ "epub-reader-voice": voiceURI });
    if (isPlaying && !useKokoroRef.current) {
      const startIdx = activeWordIdx >= 0 ? activeWordIdx : 0;
      stopAll();
      startSpeaking(startIdx);
    }
  }

  function handleHeadingVoiceChange(voiceURI: string) {
    headingVoiceURIRef.current = voiceURI;
    setHeadingVoiceURIState(voiceURI);
    localStorage.setItem("epub-reader-heading-voice", voiceURI);
    saveSettings({ "epub-reader-heading-voice": voiceURI });
  }

  function handleKokoroVoiceChange(voice: string) {
    kokoroVoiceRef.current = voice;
    setKokoroVoiceState(voice);
    localStorage.setItem("epub-reader-kokoro-voice", voice);
    saveSettings({ "epub-reader-kokoro-voice": voice });
    if (isPlaying && useKokoroRef.current) {
      const startIdx = activeWordIdx >= 0 ? activeWordIdx : 0;
      stopAll();
      startSpeaking(startIdx);
    }
  }

  function handleEngineChange(engine: "webspeech" | "kokoro") {
    const isK = engine === "kokoro";
    setUseKokoro(isK);
    useKokoroRef.current = isK;
    localStorage.setItem("epub-reader-engine", engine);
    saveSettings({ "epub-reader-engine": engine });
    if (isPlaying) {
      stopAll();
      setIsPlaying(false);
    }
  }

  // currentChapterTitle already computed above (needed by effects)

  if (bookLoading) {
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-4 bg-background text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Loading book…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <header className="border-b px-4 py-3 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSidebarOpen((v) => !v)}>
          {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{bookTitle}</p>
          <p className="text-xs text-muted-foreground truncate">{currentChapterTitle}</p>
        </div>
        <SettingsPopover
          playbackRate={playbackRate}
          contentVoiceURI={selectedVoiceURI}
          headingVoiceURI={headingVoiceURI}
          onRateChange={setPlaybackRate}
          onContentVoiceChange={handleVoiceChange}
          onHeadingVoiceChange={handleHeadingVoiceChange}
          useKokoro={useKokoro}
          kokoroVoice={kokoroVoice}
          onEngineChange={handleEngineChange}
          onKokoroVoiceChange={handleKokoroVoiceChange}
        />
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Mobile: fullscreen overlay */}
        {sidebarOpen && (
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div className={cn(
          "md:hidden fixed inset-0 z-50 bg-background transition-transform duration-200",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <ChapterSidebar
            chapters={chapters}
            currentIdx={currentIdx}
            onSelect={(idx) => { setCurrentIdx(idx); setSidebarOpen(false); }}
            onClose={() => setSidebarOpen(false)}
          />
        </div>

        {/* Desktop: inline sidebar */}
        <div className={cn(
          "hidden md:block shrink-0 transition-all duration-200 overflow-hidden",
          sidebarOpen ? "w-64" : "w-0"
        )}>
          <ChapterSidebar
            chapters={chapters}
            currentIdx={currentIdx}
            onSelect={setCurrentIdx}
            onClose={() => setSidebarOpen(false)}
          />
        </div>

        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Kokoro status banner */}
          {useKokoro && (kokoroStatus === "loading" || kokoroProgress) && (
            <div className="flex items-center gap-2 px-4 py-2 bg-muted text-xs text-muted-foreground border-b shrink-0">
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              <span className="truncate">{kokoroProgress || "Loading AI voice…"}</span>
            </div>
          )}
          {useKokoro && kokoroStatus === "error" && (
            <div className="px-4 py-2 bg-destructive/10 text-xs text-destructive border-b shrink-0">
              Failed to load Kokoro model. Falling back to system voice.
            </div>
          )}
          <TranscriptPanel
            blocks={blocks}
            activeWordIdx={activeWordIdx}
            onWordClick={handleWordClick}
            isLoading={chapterLoading}
          />
        </div>
      </div>

      {/* Audio controls */}
      <AudioControls
        isPlaying={isPlaying}
        currentWordIdx={activeWordIdx}
        totalWords={totalWords}
        onPlayPause={handlePlayPause}
        onSeekWord={handleSeekWord}
        onPrevChapter={() => setCurrentIdx((i) => Math.max(0, i - 1))}
        onNextChapter={() => setCurrentIdx((i) => Math.min(chapters.length - 1, i + 1))}
        chapterTitle={currentChapterTitle}
        onTitleClick={() => setSidebarOpen((v) => !v)}
        bookProgressPct={chapters.length > 0 ? Math.round((currentIdx / chapters.length) * 100) : 0}
      />
    </div>
  );
}
