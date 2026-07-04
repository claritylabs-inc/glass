"use client";

import { useCallback, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMutation } from "convex/react";
import { isValidPhoneNumber } from "react-phone-number-input";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PhoneInput } from "@/components/ui/phone-input";
import { OperationalPanel } from "@/components/ui/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import {
  cachedQueryArgsKey,
  cachedQueryCollectionFor,
  useCachedQuery,
} from "@/lib/sync/use-cached-query";

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors disabled:opacity-50";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NO_PRODUCER_ID = "__none";

function optionalEmailInvalid(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 && !EMAIL_PATTERN.test(trimmed);
}

export type BrokerIdentity = {
  brokerCompanyName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  source?: "assignment" | "none";
  connected: boolean;
  canEdit: boolean;
  selectedContactUserId?: Id<"users">;
  overrides?: {
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
  } | null;
  brokerMembers: Array<{
    userId: Id<"users">;
    name?: string;
    email?: string;
    phone?: string;
  }>;
};

type BrokerIdentitySaveArgs = {
  orgId: Id<"organizations">;
  producerId?: Id<"users">;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

function identityKey(identity: BrokerIdentity) {
  return [
    identity.connected ? "connected" : "none",
    identity.brokerCompanyName ?? "",
    identity.contactName ?? "",
    identity.contactEmail ?? "",
    identity.contactPhone ?? "",
    identity.selectedContactUserId ?? "",
    identity.overrides?.contactName ?? "",
    identity.overrides?.contactEmail ?? "",
    identity.overrides?.contactPhone ?? "",
  ].join("|");
}

export function BrokerIdentitySection({
  orgId,
  surface = "card",
}: {
  orgId: Id<"organizations">;
  surface?: "card" | "plain";
}) {
  const identity = useCachedQuery(
    "orgs.getBrokerIdentity",
    api.orgs.getBrokerIdentity,
    { orgId },
  ) as BrokerIdentity | null | undefined;

  if (identity === undefined) {
    const content = (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

    return surface === "card" ? (
      <OperationalPanel>{content}</OperationalPanel>
    ) : (
      <section className="min-h-28">{content}</section>
    );
  }

  if (!identity) return null;

  return (
    <BrokerIdentityForm
      key={identityKey(identity)}
      orgId={orgId}
      identity={identity}
      surface={surface}
    />
  );
}

function BrokerIdentityForm({
  orgId,
  identity,
  surface,
}: {
  orgId: Id<"organizations">;
  identity: BrokerIdentity;
  surface: "card" | "plain";
}) {
  const updateBrokerAssignment = useMutation(api.orgs.updateClientBrokerAssignment);
  const [producerId, setProducerId] = useState<Id<"users"> | "">(
    identity.selectedContactUserId ?? "",
  );
  const [contactName, setContactName] = useState(
    identity.overrides?.contactName ?? identity.contactName ?? "",
  );
  const [contactEmail, setContactEmail] = useState(
    identity.overrides?.contactEmail ?? identity.contactEmail ?? "",
  );
  const [contactPhone, setContactPhone] = useState(
    identity.overrides?.contactPhone ?? identity.contactPhone ?? "",
  );
  const currentState = useMemo(
    () => ({
      producerId,
      contactName,
      contactEmail,
      contactPhone,
    }),
    [producerId, contactName, contactEmail, contactPhone],
  );
  const currentStateKey = useMemo(
    () => JSON.stringify(currentState),
    [currentState],
  );
  const selectedMember = useMemo(
    () => identity.brokerMembers.find((member) => member.userId === producerId),
    [identity.brokerMembers, producerId],
  );
  const phoneInvalid =
    identity.canEdit &&
    contactPhone.trim().length > 0 &&
    !isValidPhoneNumber(contactPhone);
  const emailInvalid =
    identity.canEdit && optionalEmailInvalid(contactEmail);
  const twoColumnGridClass =
    surface === "plain" ? "grid gap-4" : "grid gap-4 sm:grid-cols-2";
  const threeColumnGridClass =
    surface === "plain" ? "grid gap-4" : "grid gap-4 sm:grid-cols-3";

  const saveBrokerIdentity = useCallback(
    async (args: BrokerIdentitySaveArgs) => {
      await updateBrokerAssignment({
        clientOrgId: args.orgId,
        producerId: args.producerId,
        contactName: args.contactName,
        contactEmail: args.contactEmail,
        contactPhone: args.contactPhone,
      });
    },
    [updateBrokerAssignment],
  );

  const saveArgs: BrokerIdentitySaveArgs = {
    orgId,
    producerId: producerId || undefined,
    contactName,
    contactEmail,
    contactPhone,
  };

  const autoSave = useLocalFirstAutoSave({
    mutationName: `brokerIdentity.update.${orgId}`,
    args: saveArgs,
    valueKey: currentStateKey,
    canSave:
      identity.canEdit &&
      !phoneInvalid &&
      !emailInvalid,
    applyLocal: (store, args) => {
      const collection = cachedQueryCollectionFor<BrokerIdentity | null>(
        "orgs.getBrokerIdentity",
      );
      const argsKey = cachedQueryArgsKey({ orgId: args.orgId });
      const current = store.getCollection(collection, argsKey)?.[0]?.value;
      if (!current) return;

      const next = {
        ...current,
        selectedContactUserId: args.producerId,
        contactName: args.contactName,
        contactEmail: args.contactEmail,
        contactPhone: args.contactPhone,
        overrides: {
          contactName: args.contactName,
          contactEmail: args.contactEmail,
          contactPhone: args.contactPhone,
        },
      };

      void store.upsertCollection(collection, argsKey, [
        {
          _id: "result",
          value: next,
          updatedAt: dayjs().valueOf(),
        },
      ]);
    },
    flush: saveBrokerIdentity,
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save broker contact",
      ),
  });

  const saving = autoSave.saving;
  const savedAt = autoSave.savedAt;

  const content = (
    <>
      {surface === "card" ? (
        <div className="border-b border-foreground/6 px-5 py-3.5">
          <h3 className="mb-0! text-base font-medium text-foreground">
            Broker
          </h3>
        </div>
      ) : null}
      <div
        className={surface === "card" ? "space-y-4 px-5 py-5" : "space-y-4"}
      >
        {!identity.connected ? (
          <p className="text-base text-muted-foreground">
            No broker is assigned to this client.
          </p>
        ) : (
          <>
            <div className={twoColumnGridClass}>
              <div>
                <label className="mb-1.5 block text-label font-medium text-muted-foreground">
                  Broker company
                </label>
                <input
                  value={identity.brokerCompanyName ?? ""}
                  disabled
                  placeholder="Broker company"
                  className={INPUT_CLASSES}
                />
              </div>
              {identity.canEdit ? (
                <div>
                  <label className="mb-1.5 block text-label font-medium text-muted-foreground">
                    Broker user
                  </label>
                  <Select
                    value={producerId || NO_PRODUCER_ID}
                    onValueChange={(value) =>
                      setProducerId(
                        value === NO_PRODUCER_ID
                          ? ""
                          : (value as Id<"users">),
                      )
                    }
                  >
                    <SelectTrigger className="w-full border-foreground/8 bg-popover">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PRODUCER_ID}>
                        No specific user
                      </SelectItem>
                      {identity.brokerMembers.map((member) => (
                        <SelectItem key={member.userId} value={member.userId}>
                          {member.name ?? member.email ?? "Team member"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <label className="mb-1.5 block text-label font-medium text-muted-foreground">
                    Broker contact
                  </label>
                  <input
                    value={identity.contactName ?? ""}
                    disabled
                    placeholder="Contact name"
                    className={INPUT_CLASSES}
                  />
                </div>
              )}
            </div>

            <div className={threeColumnGridClass}>
              <div>
                <label className="mb-1.5 block text-label font-medium text-muted-foreground">
                  Contact name
                </label>
                <input
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  placeholder={selectedMember?.name ?? "Contact name"}
                  disabled={!identity.canEdit}
                  className={INPUT_CLASSES}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-label font-medium text-muted-foreground">
                  Contact email
                </label>
                <input
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  placeholder={selectedMember?.email ?? "broker@example.com"}
                  disabled={!identity.canEdit}
                  type="email"
                  className={INPUT_CLASSES}
                />
                <p className="mt-1.5 min-h-4 text-label text-muted-foreground/60">
                  {emailInvalid ? (
                    <span className="text-red-500/80">
                      Enter a valid email address.
                    </span>
                  ) : null}
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-label font-medium text-muted-foreground">
                  Contact phone
                </label>
                <PhoneInput
                  value={contactPhone || undefined}
                  onChange={(value) => setContactPhone(value ?? "")}
                  defaultCountry="US"
                  disabled={!identity.canEdit}
                  placeholder={selectedMember?.phone ?? "(555) 555-5555"}
                />
                <p className="mt-1.5 min-h-4 text-label text-muted-foreground/60">
                  {phoneInvalid ? (
                    <span className="text-red-500/80">
                      Enter a valid phone number with country code.
                    </span>
                  ) : (
                    "Used when starting iMessage conversations with this broker contact."
                  )}
                </p>
              </div>
            </div>
          </>
        )}

        <div className="flex min-h-5 items-center justify-between gap-3">
          {identity.connected && !identity.canEdit ? (
            <p className="text-base text-muted-foreground">
              This broker information is managed by your broker.
            </p>
          ) : (
            <span />
          )}
          {identity.canEdit ? (
            <span className="flex items-center gap-1.5 text-label text-muted-foreground">
              {saving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving
                </>
              ) : savedAt ? (
                "Saved"
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );

  return surface === "card" ? (
    <OperationalPanel>{content}</OperationalPanel>
  ) : (
    <section className="space-y-4">{content}</section>
  );
}
