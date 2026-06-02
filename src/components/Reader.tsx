"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChapterSidebar } from "@/components/ChapterSidebar";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { AudioControls } from "@/components/AudioControls";
import { SettingsPopover } from "@/components/SettingsPopover";
import { loadChapter, type TextBlock } from "@/lib/epub";
import { getBook, saveBook, type BookChapter } from "@/lib/db";
import { cn } from "@/lib/utils";

interface ReaderProps {
  bookId: string;
}

interface SpeechChunk {
  text: string;
  wordStarts: number[]; // charStart of each word within text
  globalOffset: number; // flat word index of first word in this chunk
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
      pos += word.length + 1; // +1 for space separator
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

export function Reader({ bookId }: ReaderProps) {
  const router = useRouter();

  // Book state
  const [bookTitle, setBookTitle] = useState("");
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);

  // Chapter content
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [chapterLoading, setChapterLoading] = useState(false);

  // Speech state — initialised from localStorage where available
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Refs (stable across renders, safe in closures)
  const chunksRef = useRef<SpeechChunk[]>([]);
  const playbackRateRef = useRef(playbackRate);
  const voiceURIRef = useRef(selectedVoiceURI);
  const headingVoiceURIRef = useRef(headingVoiceURI);
  const headingPauseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalWords = blocks.reduce((s, b) => s + b.words.length, 0);

  // Load book from IndexedDB
  useEffect(() => {
    getBook(bookId).then(async (book) => {
      if (!book) { router.push("/"); return; }
      setBookTitle(book.title);
      setEpubData(book.epubData);

      let resolvedChapters: BookChapter[] = book.chapters ?? [];
      try {
        const { parseEpubFile } = await import("@/lib/epub");
        const blob = new Blob([book.epubData]);
        const file = new File([blob], "book.epub", { type: "application/epub+zip" });
        const reparsed = await parseEpubFile(file);
        resolvedChapters = reparsed.chapters;
        await saveBook({ ...book, chapters: resolvedChapters });
      } catch {}

      setChapters(resolvedChapters);

      const FRONT_MATTER = /^(cover|title|copyright|dedication|contents|toc|preface|foreword|introduction|prologue|about)/i;
      const firstContent = resolvedChapters.findIndex((c) => !FRONT_MATTER.test(c.title.trim()));
      if (firstContent > 0) setCurrentIdx(firstContent);
    });
  }, [bookId, router]);

  // Load chapter content
  useEffect(() => {
    if (!epubData || chapters.length === 0) return;
    const chapter = chapters[currentIdx];
    if (!chapter) return;

    // Stop any ongoing speech
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
    setActiveWordIdx(-1);
    setChapterLoading(true);

    loadChapter(epubData, chapter.spineIdx, chapter.title)
      .then((loaded) => setBlocks(loaded.blocks))
      .catch((err) => { console.error(err); toast.error("Failed to load chapter"); })
      .finally(() => setChapterLoading(false));
  }, [bookId, epubData, chapters, currentIdx]);

  // Rebuild speech chunks whenever blocks change
  useEffect(() => {
    if (headingPauseRef.current) clearTimeout(headingPauseRef.current);
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
    setActiveWordIdx(-1);
    chunksRef.current = buildChunks(blocks);
  }, [blocks]);

  // Ctrl+\ toggles sidebar
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
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

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
      // Empty chunk — advance
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
      // If no URI set, leave utt.voice as null → browser default
    }

    utt.onboundary = (e) => {
      if (e.name !== "word") return;
      const absChar = trimCharStart + e.charIndex;
      // Find the word whose charStart is <= absChar
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
      // After a heading, pause briefly before reading the content beneath it
      const delay = chunk.isHeading ? 800 : 0;
      if (delay > 0) {
        headingPauseRef.current = setTimeout(() => speakFromChunk(next, 0), delay);
      } else {
        speakFromChunk(next, 0);
      }
    };

    utt.onerror = (e) => {
      // 'interrupted' and 'canceled' are expected when we cancel() on seek/chapter change
      if (e.error === "interrupted" || e.error === "canceled") return;
      console.error("Speech error:", e.error);
      setIsPlaying(false);
    };

    window.speechSynthesis.speak(utt);
    setIsPlaying(true);
  }, []);

  function handlePlayPause() {
    const ss = window.speechSynthesis;
    if (ss.paused) {
      ss.resume();
      setIsPlaying(true);
    } else if (isPlaying) {
      ss.pause();
      setIsPlaying(false);
    } else {
      // Start (or resume) from active word
      const startIdx = activeWordIdx >= 0 ? activeWordIdx : 0;
      const chunks = chunksRef.current;
      if (chunks.length === 0) return;
      const { ci, wordWithinChunk } = findChunkForWord(chunks, startIdx);
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
    // If currently speaking, jump to new position
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
    // No need to restart speech — takes effect on the next utterance
  }

  const currentChapter = chapters[currentIdx];
  const currentChapterTitle = currentChapter?.title ?? "";

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

        {/* ── Mobile: fullscreen overlay ── */}
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

        {/* ── Desktop: inline sidebar ── */}
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
      />
    </div>
  );
}
