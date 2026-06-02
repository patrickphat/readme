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
  // track whether we've applied the initial saved progress for this book
  const progressAppliedRef = useRef(false);
  const currentIdxRef = useRef(currentIdx);
  const activeWordIdxRef = useRef(activeWordIdx);

  currentIdxRef.current = currentIdx;
  activeWordIdxRef.current = activeWordIdx;

  const totalWords = blocks.reduce((s, b) => s + b.words.length, 0);

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
      // Load saved progress and epub in parallel
      const [savedProgress, cachedEpub] = await Promise.all([
        loadProgress(bookId),
        getCachedEpub(bookId),
      ]);

      let resolvedChapters: BookChapter[] = [];

      if (cachedEpub) {
        const meta = await getBookMeta(bookId);
        if (!meta) { router.push("/"); return; }
        setBookTitle(meta.title);
        setEpubData(cachedEpub);
        resolvedChapters = meta.chapters;
      } else {
        const book = await getBook(bookId);
        if (!book) { router.push("/"); return; }
        setBookTitle(book.title);
        setEpubData(book.epubData);
        await setCachedEpub(bookId, book.epubData);

        resolvedChapters = book.chapters ?? [];
        if (resolvedChapters.length === 0) {
          try {
            const { parseEpubFile } = await import("@/lib/epub");
            const blob = new Blob([book.epubData]);
            const file = new File([blob], "book.epub", { type: "application/epub+zip" });
            const reparsed = await parseEpubFile(file);
            resolvedChapters = reparsed.chapters;
            await updateBookChapters(book.id, resolvedChapters);
          } catch {}
        }
      }

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

    window.speechSynthesis?.cancel();
    setIsPlaying(false);
    setActiveWordIdx(-1);
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

  // ── Clear heading-pause timer when blocks change ─────────────────────────
  // NOTE: do NOT cancel speech here — the chapter load effect already cancels
  // before loading starts, and calling cancel() here puts Chrome's speech
  // synthesis into a stale paused=true state that prevents the next play call.
  useEffect(() => {
    if (headingPauseRef.current) clearTimeout(headingPauseRef.current);
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

  // Stop speech on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      if (saveProgressTimerRef.current) clearTimeout(saveProgressTimerRef.current);
      // Flush progress immediately on unmount
      saveProgress(bookId, currentIdxRef.current, Math.max(0, activeWordIdxRef.current));
    };
  }, [bookId]);

  // ── Speech engine ──────────────────────────────────────────────────────────

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
  }, []);

  function handlePlayPause() {
    const ss = window.speechSynthesis;
    if (isPlaying) {
      // Currently speaking → pause
      ss.pause();
      setIsPlaying(false);
    } else if (ss.paused && ss.speaking) {
      // Legitimately mid-utterance and paused → resume
      ss.resume();
      setIsPlaying(true);
    } else {
      // Not playing (includes stale ss.paused=true left by cancel()) → start fresh
      ss.cancel(); // clears any lingering paused state
      const startIdx = activeWordIdx >= 0 ? activeWordIdx : 0;
      const currentChunks = chunksRef.current;
      if (currentChunks.length === 0) return;
      const { ci, wordWithinChunk } = findChunkForWord(currentChunks, startIdx);
      speakFromChunk(ci, wordWithinChunk);
    }
  }

  function handleWordClick(globalIdx: number) {
    const chunks = chunksRef.current;
    if (chunks.length === 0) return;
    const { ci, wordWithinChunk } = findChunkForWord(chunks, globalIdx);
    speakFromChunk(ci, wordWithinChunk);
  }

  function handleSeekWord(globalIdx: number) {
    setActiveWordIdx(globalIdx);
    if (isPlaying || window.speechSynthesis.paused) {
      const chunks = chunksRef.current;
      if (chunks.length === 0) return;
      const { ci, wordWithinChunk } = findChunkForWord(chunks, globalIdx);
      speakFromChunk(ci, wordWithinChunk);
    }
  }

  function setPlaybackRate(rate: number) {
    playbackRateRef.current = rate;
    setPlaybackRateState(rate);
    localStorage.setItem("epub-reader-speed", String(rate));
    saveSettings({ "epub-reader-speed": String(rate) });
    if (isPlaying || window.speechSynthesis.paused) {
      const chunks = chunksRef.current;
      if (chunks.length === 0) return;
      const startIdx = activeWordIdx >= 0 ? activeWordIdx : 0;
      const { ci, wordWithinChunk } = findChunkForWord(chunks, startIdx);
      speakFromChunk(ci, wordWithinChunk);
    }
  }

  function handleVoiceChange(voiceURI: string) {
    voiceURIRef.current = voiceURI;
    setSelectedVoiceURI(voiceURI);
    localStorage.setItem("epub-reader-voice", voiceURI);
    saveSettings({ "epub-reader-voice": voiceURI });
    if (isPlaying || window.speechSynthesis.paused) {
      const chunks = chunksRef.current;
      if (chunks.length === 0) return;
      const startIdx = activeWordIdx >= 0 ? activeWordIdx : 0;
      const { ci, wordWithinChunk } = findChunkForWord(chunks, startIdx);
      speakFromChunk(ci, wordWithinChunk);
    }
  }

  function handleHeadingVoiceChange(voiceURI: string) {
    headingVoiceURIRef.current = voiceURI;
    setHeadingVoiceURIState(voiceURI);
    localStorage.setItem("epub-reader-heading-voice", voiceURI);
    saveSettings({ "epub-reader-heading-voice": voiceURI });
  }

  const currentChapter = chapters[currentIdx];
  const currentChapterTitle = currentChapter?.title ?? "";

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

        <TranscriptPanel
          blocks={blocks}
          activeWordIdx={activeWordIdx}
          onWordClick={handleWordClick}
          isLoading={chapterLoading}
        />
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
