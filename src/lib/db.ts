// All persistence is now backed by Turso (via /api/books routes).
// This module exposes the same interface the rest of the app uses.

export interface BookChapter {
  title: string;
  spineIdx: number;
  level?: number;
}

export interface StoredBook {
  id: string;
  title: string;
  author: string;
  cover: string | null;
  epubData: ArrayBuffer;
  chapters: BookChapter[];
  /** @deprecated kept for backward-compat only */
  chapterTitles?: string[];
  addedAt: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/** Upload a new book. Sends epub as multipart to avoid base64 overhead. */
export async function saveBook(book: StoredBook): Promise<void> {
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify({
      id: book.id,
      title: book.title,
      author: book.author,
      cover: book.cover,
      chapters: book.chapters,
      addedAt: book.addedAt,
    })
  );
  form.append("epub", new Blob([book.epubData], { type: "application/epub+zip" }));
  const res = await fetch("/api/books", { method: "POST", body: form });
  if (!res.ok) throw new Error(`saveBook failed: ${await res.text()}`);
}

/** Update only the chapter list for an existing book (no epub re-upload). */
export async function updateBookChapters(id: string, chapters: BookChapter[]): Promise<void> {
  await fetch(`/api/books/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chapters }),
  });
}

/** Fetch a single book including its epub data. */
export async function getBook(id: string): Promise<StoredBook | undefined> {
  const res = await fetch(`/api/books/${id}`);
  if (!res.ok) return undefined;
  const data = await res.json();
  return {
    id: data.id,
    title: data.title,
    author: data.author,
    cover: data.cover,
    epubData: base64ToArrayBuffer(data.epubBase64),
    chapters: data.chapters,
    addedAt: data.addedAt,
  };
}

/** List all books (no epub data — suitable for the library grid). */
export async function getAllBooks(): Promise<StoredBook[]> {
  const res = await fetch("/api/books");
  if (!res.ok) return [];
  const { books } = await res.json();
  return books.map((b: Omit<StoredBook, "epubData">) => ({
    ...b,
    epubData: new ArrayBuffer(0), // Not needed for library listing
  }));
}

/** Delete a book and all its data. */
export async function deleteBook(id: string): Promise<void> {
  await fetch(`/api/books/${id}`, { method: "DELETE" });
}

// ── Audio cache (no-ops — TTS now uses Web Speech API, nothing to cache) ─────

export interface WordTimestamp { word: string; startMs: number; endMs: number; }
export interface AudioCache { key: string; audioBase64: string; timestamps: WordTimestamp[]; }
export async function getAudioCache() { return undefined; }
export async function saveAudioCache() {}
