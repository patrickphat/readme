import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { Readable } from "stream";

export const maxDuration = 60;

interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

// Split long text into sentence-level chunks to avoid API timeouts
function splitIntoChunks(text: string, maxChars = 1500): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

async function synthesizeChunk(
  tts: MsEdgeTTS,
  text: string,
  timeOffsetMs: number
): Promise<{ audioChunks: Buffer[]; timestamps: WordTimestamp[] }> {
  const { audioStream, metadataStream } = tts.toStream(text) as {
    audioStream: Readable;
    metadataStream: Readable | null;
  };

  const audioChunks: Buffer[] = [];
  const timestamps: WordTimestamp[] = [];

  const audioPromise = new Promise<void>((resolve, reject) => {
    audioStream.on("data", (chunk: Buffer) => audioChunks.push(Buffer.from(chunk)));
    audioStream.on("end", resolve);
    audioStream.on("error", reject);
  });

  const metaPromise = new Promise<void>((resolve) => {
    if (!metadataStream) { resolve(); return; }
    let buffer = "";
    metadataStream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      // try to parse accumulated data
      try {
        const data = JSON.parse(buffer);
        buffer = "";
        const items: any[] = data.Metadata || [];
        for (const item of items) {
          if (item.Type === "WordBoundary") {
            timestamps.push({
              word: item.Data.text.Text,
              startMs: Math.round(item.Data.Offset / 10000) + timeOffsetMs,
              endMs: Math.round((item.Data.Offset + item.Data.Duration) / 10000) + timeOffsetMs,
            });
          }
        }
      } catch {}
    });
    metadataStream.on("end", () => {
      // parse any remaining buffer
      if (buffer) {
        try {
          const data = JSON.parse(buffer);
          const items: any[] = data.Metadata || [];
          for (const item of items) {
            if (item.Type === "WordBoundary") {
              timestamps.push({
                word: item.Data.text.Text,
                startMs: Math.round(item.Data.Offset / 10000) + timeOffsetMs,
                endMs: Math.round((item.Data.Offset + item.Data.Duration) / 10000) + timeOffsetMs,
              });
            }
          }
        } catch {}
      }
      resolve();
    });
    metadataStream.on("error", resolve);
  });

  await Promise.all([audioPromise, metaPromise]);
  return { audioChunks, timestamps };
}

export async function POST(req: Request) {
  const { text, voice = "en-US-JennyNeural" } = await req.json();

  if (!text || typeof text !== "string") {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
    });

    const chunks = splitIntoChunks(text.trim());
    const allAudioChunks: Buffer[] = [];
    const allTimestamps: WordTimestamp[] = [];
    let timeOffsetMs = 0;

    for (const chunk of chunks) {
      const { audioChunks, timestamps } = await synthesizeChunk(tts, chunk, timeOffsetMs);
      allAudioChunks.push(...audioChunks);
      allTimestamps.push(...timestamps);
      // estimate duration from last timestamp + small gap
      if (timestamps.length > 0) {
        timeOffsetMs = timestamps[timestamps.length - 1].endMs + 200;
      }
    }

    tts.close();

    const audioBuffer = Buffer.concat(allAudioChunks);
    const audioBase64 = audioBuffer.toString("base64");

    return Response.json({ audioBase64, timestamps: allTimestamps });
  } catch (err) {
    console.error("TTS error:", err);
    return Response.json({ error: "TTS generation failed" }, { status: 500 });
  }
}
