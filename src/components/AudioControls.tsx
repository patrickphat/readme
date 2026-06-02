"use client";

import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";

interface AudioControlsProps {
  isPlaying: boolean;
  currentWordIdx: number;
  totalWords: number;
  onPlayPause: () => void;
  onSeekWord: (wordIdx: number) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  chapterTitle: string;
  onTitleClick?: () => void;
  bookProgressPct: number; // 0-100 overall book progress
}

export function AudioControls({
  isPlaying,
  currentWordIdx,
  totalWords,
  onPlayPause,
  onSeekWord,
  onPrevChapter,
  onNextChapter,
  chapterTitle,
  onTitleClick,
  bookProgressPct,
}: AudioControlsProps) {
  const wordProgress = Math.max(0, currentWordIdx);

  return (
    <div className="border-t bg-background/95 backdrop-blur px-6 py-3 space-y-2">
      {/* Chapter title + book progress — centered, clickable to open ToC */}
      <div className="flex items-center justify-center gap-2">
        <button
          className="text-xs font-medium text-foreground line-clamp-1 hover:text-primary transition-colors cursor-pointer flex-1 text-center"
          onClick={onTitleClick}
          title="Open table of contents"
        >
          {chapterTitle}
        </button>
        {bookProgressPct > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {bookProgressPct}%
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
          {currentWordIdx >= 0 ? currentWordIdx : 0}
        </span>
        <Slider
          className="flex-1"
          min={0}
          max={totalWords > 0 ? totalWords - 1 : 100}
          step={1}
          value={[wordProgress]}
          onValueChange={(vals) => {
            const v = Array.isArray(vals) ? vals[0] : (vals as number);
            onSeekWord(v);
          }}
          disabled={totalWords === 0}
        />
        <span className="text-xs text-muted-foreground tabular-nums w-10">
          {totalWords}
        </span>
      </div>

      {/* Playback buttons — centred */}
      <div className="flex items-center justify-center gap-1">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onPrevChapter}>
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant="default"
          size="icon"
          className="h-10 w-10 rounded-full"
          onClick={onPlayPause}
          disabled={totalWords === 0}
        >
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onNextChapter}>
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
