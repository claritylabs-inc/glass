"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { X, Paperclip, Trash2, FileText } from "lucide-react";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const LABEL_CLASSES =
  "text-label-sm font-medium text-muted-foreground block mb-1";

export function InviteClientDrawer({
  brokerOrgId,
  open,
  onOpenChange,
  resumeClientOrgId,
}: {
  brokerOrgId: Id<"organizations">;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resumeClientOrgId?: Id<"organizations"> | null;
}) {
  const [draftId, setDraftId] = useState<Id<"organizations"> | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedFor = useRef<Id<"organizations"> | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createDraft = useMutation((api as any).clientInvitations.createDraftClient);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateDraft = useMutation((api as any).clientInvitations.updateDraftClient);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendInvite = useAction((api as any).clientInvitations.sendDraftInvite);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generateUploadUrl = useMutation((api as any).policies.generateUploadUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createBrokerUpload = useMutation((api as any).policies.createBrokerUpload);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draftPolicies = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).policies.listForBroker,
    draftId ? { clientOrgId: draftId } : "skip",
  ) as { _id: Id<"policies">; fileName?: string }[] | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hydrateDraft = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).clientInvitations.getDraftClient,
    resumeClientOrgId ? { clientOrgId: resumeClientOrgId } : "skip",
  );

  // When opening in resume mode, load the existing draft into local state.
  useEffect(() => {
    if (!open) return;
    if (!resumeClientOrgId) return;
    if (hydratedFor.current === resumeClientOrgId) return;
    if (!hydrateDraft) return;
    hydratedFor.current = resumeClientOrgId;
    setDraftId(resumeClientOrgId);
    setCompanyName(hydrateDraft.name ?? "");
    setContactName(hydrateDraft.primaryContactName ?? "");
    setContactEmail(hydrateDraft.primaryContactEmail ?? "");
    setMessage(hydrateDraft.customMessage ?? "");
  }, [open, resumeClientOrgId, hydrateDraft]);

  const emailValid = contactEmail.includes("@") && contactEmail.includes(".");
  const canCreateDraft = companyName.trim().length > 0 && emailValid && !draftId;

  async function ensureDraft(): Promise<Id<"organizations"> | null> {
    if (draftId) return draftId;
    if (!canCreateDraft) return null;
    try {
      const { clientOrgId } = await createDraft({
        brokerOrgId,
        clientOrgName: companyName.trim(),
        primaryContactEmail: contactEmail.trim(),
        primaryContactName: contactName.trim() || undefined,
        customMessage: message.trim() || undefined,
      });
      setDraftId(clientOrgId);
      return clientOrgId;
    } catch (err) {
      toast.error(String(err));
      return null;
    }
  }

  // Create the draft as soon as company name + email are both filled.
  useEffect(() => {
    if (!canCreateDraft) return;
    void ensureDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreateDraft]);

  // Patch draft on field blur.
  async function commitField(field: "clientOrgName" | "primaryContactName" | "primaryContactEmail" | "customMessage", value: string) {
    if (!draftId) return;
    try {
      await updateDraft({ clientOrgId: draftId, [field]: value });
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const id = await ensureDraft();
    if (!id) {
      toast.error("Fill in company name and email first");
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".pdf")) {
          toast.error(`${file.name}: only PDFs are supported`);
          continue;
        }
        const uploadUrl = await generateUploadUrl({});
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });
        if (!res.ok) throw new Error(`Upload failed for ${file.name}`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await createBrokerUpload({
          clientOrgId: id,
          fileId: storageId,
          fileName: file.name,
          documentType: "policy",
        });
      }
      toast.success("Policies uploaded");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const id = await ensureDraft();
    if (!id) {
      toast.error("Fill in company name and email first");
      return;
    }
    setSending(true);
    try {
      // Persist any pending edits before sending.
      await updateDraft({
        clientOrgId: id,
        clientOrgName: companyName.trim(),
        primaryContactName: contactName.trim(),
        primaryContactEmail: contactEmail.trim(),
        customMessage: message.trim(),
      });
      await sendInvite({ clientOrgId: id });
      toast.success(`Invite sent to ${contactEmail}`);
      resetAndClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSending(false);
    }
  }

  function resetAndClose() {
    setDraftId(null);
    setCompanyName("");
    setContactName("");
    setContactEmail("");
    setMessage("");
    hydratedFor.current = null;
    onOpenChange(false);
  }

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setIsDraggingState(true);
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: PointerEvent) => {
        if (!isDragging.current) return;
        const delta = startX - ev.clientX;
        setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
      };
      const onUp = () => {
        isDragging.current = false;
        setIsDraggingState(false);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [width],
  );

  const isResuming = !!resumeClientOrgId;
  const title = isResuming ? "Resume draft" : "Invite client";

  return (
    <AnimatePresence mode="popLayout">
      {open && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width }}
          exit={{ width: 0 }}
          transition={isDraggingState ? { duration: 0 } : { duration: 0.4, ease: EASE }}
          className="max-lg:!fixed max-lg:!inset-0 max-lg:!z-50 max-lg:!w-full flex shrink-0 overflow-hidden h-full relative"
        >
          <div
            onPointerDown={onPointerDown}
            className="hidden lg:block absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-foreground/8 active:bg-foreground/12 transition-colors"
          />

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="max-lg:!w-full flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width }}
          >
            <div className="h-12 flex items-center gap-3 px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground truncate flex-1">
                {title}
              </span>
              <button
                type="button"
                onClick={resetAndClose}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSend}
              className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
            >
              <div>
                <label htmlFor="companyName" className={LABEL_CLASSES}>
                  Client company name
                </label>
                <input
                  id="companyName"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onBlur={() => commitField("clientOrgName", companyName.trim())}
                  placeholder="Acme Corp"
                  className={INPUT_CLASSES}
                />
              </div>
              <div>
                <label htmlFor="contactName" className={LABEL_CLASSES}>
                  Primary contact name
                </label>
                <input
                  id="contactName"
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  onBlur={() => commitField("primaryContactName", contactName.trim())}
                  placeholder="Jane Smith"
                  className={INPUT_CLASSES}
                />
              </div>
              <div>
                <label htmlFor="contactEmail" className={LABEL_CLASSES}>
                  Primary contact email
                </label>
                <input
                  id="contactEmail"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  onBlur={() => commitField("primaryContactEmail", contactEmail.trim())}
                  placeholder="jane@acmecorp.com"
                  className={INPUT_CLASSES}
                />
              </div>
              <div>
                <label htmlFor="message" className={LABEL_CLASSES}>
                  Optional message
                </label>
                <textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onBlur={() => commitField("customMessage", message.trim())}
                  placeholder="We'd love to help with your insurance…"
                  rows={3}
                  className={INPUT_CLASSES}
                />
              </div>

              {/* Policies */}
              <div className="space-y-2">
                <span className={LABEL_CLASSES}>
                  Policies{" "}
                  <span className="text-muted-foreground/60 font-normal">
                    (optional — attach for the client to see on accept)
                  </span>
                </span>
                {draftPolicies && draftPolicies.length > 0 && (
                  <ul className="space-y-1">
                    {draftPolicies.map((p) => (
                      <li
                        key={p._id}
                        className="flex items-center gap-2 rounded-md border border-foreground/8 bg-popover px-3 py-2 text-body-sm"
                      >
                        <FileText className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                        <span className="flex-1 truncate">{p.fileName ?? "Document"}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || !canCreateDraft && !draftId}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/12 bg-transparent px-3 py-3 text-body-sm text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  {uploading ? "Uploading…" : "Attach policy PDFs"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    void handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                {!draftId && !canCreateDraft && (
                  <p className="text-xs text-muted-foreground/60">
                    Fill in company name and email to attach policies.
                  </p>
                )}
              </div>

              <PillButton
                type="submit"
                variant="primary"
                disabled={!emailValid || sending || !companyName.trim()}
                className="w-full"
              >
                {sending ? "Sending…" : "Send invite"}
              </PillButton>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
