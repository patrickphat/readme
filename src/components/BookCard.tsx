"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, Trash2 } from "lucide-react";
import type { StoredBook } from "@/lib/db";

interface BookCardProps {
  book: StoredBook;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function BookCard({ book, onOpen, onDelete }: BookCardProps) {
  const totalChapters = (book.chapters ?? book.chapterTitles ?? []).length;
  const progressPct = totalChapters > 0
    ? Math.round(((book.progressChapterIdx ?? 0) / totalChapters) * 100)
    : 0;
  const hasProgress = progressPct > 0;

  return (
    <Card className="group overflow-hidden hover:shadow-lg transition-shadow cursor-pointer">
      <div
        className="relative aspect-[2/3] bg-muted flex items-center justify-center overflow-hidden"
        onClick={() => onOpen(book.id)}
      >
        {book.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={book.cover} alt={book.title} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 p-4 text-muted-foreground">
            <BookOpen className="w-12 h-12" />
            <span className="text-xs text-center line-clamp-3 font-medium">{book.title}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />

        {/* Progress bar overlay at bottom of cover */}
        {hasProgress && (
          <div className="absolute bottom-0 left-0 right-0">
            <div className="h-1.5 bg-white/30">
              <div
                className="h-full bg-white transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Progress % badge */}
        {hasProgress && (
          <div className="absolute bottom-3 right-1.5 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none ring-1 ring-white/20">
            {progressPct}%
          </div>
        )}
      </div>

      <CardContent className="p-3">
        <p className="font-semibold text-sm line-clamp-1">{book.title}</p>
        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{book.author}</p>
        <div className="flex items-center justify-between mt-2">
          <Badge variant="secondary" className="text-xs">
            {totalChapters} ch
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(book.id); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
