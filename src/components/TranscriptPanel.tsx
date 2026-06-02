"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { TextBlock } from "@/lib/epub";

interface TranscriptPanelProps {
  blocks: TextBlock[];
  activeWordIdx: number;
  onWordClick: (globalIdx: number) => void;
  isLoading?: boolean;
}

// Wrapper element + className per block type
const BLOCK_STYLES: Record<string, { tag: "h1"|"h2"|"h3"|"h4"|"h5"|"h6"|"p"|"blockquote"|"ul"; className: string }> = {
  h1: { tag: "h1", className: "text-2xl font-bold mt-8 mb-2 font-sans text-center" },
  h2: { tag: "h2", className: "text-xl  font-bold mt-6 mb-2 font-sans text-center" },
  h3: { tag: "h3", className: "text-lg  font-semibold mt-5 mb-1 font-sans text-center" },
  h4: { tag: "h4", className: "text-base font-semibold mt-4 mb-1 font-sans text-center" },
  h5: { tag: "h5", className: "text-sm  font-semibold mt-3 font-sans text-center" },
  h6: { tag: "h6", className: "text-sm  font-medium  mt-3 font-sans text-center text-muted-foreground" },
  blockquote: { tag: "blockquote", className: "italic text-muted-foreground pl-5 border-l-2 border-muted-foreground/30 my-3" },
  li: { tag: "p", className: "pl-5 before:content-['•'] before:mr-2 before:text-muted-foreground" },
  p:  { tag: "p", className: "" },
};

export function TranscriptPanel({ blocks, activeWordIdx, onWordClick, isLoading }: TranscriptPanelProps) {
  const activeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeWordIdx]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading chapter…
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        This page contains only images or no readable text.
      </div>
    );
  }

  let globalIdx = 0;

  return (
    <ScrollArea className="flex-1 px-8 py-8">
      <div className="max-w-2xl mx-auto leading-relaxed font-serif text-lg">
        {blocks.map((block, bIdx) => {
          const blockStart = globalIdx;
          globalIdx += block.words.length;
          const style = BLOCK_STYLES[block.type] ?? BLOCK_STYLES.p;
          const Tag = style.tag;

          const wordSpans = block.words.map((word, wIdx) => {
            const idx = blockStart + wIdx;
            const isActive = idx === activeWordIdx;
            return (
              <span
                key={idx}
                ref={isActive ? activeRef : undefined}
                onClick={() => onWordClick(idx)}
                className={cn(
                  "cursor-pointer rounded-sm px-0.5 transition-colors hover:bg-muted",
                  isActive && "bg-yellow-200 dark:bg-yellow-500/40 text-foreground"
                )}
              >
                {word}
                {wIdx < block.words.length - 1 ? " " : ""}
              </span>
            );
          });

          return (
            <Tag key={bIdx} className={cn(style.className, "mb-1")}>
              {wordSpans}
            </Tag>
          );
        })}
      </div>
    </ScrollArea>
  );
}
