"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { isValidPhoneNumber } from "react-phone-number-input";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import {
  OperationalItem,
  OperationalPanel,
} from "@/components/ui/operational-panel";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { PhoneInput } from "@/components/ui/phone-input";
import { PolicyListItem } from "@/components/policy-list-item";
import {
  PolicyUploadModeToggle,
  type PolicyUploadMode,
} from "@/components/policy-upload-mode-toggle";
import { FileText, FileUp, X } from "lucide-react";
import {
  useCachedQuery,
  useSetCachedQuery,
  useUpsertCachedQuery,
} from "@/lib/sync/use-cached-query";

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const LABEL_CLASSES =
  "text-label font-medium text-muted-foreground block mb-1";

function cleanError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (error.message.includes("This phone number is already used")) {
    return "This phone number is already used by another user.";
  }
  if (error.message.includes("Enter a valid phone number")) {
    return "Enter a valid phone number with country code.";
  }
  return error.message.replace(/^[\s\S]*Uncaught Error:\s*/, "") || fallback;
}

function filterPdfs(incoming: File[]) {
  const pdfs: File[] = [];
  let rejected = 0;
  for (const file of incoming) {
    if (file.name.toLowerCase().endsWith(".pdf")) pdfs.push(file);
    else rejected++;
  }
  if (rejected > 0) {
    toast.error(
      rejected === 1
        ? "Skipped a non-PDF file."
        : `Skipped ${rejected} non-PDF files.`,
    );
  }
  return pdfs;
}

type DraftPolicyRow = {
  _id: Id<"policies">;
  carrier?: string;
  mga?: string;
  policyNumber?: string;
  fileName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  pipelineStatus?: string;
  uploadedBySide?: "broker" | "client" | "email_scan" | "agent_email";
};

type BrokerClientRow = {
  invitationId?: Id<"clientInvitations">;
  clientOrgId?: Id<"organizations">;
  name: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  onboardingStatus: "draft" | "invited" | "onboarding" | "active";
  createdAt: number;
  lastActivityAt?: number;
  activePoliciesCount?: number;
  primaryBrokerContactId?: Id<"users">;
};

type DraftClientDetail = {
  clientOrgId: Id<"organizations">;
  name: string;
  website?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  customMessage?: string;
  inviteStatus: "draft" | "invited";
};

