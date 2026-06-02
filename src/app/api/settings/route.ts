import { NextResponse } from "next/server";
import { turso, ensureSchema } from "@/lib/turso";

// GET /api/settings — returns all user settings as a flat object
export async function GET() {
  await ensureSchema();
  const { rows } = await turso.execute("SELECT key, value FROM user_settings");
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key as string] = r.value as string;
  return NextResponse.json(settings);
}

// PUT /api/settings — upsert one or more key/value pairs
export async function PUT(req: Request) {
  await ensureSchema();
  const body: Record<string, string> = await req.json();
  await turso.batch(
    Object.entries(body).map(([key, value]) => ({
      sql: `INSERT INTO user_settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      args: [key, value],
    })),
    "write"
  );
  return NextResponse.json({ ok: true });
}
