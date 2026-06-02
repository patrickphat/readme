import { NextResponse } from "next/server";
import { turso, ensureSchema } from "@/lib/turso";

// GET /api/progress/[bookId]
export async function GET(_req: Request, ctx: RouteContext<"/api/progress/[bookId]">) {
  await ensureSchema();
  const { bookId } = await ctx.params;
  const { rows } = await turso.execute({
    sql: "SELECT chapter_idx, word_idx FROM progress WHERE book_id = ?",
    args: [bookId],
  });
  if (rows.length === 0) return NextResponse.json({ chapterIdx: 0, wordIdx: 0 });
  return NextResponse.json({ chapterIdx: rows[0].chapter_idx, wordIdx: rows[0].word_idx });
}

// PUT /api/progress/[bookId]
export async function PUT(req: Request, ctx: RouteContext<"/api/progress/[bookId]">) {
  await ensureSchema();
  const { bookId } = await ctx.params;
  const { chapterIdx, wordIdx } = await req.json();
  await turso.execute({
    sql: `INSERT INTO progress (book_id, chapter_idx, word_idx, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(book_id) DO UPDATE SET chapter_idx=excluded.chapter_idx, word_idx=excluded.word_idx, updated_at=excluded.updated_at`,
    args: [bookId, chapterIdx, wordIdx, Date.now()],
  });
  return NextResponse.json({ ok: true });
}
