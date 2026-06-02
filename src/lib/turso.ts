import { createClient } from "@libsql/client";

export const turso = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

let ready = false;

export async function ensureSchema() {
  if (ready) return;
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS books (
      id       TEXT    PRIMARY KEY,
      title    TEXT    NOT NULL,
      author   TEXT    NOT NULL,
      cover    TEXT,
      epub_data BLOB   NOT NULL,
      chapters TEXT    NOT NULL DEFAULT '[]',
      added_at INTEGER NOT NULL
    )
  `);
  ready = true;
}
