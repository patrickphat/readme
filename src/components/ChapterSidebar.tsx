"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BookOpen, PanelLeftClose } from "lucide-react";
import type { BookChapter } from "@/lib/db";

interface ChapterSidebarProps {
  chapters: BookChapter[];
  currentIdx: number;
  onSelect: (idx: number) => void;
  onClose: () => void;
}

export function ChapterSidebar({ chapters, currentIdx, onSelect, onClose }: ChapterSidebarProps) {
  return (
    <aside className="w-64 shrink-0 border-r flex flex-col h-full bg-muted/20">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Chapters</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={onClose}
          title="Close sidebar (Ctrl+\)"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <nav className="py-2">
          {chapters.map((chapter, idx) => {
            const level = chapter.level ?? 0;
            const indent = level === 0 ? "px-4" : level === 1 ? "pl-7 pr-4" : "pl-10 pr-4";
            const textSize = level === 0 ? "text-sm" : "text-xs";
            return (
              <button
                key={idx}
                onClick={() => onSelect(idx)}
                className={cn(
                  "w-full text-left py-2 transition-colors hover:bg-muted/60",
                  indent,
                  textSize,
                  idx === currentIdx
                    ? "bg-primary/10 text-primary font-medium border-r-2 border-primary"
                    : "text-muted-foreground"
                )}
              >
                <span className="line-clamp-2">{chapter.title}</span>
              </button>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