export function InviteClientDrawer({
  partnerOrgId,
  open,
  onOpenChange,
  resumeClientOrgId,
}: {
  partnerOrgId: Id<"organizations">;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resumeClientOrgId?: Id<"organizations"> | null;
}) {
  const [draftId, setDraftId] = useState<Id<"organizations"> | null>(null);
  const [orgNameInput, setOrgNameInput] = useState<string | null>(null);
  const [websiteInput, setWebsiteInput] = useState<string | null>(null);
  const [contactNameInput, setContactNameInput] = useState<string | null>(null);
  const [contactEmailInput, setContactEmailInput] = useState<string | null>(
    null,
  );
  const [contactPhoneInput, setContactPhoneInput] = useState<string | null>(null);
  const [debouncedPhone, setDebouncedPhone] = useState("");
  const [policyFiles, setPolicyFiles] = useState<File[]>([]);
  const [policyUploadMode, setPolicyUploadMode] =
    useState<PolicyUploadMode>("combined");
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [uploadingPolicies, setUploadingPolicies] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createDraft = useMutation(api.clientInvitations.createDraftClient);
  const updateDraft = useMutation(api.clientInvitations.updateDraftClient);
  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const createBrokerUpload = useMutation(api.policies.createBrokerUpload);
  const sendInvite = useAction(api.clientInvitations.sendDraftInvite);
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);
  const extractFromUpload = useAction(api.actions.extractFromUpload.extractFromUpload);
  const upsertClientRows = useUpsertCachedQuery<
    BrokerClientRow[],
    { brokerOrgId: Id<"organizations"> }
  >("clients.listForBroker");
  const setDraftCache = useSetCachedQuery<
    DraftClientDetail | null,
    { clientOrgId: Id<"organizations"> }
  >("clientInvitations.getDraftClient");

  const hydrateDraft = useCachedQuery(
    "clientInvitations.getDraftClient",
    api.clientInvitations.getDraftClient,
    resumeClientOrgId ? { clientOrgId: resumeClientOrgId } : "skip",
  );

  const resumedDraftId =
    open && hydrateDraft && resumeClientOrgId ? resumeClientOrgId : null;
  const activeDraftId = draftId ?? resumedDraftId;
  const existingPolicies = useCachedQuery(
    "policies.listForBroker.inviteDraft",
    api.policies.listForBroker,
    activeDraftId
      ? { clientOrgId: activeDraftId, documentType: "policy" }
      : "skip",
  ) as DraftPolicyRow[] | undefined;
  const orgName = orgNameInput ?? hydrateDraft?.name ?? "";
  const website = websiteInput ?? hydrateDraft?.website ?? "";
  const contactName = contactNameInput ?? hydrateDraft?.primaryContactName ?? "";
  const contactEmail =
    contactEmailInput ?? hydrateDraft?.primaryContactEmail ?? "";
  const contactPhone =
    contactPhoneInput ?? hydrateDraft?.primaryContactPhone ?? "";

  const emailValid = contactEmail.includes("@") && contactEmail.includes(".");
  const phoneHasDigits = /\d/.test(contactPhone);
  const phoneValid =
    contactPhone.trim().length > 0 && isValidPhoneNumber(contactPhone);
  const phoneInvalid =
    phoneHasDigits &&
    !phoneValid &&
    contactPhone.trim().replace(/\D/g, "").length >= 7;
  const shouldCheckPhone = emailValid && phoneValid;
  const phoneAvailability = useQuery(
    api.clientInvitations.checkInvitePhoneAvailability,
    shouldCheckPhone && debouncedPhone === contactPhone.trim()
      ? {
          brokerOrgId: partnerOrgId,
          email: contactEmail.trim(),
          phone: debouncedPhone,
        }
      : "skip",
  );
  const phoneChecking =
    shouldCheckPhone &&
    (debouncedPhone !== contactPhone.trim() || phoneAvailability === undefined);
  const phoneUnavailable =
    shouldCheckPhone && phoneAvailability?.available === false;
  const phoneBlocked = phoneInvalid || phoneChecking || phoneUnavailable;
  const canCreateDraft = emailValid && !activeDraftId;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPhone(contactPhone.trim()), 300);
    return () => clearTimeout(timer);
  }, [contactPhone]);

  async function ensureDraft(): Promise<Id<"organizations"> | null> {
    if (activeDraftId) return activeDraftId;
    if (!canCreateDraft) return null;
    try {
      const { clientOrgId } = await createDraft({
        brokerOrgId: partnerOrgId,
        clientOrgName: orgName.trim() || undefined,
        website: website.trim(),
        primaryContactEmail: contactEmail.trim(),
        primaryContactName: contactName.trim(),
        primaryContactPhone: contactPhone.trim(),
      });
      await patchClientDraftCaches(clientOrgId, "draft");
      setDraftId(clientOrgId);
      return clientOrgId;
    } catch (err) {
      toast.error(cleanError(err, "Failed to create client"));
      return null;
    }
  }

  async function persistPendingEdits(id: Id<"organizations">) {
    await updateDraft({
      clientOrgId: id,
      clientOrgName: orgName.trim() || undefined,
      website: website.trim(),
      primaryContactEmail: contactEmail.trim(),
      primaryContactName: contactName.trim(),
      primaryContactPhone: contactPhone.trim(),
    });
    await patchClientDraftCaches(id, undefined);
  }

  async function patchClientDraftCaches(
    clientOrgId: Id<"organizations">,
    status: "draft" | "invited" | undefined,
  ) {
    const now = dayjs().valueOf();
    const name = orgName.trim() || "Draft client";
    const normalizedEmail = contactEmail.trim();
    const normalizedName = contactName.trim() || undefined;
    const normalizedPhone = contactPhone.trim() || undefined;
    const draftStatus = status ?? hydrateDraft?.inviteStatus ?? "draft";
    await Promise.all([
      upsertClientRows({ brokerOrgId: partnerOrgId }, (current) => {
        const existing = current ?? [];
        const nextRow: BrokerClientRow = {
          clientOrgId,
          name,
          primaryContactName: normalizedName,
          primaryContactEmail: normalizedEmail,
          onboardingStatus: draftStatus,
          createdAt:
            existing.find((row) => row.clientOrgId === clientOrgId)
              ?.createdAt ?? now,
          activePoliciesCount:
            existing.find((row) => row.clientOrgId === clientOrgId)
              ?.activePoliciesCount ?? 0,
        };
        return [
          nextRow,
          ...existing.filter((row) => row.clientOrgId !== clientOrgId),
        ].sort((a, b) => b.createdAt - a.createdAt);
      }),
      setDraftCache(
        { clientOrgId },
        {
          clientOrgId,
          name,
          website: website.trim() || undefined,
          primaryContactName: normalizedName,
          primaryContactEmail: normalizedEmail,
          primaryContactPhone: normalizedPhone,
          customMessage: hydrateDraft?.customMessage,
          inviteStatus: draftStatus,
        },
      ),
    ]);
  }

  async function uploadPolicyFiles(id: Id<"organizations">) {
    if (policyFiles.length === 0) return;
    setUploadingPolicies(true);
    try {
      const storageIds: string[] = [];
      for (const file of policyFiles) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: file,
        });
        if (!res.ok) throw new Error("Policy upload failed");
        const { storageId } = (await res.json()) as { storageId: string };
        storageIds.push(storageId);
      }

      if (policyUploadMode === "separate") {
        for (let i = 0; i < storageIds.length; i++) {
          const policyId = await createBrokerUpload({
            clientOrgId: id,
            fileId: storageIds[i] as Id<"_storage">,
            fileName: policyFiles[i].name,
            documentType: "policy",
          });
          const result = await extractFromUpload({
            fileId: storageIds[i] as Id<"_storage">,
            fileName: policyFiles[i].name,
            policyId,
          });
          if (
            result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
          ) {
            throw new Error(result.error);
          }
        }
      } else {
        const policyId = await createBrokerUpload({
          clientOrgId: id,
          fileId: storageIds[0] as Id<"_storage">,
          fileName: policyFiles[0].name,
          documentType: "policy",
        });
        const result = await extractFromUpload({
          fileId: storageIds[0] as Id<"_storage">,
          fileName: policyFiles[0].name,
          policyId,
          additionalFiles: storageIds.slice(1).map((fileId, index) => ({
            fileId: fileId as Id<"_storage">,
            fileName: policyFiles[index + 1].name,
          })),
        });
        if (
          result &&
          typeof result === "object" &&
          "error" in result &&
          typeof result.error === "string"
        ) {
          throw new Error(result.error);
        }
      }
      setPolicyFiles([]);
      toast.success(
        policyUploadMode === "separate" && policyFiles.length > 1
          ? `${policyFiles.length} policies started — extraction will run in the background.`
          : "Policy upload started — extraction will run in the background.",
      );
    } finally {
      setUploadingPolicies(false);
    }
  }

  function enrichWebsiteInBackground(id: Id<"organizations">) {
    const url = website.trim();
    if (!url) return;
    void extractCompanyInfo({ url, orgId: id }).catch(() => {});
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (phoneBlocked) {
      toast.error(
        phoneUnavailable
          ? "This phone number is already used by another user."
          : "Enter a valid phone number with country code.",
      );
      return;
    }
    const id = await ensureDraft();
    if (!id) {
      toast.error("Enter a valid email first");
      return;
    }
    setSending(true);
    try {
      await persistPendingEdits(id);
      enrichWebsiteInBackground(id);
      await uploadPolicyFiles(id);
      await sendInvite({ clientOrgId: id });
      await patchClientDraftCaches(id, "invited");
      toast.success(`Invite sent to ${contactEmail}`);
      resetAndClose();
    } catch (err) {
      toast.error(cleanError(err, "Failed to send invite"));
    } finally {
      setSending(false);
    }
  }

  async function handleCreateWithoutSending() {
    if (phoneBlocked) {
      toast.error(
        phoneUnavailable
          ? "This phone number is already used by another user."
          : "Enter a valid phone number with country code.",
      );
      return;
    }
    const id = await ensureDraft();
    if (!id) {
      toast.error("Enter a valid email first");
      return;
    }
    setSavingDraft(true);
    try {
      await persistPendingEdits(id);
      enrichWebsiteInBackground(id);
      await uploadPolicyFiles(id);
      toast.success(`Client created — you can now add policies`);
      resetAndClose();
    } catch (err) {
      toast.error(cleanError(err, "Failed to create client"));
    } finally {
      setSavingDraft(false);
    }
  }

  function resetAndClose() {
    setDraftId(null);
    setOrgNameInput(null);
    setWebsiteInput(null);
    setContactNameInput(null);
    setContactEmailInput("");
    setContactPhoneInput(null);
    setDebouncedPhone("");
    setPolicyFiles([]);
    setPolicyUploadMode("combined");
    setDragOver(false);
    onOpenChange(false);
  }

  function addPolicyFiles(incoming: File[]) {
    const pdfs = filterPdfs(incoming);
    if (pdfs.length === 0) return;
    setPolicyFiles((prev) => {
      const existing = new Set(prev.map((file) => `${file.name}:${file.size}`));
      return [
        ...prev,
        ...pdfs.filter((file) => !existing.has(`${file.name}:${file.size}`)),
      ];
    });
  }

  const isResuming = !!resumeClientOrgId;
  const title = isResuming ? "Resume draft" : "Invite client";
  const busy = sending || savingDraft || uploadingPolicies;
  const isAlreadyInvited = hydrateDraft?.inviteStatus === "invited";
  const saveLabel = isAlreadyInvited ? "Save changes" : "Create without sending";
  const sendLabel = isAlreadyInvited ? "Save and resend" : "Send invite";

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(value) => {
        if (!value) resetAndClose();
        else onOpenChange(true);
      }}
      title={title}
      footer={
        <>
          <PillButton
            type="button"
            variant="secondary"
            disabled={!emailValid || phoneBlocked || busy}
            onClick={handleCreateWithoutSending}
          >
            {savingDraft || uploadingPolicies ? "Saving…" : saveLabel}
          </PillButton>
          <PillButton
            type="submit"
            form="invite-client-form"
            variant="primary"
            disabled={!emailValid || phoneBlocked || busy}
          >
            {sending || uploadingPolicies ? "Sending…" : sendLabel}
          </PillButton>
        </>
      }
    >
      <form id="invite-client-form" onSubmit={handleSend} className="space-y-4">
        <div>
          <label htmlFor="clientOrgName" className={LABEL_CLASSES}>
            Organization name
          </label>
          <input
            id="clientOrgName"
            type="text"
            value={orgName}
            onChange={(e) => setOrgNameInput(e.target.value)}
            placeholder="Acme Inc."
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <label htmlFor="clientWebsite" className={LABEL_CLASSES}>
            Website
          </label>
          <input
            id="clientWebsite"
            type="text"
            value={website}
            onChange={(e) => setWebsiteInput(e.target.value)}
            placeholder="acme.com"
            className={INPUT_CLASSES}
          />
          <p className="mt-1.5 text-label text-muted-foreground/60">
            Glass will enrich the company profile in the background.
          </p>
        </div>
        <div>
          <label htmlFor="contactName" className={LABEL_CLASSES}>
            User name
          </label>
          <input
            id="contactName"
            type="text"
            value={contactName}
            onChange={(e) => setContactNameInput(e.target.value)}
            placeholder="Jane Smith"
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <label htmlFor="contactEmail" className={LABEL_CLASSES}>
            Client email
          </label>
          <input
            id="contactEmail"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmailInput(e.target.value)}
            placeholder="jane@acmecorp.com"
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <label className={LABEL_CLASSES}>User phone number</label>
          <PhoneInput
            value={contactPhone || undefined}
            onChange={(value) => setContactPhoneInput(value ?? "")}
            defaultCountry="US"
            placeholder="Enter phone number"
          />
          <p className="mt-1.5 min-h-4 text-label text-muted-foreground/60">
            {phoneInvalid ? (
              <span className="text-red-500/80">
                Enter a valid phone number with country code.
              </span>
            ) : phoneChecking ? (
              "Checking phone number"
            ) : phoneUnavailable ? (
              <span className="text-red-500/80">
                This phone number is already used by another user.
              </span>
            ) : shouldCheckPhone && phoneAvailability?.available ? (
              "Phone number is available for iMessage."
            ) : (
              "Used for iMessage access to the client's Glass agent."
            )}
          </p>
        </div>
        <div>
          <label className={LABEL_CLASSES}>Policies</label>
          {activeDraftId && existingPolicies === undefined ? (
            <OperationalPanel
              as="div"
              className="mb-2 px-3 py-2 text-base text-muted-foreground"
            >
              Loading policy uploads…
            </OperationalPanel>
          ) : existingPolicies && existingPolicies.length > 0 ? (
            <OperationalPanel as="div" className="mb-2">
              {existingPolicies.map((policy) => (
                <PolicyListItem
                  key={policy._id}
                  carrier={policy.carrier ?? ""}
                  administrator={policy.mga}
                  policyNumber={policy.policyNumber ?? ""}
                  fileName={policy.fileName}
                  effectiveDate={policy.effectiveDate}
                  expirationDate={policy.expirationDate}
                  pipelineStatus={policy.pipelineStatus}
                  uploadedBySide={policy.uploadedBySide}
                />
              ))}
            </OperationalPanel>
          ) : null}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              addPolicyFiles(Array.from(event.dataTransfer.files));
            }}
            className={`w-full rounded-lg border border-dashed px-4 py-5 text-left transition-colors ${
              dragOver
                ? "border-foreground/25 bg-foreground/3"
                : "border-foreground/10 hover:border-foreground/20"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/4 text-muted-foreground">
                <FileUp className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-medium text-foreground">
                  Upload policy PDFs
                </span>
                <span className="block text-label text-muted-foreground/60">
                  Extraction starts after you create or send the invite.
                </span>
              </span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="sr-only"
              onChange={(event) => {
                addPolicyFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </button>
          {policyFiles.length > 1 ? (
            <PolicyUploadModeToggle
              value={policyUploadMode}
              onChange={setPolicyUploadMode}
              docType="policy"
              disabled={busy}
              className="mt-2"
            />
          ) : null}
          {policyFiles.length > 0 ? (
            <OperationalPanel as="div" className="mt-2">
              {policyFiles.map((file, index) => (
                <OperationalItem
                  key={`${file.name}:${file.size}:${index}`}
                  className="flex items-center gap-2 border-t border-foreground/4 px-3 py-2 first:border-t-0"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-base">
                    {file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPolicyFiles((files) =>
                        files.filter((_, fileIndex) => fileIndex !== index),
                      )
                    }
                    disabled={busy}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-foreground/4 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </OperationalItem>
              ))}
            </OperationalPanel>
          ) : null}
        </div>
      </form>
    </SettingsDrawer>
  );
}
