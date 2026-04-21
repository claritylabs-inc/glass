"use client";

import { useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export type DocumentType = "policy" | "quote" | "application";

interface PolicyUploadDrawerProps {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File, documentType: DocumentType, note: string) => Promise<void>;
  uploading: boolean;
  /** When true, shows the "Application form" radio option (broker-side only) */
  showApplicationOption?: boolean;
}

export function PolicyUploadDrawer({
  open,
  onClose,
  onUpload,
  uploading,
  showApplicationOption = false,
}: PolicyUploadDrawerProps) {
  const [documentType, setDocumentType] = useState<DocumentType>("policy");
  const [note, setNote] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        toast.error("Please upload a PDF file.");
        return;
      }
      await onUpload(file, documentType, note);
      setNote("");
      onClose();
    },
    [documentType, note, onUpload, onClose],
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[400px] sm:w-[480px]">
        <SheetHeader>
          <SheetTitle>Upload policy / quote</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/30"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <p className="text-sm text-muted-foreground mb-3">
              Drop a PDF here or
            </p>
            <label className="cursor-pointer">
              <Button variant="outline" size="sm" type="button">
                Browse files
              </Button>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
          </div>

          <div className="space-y-2">
            <Label>Document type</Label>
            <RadioGroup
              value={documentType}
              onValueChange={(v) => setDocumentType(v as DocumentType)}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="policy" id="type-policy" />
                <Label htmlFor="type-policy">Policy</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="quote" id="type-quote" />
                <Label htmlFor="type-quote">Quote</Label>
              </div>
              {showApplicationOption && (
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="application" id="type-application" />
                  <Label htmlFor="type-application">Application form</Label>
                </div>
              )}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea
              id="note"
              placeholder="Add context for the client…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>

          <Button
            className="w-full"
            disabled={uploading}
            onClick={() => {
              const input =
                document.querySelector<HTMLInputElement>('input[type="file"]');
              input?.click();
            }}
          >
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
