"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2, LogOut, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BookCard } from "@/components/BookCard";
import { UploadZone } from "@/components/UploadZone";
import { parseEpubFile } from "@/lib/epub";
import { getAllBooks, saveBook, deleteBook, type StoredBook } from "@/lib/db";
import { deleteCachedEpub } from "@/lib/epub-cache";
import { useTheme } from "@/components/ThemeProvider";

interface UploadingItem {
  id: string;
  name: string;
}

export default function LibraryPage() {
  const router = useRouter();
  const { theme, toggle: toggleTheme } = useTheme();
  const [books, setBooks] = useState<StoredBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<UploadingItem[]>([]);

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  useEffect(() => {
    getAllBooks()
      .then((b) => setBooks(b.sort((a, z) => z.addedAt - a.addedAt)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleFile(file: File) {
    const tempId = Math.random().toString(36).slice(2);
    setUploading((prev) => [...prev, { id: tempId, name: file.name }]);
    try {
      const parsed = await parseEpubFile(file);
      const book: StoredBook = { ...parsed, addedAt: Date.now() };
      await saveBook(book);
      setBooks((prev) => [book, ...prev]);
      toast.success(`"${parsed.title}" added`);
    } catch (err) {
      console.error(err);
      toast.error(`Failed to import "${file.name}"`);
    } finally {
      setUploading((prev) => prev.filter((u) => u.id !== tempId));
    }
  }

  async function handleDelete(id: string) {
    await Promise.all([deleteBook(id), deleteCachedEpub(id)]);
    setBooks((prev) => prev.filter((b) => b.id !== id));
    toast.success("Book removed");
  }

  const isEmpty = !loading && books.length === 0 && uploading.length === 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center gap-3">
        <BookOpen className="w-6 h-6 text-primary" />
        <h1 className="text-xl font-bold tracking-tight flex-1">epub reader</h1>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={handleLogout} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <UploadZone onFile={handleFile} loading={false} />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : isEmpty ? (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Your library is empty. Upload an EPUB to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 sm:gap-4">
            {/* In-progress uploads show first */}
            {uploading.map((u) => (
              <div key={u.id} className="flex flex-col gap-2">
                <div className="aspect-[2/3] rounded-lg bg-muted animate-pulse flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground text-center truncate px-1">{u.name}</p>
                <p className="text-xs text-primary text-center">Uploading…</p>
              </div>
            ))}

            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onOpen={(id) => router.push(`/book/${id}`)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
