import { createClient } from "@libsql/client";

export const turso = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

let ready = false;

export async function ensureSchema() {
  if (ready) return;
  await turso.batch([
    `CREATE TABLE IF NOT EXISTS books (
      id        TEXT    PRIMARY KEY,
      title     TEXT    NOT NULL,
      author    TEXT    NOT NULL,
      cover     TEXT,
      epub_data BLOB    NOT NULL,
      chapters  TEXT    NOT NULL DEFAULT '[]',
      added_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS progress (
      book_id     TEXT    PRIMARY KEY,
      chapter_idx INTEGER NOT NULL DEFAULT 0,
      word_idx    INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ], "write");
  ready = true;
}
