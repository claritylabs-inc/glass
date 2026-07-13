"use client";

import { useCallback, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMutation } from "convex/react";
import { isValidPhoneNumber } from "react-phone-number-input";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { Input } from "@/components/ui/input";
import {
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cachedQueryArgsKey,
  cachedQueryCollectionFor,
  useCachedQuery,
} from "@/lib/sync/use-cached-query";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";

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
  brokerCompanyName: string;
  producerId?: Id<"users">;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

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
        <Loader2 className="size-5 animate-spin" />
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
      key={orgId}
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
  const updateBrokerAssignment = useMutation(
    api.orgs.updateClientBrokerAssignment,
  );
  const [brokerCompanyName, setBrokerCompanyName] = useState(
    identity.brokerCompanyName ?? "",
  );
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
  const [textFieldFocused, setTextFieldFocused] = useState(false);
  const currentState = useMemo(
    () => ({
      brokerCompanyName,
      producerId,
      contactName,
      contactEmail,
      contactPhone,
    }),
    [brokerCompanyName, contactEmail, contactName, contactPhone, producerId],
  );
  const selectedMember = useMemo(
    () => identity.brokerMembers.find((member) => member.userId === producerId),
    [identity.brokerMembers, producerId],
  );
  const phoneInvalid =
    identity.canEdit &&
    contactPhone.trim().length > 0 &&
    !isValidPhoneNumber(contactPhone);
  const emailInvalid = identity.canEdit && optionalEmailInvalid(contactEmail);

  const saveBrokerIdentity = useCallback(
    async (args: BrokerIdentitySaveArgs) => {
      await updateBrokerAssignment({
        clientOrgId: args.orgId,
        brokerCompanyName: args.brokerCompanyName,
        producerId: args.producerId,
        contactName: args.contactName,
        contactEmail: args.contactEmail,
        contactPhone: args.contactPhone,
      });
    },
    [updateBrokerAssignment],
  );

  const autoSave = useLocalFirstAutoSave({
    mutationName: `brokerIdentity.update.${orgId}`,
    args: {
      orgId,
      brokerCompanyName,
      producerId: producerId || undefined,
      contactName,
      contactEmail,
      contactPhone,
    },
    valueKey: JSON.stringify(currentState),
    enabled: identity.canEdit,
    canSave: !phoneInvalid && !emailInvalid,
    autoSave: !textFieldFocused,
    applyLocal: (store, args) => {
      const collection = cachedQueryCollectionFor<BrokerIdentity | null>(
        "orgs.getBrokerIdentity",
      );
      const argsKey = cachedQueryArgsKey({ orgId: args.orgId });
      const current = store.getCollection(collection, argsKey)?.[0]?.value;
      if (!current) return;

      void store.upsertCollection(collection, argsKey, [
        {
          _id: "result",
          value: {
            ...current,
            brokerCompanyName: args.brokerCompanyName,
            selectedContactUserId: args.producerId,
            contactName: args.contactName,
            contactEmail: args.contactEmail,
            contactPhone: args.contactPhone,
            overrides: {
              contactName: args.contactName,
              contactEmail: args.contactEmail,
              contactPhone: args.contactPhone,
            },
          },
          updatedAt: dayjs().valueOf(),
        },
      ]);
    },
    flush: saveBrokerIdentity,
    errorMessage: (error) =>
      error instanceof Error
        ? error.message
        : "The broker contact could not be saved.",
  });

  function finishTextEdit() {
    setTextFieldFocused(false);
    void autoSave.saveNow();
  }

  function selectProducer(value: string | null) {
    if (value === NO_PRODUCER_ID || !value) {
      setProducerId("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      return;
    }
    const nextProducerId = value as Id<"users">;
    const member = identity.brokerMembers.find(
      (candidate) => candidate.userId === nextProducerId,
    );
    setProducerId(nextProducerId);
    setContactName(member?.name ?? "");
    setContactEmail(member?.email ?? "");
    setContactPhone(member?.phone ?? "");
  }

  const noContact =
    !identity.brokerCompanyName &&
    !identity.contactName &&
    !identity.contactEmail &&
    !identity.contactPhone;

  const header = surface === "card" ? (
    <OperationalPanelHeader
      title="Broker contact"
      description={
        identity.canEdit
          ? identity.connected
            ? "Choose the producer this client should contact."
            : "Add the broker this organization should contact."
          : "The broker manages the contact shown to this client."
      }
      action={
        identity.canEdit ? <AutoSaveStatus status={autoSave.status} /> : null
      }
      className="px-5 py-4"
    />
  ) : null;

  if (!identity.canEdit) {
    const readOnlyContent = noContact ? (
      <OperationalPanelBody className="px-5 py-8 text-base text-muted-foreground">
        No broker contact is assigned.
      </OperationalPanelBody>
    ) : (
      <dl>
        <OperationalLabelValueRow
          label="Broker company"
          value={identity.brokerCompanyName}
        />
        <OperationalLabelValueRow
          label="Contact"
          value={identity.contactName}
        />
        <OperationalLabelValueRow label="Email" value={identity.contactEmail} />
        <OperationalLabelValueRow label="Phone" value={identity.contactPhone} />
      </dl>
    );

    return surface === "card" ? (
      <OperationalPanel>
        {header}
        {readOnlyContent}
      </OperationalPanel>
    ) : (
      <section className="space-y-4">{readOnlyContent}</section>
    );
  }

  const editor = (
    <OperationalPanelBody className="space-y-5 px-5 py-5">
      <div
        className={
          surface === "plain" ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"
        }
      >
        <div>
          <label className="mb-1.5 block text-label font-medium text-muted-foreground">
            Broker company
          </label>
          {identity.connected ? (
            <div className="flex h-9 items-center rounded-lg border border-foreground/6 bg-foreground/3 px-3 text-base text-foreground">
              {identity.brokerCompanyName || "Broker"}
            </div>
          ) : (
            <Input
              value={brokerCompanyName}
              onChange={(event) => setBrokerCompanyName(event.target.value)}
              onFocus={() => setTextFieldFocused(true)}
              onBlur={finishTextEdit}
              placeholder="Broker company"
            />
          )}
        </div>

        {identity.connected ? (
          <div>
            <label className="mb-1.5 block text-label font-medium text-muted-foreground">
              Assigned producer
            </label>
            <Select
              value={producerId || NO_PRODUCER_ID}
              onValueChange={selectProducer}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRODUCER_ID}>
                  No specific producer
                </SelectItem>
                {identity.brokerMembers.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.name ?? member.email ?? "Team member"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div
        className={
          surface === "plain" ? "grid gap-4" : "grid gap-4 sm:grid-cols-3"
        }
      >
        <div>
          <label className="mb-1.5 block text-label font-medium text-muted-foreground">
            Display name
          </label>
          <Input
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            onFocus={() => setTextFieldFocused(true)}
            onBlur={finishTextEdit}
            placeholder={selectedMember?.name ?? "Contact name"}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-label font-medium text-muted-foreground">
            Email
          </label>
          <Input
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            onFocus={() => setTextFieldFocused(true)}
            onBlur={finishTextEdit}
            placeholder={selectedMember?.email ?? "broker@example.com"}
            type="email"
            aria-invalid={emailInvalid}
          />
          {emailInvalid ? (
            <p className="mt-1.5 text-label text-destructive">
              Enter a valid email address.
            </p>
          ) : null}
        </div>
        <div>
          <label className="mb-1.5 block text-label font-medium text-muted-foreground">
            Phone
          </label>
          <PhoneInput
            value={contactPhone || undefined}
            onChange={(value) => setContactPhone(value ?? "")}
            onFocus={() => setTextFieldFocused(true)}
            onBlur={finishTextEdit}
            defaultCountry="US"
            placeholder={selectedMember?.phone ?? "(555) 555-5555"}
            aria-invalid={phoneInvalid}
          />
          <p className="mt-1.5 text-label text-muted-foreground">
            {phoneInvalid
              ? "Enter a valid phone number with country code."
              : "Used for iMessage conversations with this producer."}
          </p>
        </div>
      </div>
    </OperationalPanelBody>
  );

  return surface === "card" ? (
    <OperationalPanel>
      {header}
      {editor}
    </OperationalPanel>
  ) : (
    <section className="space-y-4">{editor}</section>
  );
}
