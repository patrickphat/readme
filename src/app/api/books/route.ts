import { NextResponse } from "next/server";
import { turso, ensureSchema } from "@/lib/turso";

export const maxDuration = 60;

// GET /api/books — list all books (no epub data)
export async function GET() {
  await ensureSchema();
  const { rows } = await turso.execute(
    "SELECT id, title, author, cover, chapters, added_at FROM books ORDER BY added_at DESC"
  );
  const books = rows.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.author,
    cover: r.cover ?? null,
    chapters: JSON.parse(r.chapters as string),
    addedAt: r.added_at,
  }));
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
