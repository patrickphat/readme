import { openDB, type IDBPDatabase } from "idb";

export interface BookChapter {
  title: string;
  spineIdx: number; // index into epub spine, not sidebar index
  level?: number;   // 0 = top-level TOC item, 1 = subitem, etc.
}

export interface StoredBook {
  id: string;
  title: string;
  author: string;
  cover: string | null;
  epubData: ArrayBuffer;
  chapters: BookChapter[];
  /** @deprecated kept for backward-compat migration only */
  chapterTitles?: string[];
  addedAt: number;
}

export interface AudioCache {
  key: string;
  audioBase64: string;
  timestamps: WordTimestamp[];
}

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

let _db: IDBPDatabase | null = null;

async function getDB() {
  if (!_db) {
    _db = await openDB("epub-reader-db", 1, {
      upgrade(db) {
        db.createObjectStore("books", { keyPath: "id" });
        db.createObjectStore("audioCache", { keyPath: "key" });
      },
    });
  }
  return _db;
}

export async function saveBook(book: StoredBook) {
  const db = await getDB();
  await db.put("books", book);
}

export async function getBook(id: string): Promise<StoredBook | undefined> {
  const db = await getDB();
  return db.get("books", id);
}

export async function getAllBooks(): Promise<StoredBook[]> {
  const db = await getDB();
  return db.getAll("books");
}

export async function deleteBook(id: string) {
  const db = await getDB();
  await db.delete("books", id);
  // also clear audio cache for this book
  const tx = db.transaction("audioCache", "readwrite");
  const store = tx.objectStore("audioCache");
  const allKeys = await store.getAllKeys();
  for (const k of allKeys) {
    if (String(k).startsWith(`${id}-`)) await store.delete(k);
  }
  await tx.done;
}

export async function getAudioCache(bookId: string, chapterIdx: number): Promise<AudioCache | undefined> {
  const db = await getDB();
  return db.get("audioCache", `${bookId}-${chapterIdx}`);
}

export async function saveAudioCache(bookId: string, chapterIdx: number, data: { audioBase64: string; timestamps: WordTimestamp[] }) {
  const db = await getDB();
  await db.put("audioCache", { key: `${bookId}-${chapterIdx}`, ...data });
}
