"use client";

export type BlockType = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "blockquote" | "li";

export interface TextBlock {
  type: BlockType;
  words: string[];
}

export interface ParsedChapter {
  title: string;
  href: string;
  blocks: TextBlock[];
  plainText: string;
}

export interface ParsedBook {
  id: string;
  title: string;
  author: string;
  cover: string | null;
  epubData: ArrayBuffer;
  chapters: { title: string; spineIdx: number }[];
}

export async function parseEpubFile(file: File): Promise<ParsedBook> {
  const Epub = (await import("epubjs")).default;
  const arrayBuffer = await file.arrayBuffer();
  const book = Epub(arrayBuffer.slice(0));

  await book.ready;

  const metadata = await book.loaded.metadata;
  const title: string = (metadata as any).title || file.name.replace(/\.epub$/i, "");
  const author: string = (metadata as any).creator || "Unknown";

  // Cover
  let cover: string | null = null;
  try {
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      const res = await fetch(coverUrl);
      const blob = await res.blob();
      cover = await blobToBase64(blob);
    }
  } catch {}

  // Build chapter list from TOC, mapped to spine indices
  const nav = await book.loaded.navigation;
  const tocItems: any[] = (nav as any)?.toc || [];

  const spine: any = book.spine;
  const spineItems: any[] = spine?.items || [];

  // Flatten nested TOC — chapters are often subitems under Part headings
  // Preserve depth so the sidebar can indent accordingly
  function flattenToc(items: any[], depth = 0): { item: any; level: number }[] {
    return items.reduce((acc: { item: any; level: number }[], item: any) => {
      acc.push({ item, level: depth });
      if (item.subitems?.length) acc.push(...flattenToc(item.subitems, depth + 1));
      return acc;
    }, []);
  }
  const allTocItems = flattenToc(tocItems);

  // For each TOC entry, find its spine index by matching filename
  const chapters: { title: string; spineIdx: number; level: number }[] = allTocItems
    .map(({ item: tocItem, level }) => {
      const tocHref = (tocItem.href || "").split("#")[0];
      const tocFilename = tocHref.split("/").pop() || "";
      const spineIdx = spineItems.findIndex((si: any) => {
        const siHref = si.href || si.url || "";
        const siFilename = siHref.split("/").pop()?.split("#")[0] || "";
        return siFilename === tocFilename || siHref === tocHref || siHref.endsWith(tocHref);
      });
      return { title: tocItem.label?.trim() || "Chapter", spineIdx, level };
    })
    .filter((c) => c.spineIdx >= 0); // drop TOC entries with no matching spine item

  book.destroy();

  return {
    id: generateId(),
    title,
    author,
    cover,
    epubData: arrayBuffer,
    chapters,
  };
}

export async function loadChapter(epubData: ArrayBuffer, chapterIdx: number, chapterTitle: string): Promise<ParsedChapter> {
  const Epub = (await import("epubjs")).default;
  const book = Epub(epubData.slice(0));

  // Silence the built-in replacements/replaceCss hook — it requires a
  // resource manager that's unavailable when loading from an ArrayBuffer.
  (book as any).replacements = () => Promise.resolve([]);
  if (!(book as any).resources) {
    (book as any).resources = { replaceCss: () => Promise.resolve([]) };
  }

  await book.ready;
  const spine: any = book.spine;

  // spine.items are plain metadata objects — use spine.get() to get a Section with .load()
  const item = spine.get(chapterIdx);
  if (!item) {
    book.destroy();
    return { title: chapterTitle, href: "", blocks: [], plainText: "" };
  }

  try {
    await item.load(book.load.bind(book));
  } catch {
    // epubjs content hooks (e.g. replaceCss) may throw after document is
    // already set — continue if we have the document, otherwise re-throw below.
  }

  const doc: Document = item.document;
  if (!doc) {
    book.destroy();
    return { title: chapterTitle, href: item.href || "", blocks: [], plainText: "" };
  }

  const { blocks, plainText } = extractContent(doc);
  item.unload();
  book.destroy();
  return { title: chapterTitle, href: item.href || "", blocks, plainText };
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function extractContent(doc: Document): { blocks: TextBlock[]; plainText: string } {
  const body = doc.body;
  if (!body) return { blocks: [], plainText: "" };

  const elements = Array.from(body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, blockquote, li"));

  let blocks: TextBlock[] = [];

  if (elements.length > 0) {
    for (const el of elements) {
      const text = el.textContent?.replace(/\s+/g, " ").trim() || "";
      if (text.length < 2) continue;
      const tag = el.tagName.toLowerCase();
      const type: BlockType = (HEADING_TAGS.has(tag) || tag === "blockquote" || tag === "li")
        ? (tag as BlockType)
        : "p";
      blocks.push({ type, words: text.split(/\s+/).filter((w) => w.length > 0) });
    }
  }

  // Fallback: plain body text split by double newlines
  if (blocks.length === 0) {
    const raw = body.textContent?.trim() || "";
    const textBlocks = raw.split(/\n{2,}/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    blocks = textBlocks.map((t) => ({ type: "p" as const, words: t.split(/\s+/).filter((w) => w.length > 0) }));
  }

  const plainText = blocks.map((b) => b.words.join(" ")).join("\n\n");
  return { blocks, plainText };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function base64ToObjectUrl(base64: string, mimeType = "audio/mp3"): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}
