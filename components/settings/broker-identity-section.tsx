"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery } from "convex/react";
import { isValidPhoneNumber } from "react-phone-number-input";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PhoneInput } from "@/components/ui/phone-input";

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors disabled:opacity-50";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalEmailInvalid(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 && !EMAIL_PATTERN.test(trimmed);
}

export type BrokerIdentity = {
  brokerCompanyName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  source?: "assignment" | "broker_default" | "manual" | "none";
  connected: boolean;
  canEditConnected: boolean;
  canEditManual: boolean;
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

function identityKey(identity: BrokerIdentity) {
  return [
    identity.connected ? "connected" : "manual",
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
  const identity = useQuery(api.orgs.getBrokerIdentity, { orgId }) as
    | BrokerIdentity
    | null
    | undefined;

  if (identity === undefined) {
    return (
      <section
        className={
          surface === "card"
            ? "rounded-lg border border-foreground/6 bg-card"
            : "min-h-28"
        }
      >
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </section>
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
  const updateManual = useMutation(api.orgs.updateStandaloneBrokerIdentity);
  const updateConnected = useMutation(api.orgs.updateConnectedClientBrokerIdentity);
  const [brokerCompanyName, setBrokerCompanyName] = useState(
    identity.brokerCompanyName ?? "",
  );
  const [brokerContactName, setBrokerContactName] = useState(
    identity.contactName ?? "",
  );
  const [brokerContactEmail, setBrokerContactEmail] = useState(
    identity.contactEmail ?? "",
  );
  const [brokerContactPhone, setBrokerContactPhone] = useState(
    identity.contactPhone ?? "",
  );
  const [producerId, setProducerId] = useState<Id<"users"> | "">(
    identity.selectedContactUserId ?? "",
  );
  const [overrideName, setOverrideName] = useState(
    identity.overrides?.contactName ?? "",
  );
  const [overrideEmail, setOverrideEmail] = useState(
    identity.overrides?.contactEmail ?? "",
  );
  const [overridePhone, setOverridePhone] = useState(
    identity.overrides?.contactPhone ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentState = useMemo(
    () => ({
      brokerCompanyName,
      brokerContactName,
      brokerContactEmail,
      brokerContactPhone,
      producerId,
      overrideName,
      overrideEmail,
      overridePhone,
    }),
    [
      brokerCompanyName,
      brokerContactName,
      brokerContactEmail,
      brokerContactPhone,
      producerId,
      overrideName,
      overrideEmail,
      overridePhone,
    ],
  );
  const currentStateKey = useMemo(
    () => JSON.stringify(currentState),
    [currentState],
  );
  const initialStateRef = useRef(currentStateKey);
  const selectedMember = useMemo(
    () => identity.brokerMembers.find((member) => member.userId === producerId),
    [identity.brokerMembers, producerId],
  );
  const manualPhoneInvalid =
    identity.canEditManual &&
    brokerContactPhone.trim().length > 0 &&
    !isValidPhoneNumber(brokerContactPhone);
  const overridePhoneInvalid =
    identity.canEditConnected &&
    overridePhone.trim().length > 0 &&
    !isValidPhoneNumber(overridePhone);
  const phoneInvalid = manualPhoneInvalid || overridePhoneInvalid;
  const manualEmailInvalid =
    identity.canEditManual && optionalEmailInvalid(brokerContactEmail);
  const overrideEmailInvalid =
    identity.canEditConnected && optionalEmailInvalid(overrideEmail);
  const emailInvalid = manualEmailInvalid || overrideEmailInvalid;
  const twoColumnGridClass =
    surface === "plain" ? "grid gap-4" : "grid gap-4 sm:grid-cols-2";
  const threeColumnGridClass =
    surface === "plain" ? "grid gap-4" : "grid gap-4 sm:grid-cols-3";

  const saveManual = useCallback(async () => {
    setSaving(true);
    try {
      await updateManual({
        orgId,
        brokerCompanyName,
        brokerContactName,
        brokerContactEmail,
        brokerContactPhone,
      });
      initialStateRef.current = currentStateKey;
      setSavedAt(dayjs().valueOf());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save broker information");
    } finally {
      setSaving(false);
    }
  }, [
    updateManual,
    orgId,
    brokerCompanyName,
    brokerContactName,
    brokerContactEmail,
    brokerContactPhone,
    currentStateKey,
  ]);

  const saveConnected = useCallback(async () => {
    if (!producerId) {
      return;
    }
    setSaving(true);
    try {
      await updateConnected({
        clientOrgId: orgId,
        producerId,
        contactNameOverride: overrideName,
        contactEmailOverride: overrideEmail,
        contactPhoneOverride: overridePhone,
      });
      initialStateRef.current = currentStateKey;
      setSavedAt(dayjs().valueOf());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save broker contact");
    } finally {
      setSaving(false);
    }
  }, [
    updateConnected,
    orgId,
    producerId,
    overrideName,
    overrideEmail,
    overridePhone,
    currentStateKey,
  ]);

  useEffect(() => {
    if (!identity.canEditManual && !identity.canEditConnected) return;
    if (currentStateKey === initialStateRef.current) return;
    if (identity.canEditConnected && !producerId) return;
    if (phoneInvalid || emailInvalid) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void (identity.canEditConnected ? saveConnected() : saveManual());
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    identity.canEditManual,
    identity.canEditConnected,
    currentStateKey,
    producerId,
    saveManual,
    saveConnected,
    phoneInvalid,
    emailInvalid,
  ]);

  return (
    <section
      className={
        surface === "card"
          ? "rounded-lg border border-foreground/6 bg-card"
          : "space-y-4"
      }
    >
      {surface === "card" ? (
        <div className="border-b border-foreground/6 px-5 py-3.5">
          <h3 className="mb-0! text-sm font-medium text-foreground">Broker</h3>
        </div>
      ) : null}
      <div className={surface === "card" ? "space-y-4 px-5 py-5" : "space-y-4"}>
        <div className={twoColumnGridClass}>
          <div>
            <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">
              Broker company
            </label>
            <input
              value={identity.connected ? identity.brokerCompanyName ?? "" : brokerCompanyName}
              onChange={(event) => setBrokerCompanyName(event.target.value)}
              disabled={identity.connected || !identity.canEditManual}
              placeholder="Broker company"
              className={INPUT_CLASSES}
            />
          </div>
          {identity.canEditConnected ? (
            <div>
              <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">
                Broker contact
              </label>
              <select
                value={producerId}
                onChange={(event) =>
                  setProducerId(event.target.value as Id<"users"> | "")
                }
                className={INPUT_CLASSES}
              >
                <option value="">Select a broker user</option>
                {identity.brokerMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name ?? member.email ?? "Team member"}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">
                Contact name
              </label>
              <input
                value={identity.connected ? identity.contactName ?? "" : brokerContactName}
                onChange={(event) => setBrokerContactName(event.target.value)}
                disabled={identity.connected || !identity.canEditManual}
                placeholder="Contact name"
                className={INPUT_CLASSES}
              />
            </div>
          )}
        </div>

        {identity.canEditConnected ? (
          <div className={threeColumnGridClass}>
            <div>
              <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">
                Name override
              </label>
              <input
                value={overrideName}
                onChange={(event) => setOverrideName(event.target.value)}
                placeholder={selectedMember?.name ?? "Use selected user's name"}
                className={INPUT_CLASSES}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">
                Email override
              </label>
              <input
                value={overrideEmail}
                onChange={(event) => setOverrideEmail(event.target.value)}
                placeholder={selectedMember?.email ?? "Use selected user's email"}
                type="email"
                className={INPUT_CLASSES}
              />
              <p className="mt-1.5 min-h-4 text-label-sm text-muted-foreground/60">
                {overrideEmailInvalid ? (
                  <span className="text-red-500/80">
                    Enter a valid email address.
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">
                Phone override
              </label>
              <PhoneInput
                value={overridePhone || undefined}
                onChange={(value) => setOverridePhone(value ?? "")}
                defaultCountry="US"
                placeholder={selectedMember?.phone ?? "Use selected user's phone"}
              />
              <p className="mt-1.5 min-h-4 text-label-sm text-muted-foreground/60">
                {overridePhoneInvalid ? (
                  <span className="text-red-500/80">
                    Enter a valid phone number with country code.
                  </span>
                ) : (
                  "Used when starting iMessage conversations with this broker contact."
                )}
              </p>
            </div>
          </div>
        ) : (
          <div className={twoColumnGridClass}>
            <div>
              <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">
                Contact email
              </label>
              <input
                value={identity.connected ? identity.contactEmail ?? "" : brokerContactEmail}
                onChange={(event) => setBrokerContactEmail(event.target.value)}
                disabled={identity.connected || !identity.canEditManual}
                placeholder="broker@example.com"
                type="email"
                className={INPUT_CLASSES}
              />
              <p className="mt-1.5 min-h-4 text-label-sm text-muted-foreground/60">
                {manualEmailInvalid ? (
                  <span className="text-red-500/80">
                    Enter a valid email address.
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">
                Contact phone
              </label>
              <PhoneInput
                value={(identity.connected ? identity.contactPhone : brokerContactPhone) || undefined}
                onChange={(value) => setBrokerContactPhone(value ?? "")}
                defaultCountry="US"
                disabled={identity.connected || !identity.canEditManual}
                placeholder="(555) 555-5555"
              />
              <p className="mt-1.5 min-h-4 text-label-sm text-muted-foreground/60">
                {manualPhoneInvalid ? (
                  <span className="text-red-500/80">
                    Enter a valid phone number with country code.
                  </span>
                ) : (
                  "Used when starting iMessage conversations with this broker contact."
                )}
              </p>
            </div>
          </div>
        )}

        <div className="flex min-h-5 items-center justify-between gap-3">
          {identity.connected && !identity.canEditConnected ? (
            <p className="text-body-sm text-muted-foreground">
              This broker information is managed by your broker.
            </p>
          ) : (
            <span />
          )}
          {identity.canEditManual || identity.canEditConnected ? (
            <span className="flex items-center gap-1.5 text-label-sm text-muted-foreground">
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
    </section>
  );
}
