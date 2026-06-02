import { NextResponse } from "next/server";
import { turso, ensureSchema } from "@/lib/turso";

export const maxDuration = 60;

// GET /api/books — list all books (no epub data), includes last reading progress
export async function GET() {
  await ensureSchema();
  const { rows } = await turso.execute(`
    SELECT b.id, b.title, b.author, b.cover, b.chapters, b.added_at,
           p.chapter_idx, p.word_idx
    FROM books b
    LEFT JOIN progress p ON p.book_id = b.id
    ORDER BY b.added_at DESC
  `);
  const books = rows.map((r) => {
    const chapters = JSON.parse(r.chapters as string);
    return {
      id: r.id,
      title: r.title,
      author: r.author,
      cover: r.cover ?? null,
      chapters,
      addedAt: r.added_at,
      progressChapterIdx: (r.chapter_idx as number) ?? 0,
      progressWordIdx: (r.word_idx as number) ?? 0,
    };
  });
  return NextResponse.json({ books });
}

// POST /api/books — upload a new book (multipart: epub file + JSON metadata)
export async function POST(req: Request) {
  await ensureSchema();
  const form = await req.formData();
  const meta = JSON.parse(form.get("metadata") as string);
  const epubFile = form.get("epub") as File;
  const epubBytes = new Uint8Array(await epubFile.arrayBuffer());

  await turso.execute({
    sql: `INSERT OR REPLACE INTO books (id, title, author, cover, epub_data, chapters, added_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      meta.id,
      meta.title,
      meta.author,
      meta.cover ?? null,
      epubBytes,
      JSON.stringify(meta.chapters ?? []),
      meta.addedAt,
    ],
  });

  return NextResponse.json({ ok: true });
}
