"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BookCard } from "@/components/BookCard";
import { UploadZone } from "@/components/UploadZone";
import { parseEpubFile } from "@/lib/epub";
import { getAllBooks, saveBook, deleteBook, type StoredBook } from "@/lib/db";

export default function LibraryPage() {
  const router = useRouter();
  const [books, setBooks] = useState<StoredBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    getAllBooks()
      .then((b) => setBooks(b.sort((a, z) => z.addedAt - a.addedAt)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleFile(file: File) {
    setImporting(true);
    try {
      const parsed = await parseEpubFile(file);
      const book: StoredBook = { ...parsed, addedAt: Date.now() };
      await saveBook(book);
      setBooks((prev) => [book, ...prev]);
      toast.success(`"${parsed.title}" added to library`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to import EPUB. Make sure the file is valid.");
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteBook(id);
    setBooks((prev) => prev.filter((b) => b.id !== id));
    toast.success("Book removed");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center gap-3">
        <BookOpen className="w-6 h-6 text-primary" />
        <h1 className="text-xl font-bold tracking-tight">epub reader</h1>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <UploadZone onFile={handleFile} loading={importing} />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : books.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Your library is empty. Upload an EPUB to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
