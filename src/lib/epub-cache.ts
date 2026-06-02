/**
 * IndexedDB cache for epub binary data.
 * First open downloads from Turso; every subsequent open reads locally.
 */
import { openDB } from "idb";

const DB_NAME = "epub-cache";
const STORE = "epubs";

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE);
    },
  });
}

export async function getCachedEpub(bookId: string): Promise<ArrayBuffer | undefined> {
  try {
    const db = await getDB();
    return db.get(STORE, bookId);
  } catch {
    return undefined;
  }
}

export async function setCachedEpub(bookId: string, data: ArrayBuffer): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE, data, bookId);
  } catch {
    // Cache write failure is non-fatal
  }
}

export async function deleteCachedEpub(bookId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE, bookId);
  } catch {}
}
