import { NextResponse } from "next/server";
import { turso, ensureSchema } from "@/lib/turso";

export const maxDuration = 30;

// GET /api/books/[id] — full book including epub data (as base64)
export async function GET(_req: Request, ctx: RouteContext<"/api/books/[id]">) {
  await ensureSchema();
  const { id } = await ctx.params;
  const { rows } = await turso.execute({
    sql: "SELECT id, title, author, cover, epub_data, chapters, added_at FROM books WHERE id = ?",
    args: [id],
  });
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = rows[0];
  const epubBase64 = Buffer.from(r.epub_data as ArrayBuffer).toString("base64");
  return NextResponse.json({
    id: r.id,
    title: r.title,
    author: r.author,
    cover: r.cover ?? null,
    epubBase64,
    chapters: JSON.parse(r.chapters as string),
    addedAt: r.added_at,
  });
}

// PATCH /api/books/[id] — update chapters only (no epub re-upload)
export async function PATCH(req: Request, ctx: RouteContext<"/api/books/[id]">) {
  await ensureSchema();
  const { id } = await ctx.params;
  const { chapters } = await req.json();
  await turso.execute({
    sql: "UPDATE books SET chapters = ? WHERE id = ?",
    args: [JSON.stringify(chapters), id],
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/books/[id]
export async function DELETE(_req: Request, ctx: RouteContext<"/api/books/[id]">) {
  await ensureSchema();
  const { id } = await ctx.params;
  await turso.execute({ sql: "DELETE FROM books WHERE id = ?", args: [id] });
  return NextResponse.json({ ok: true });
}
