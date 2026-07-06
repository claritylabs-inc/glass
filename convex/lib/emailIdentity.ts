"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { isWhiteLabelingEnabled } from "./branding";
import { getClientPortalUrl } from "./domains";
import { buildGlassEmailIconHtml } from "./emailTemplate";
import { getAgentDomain } from "./resend";

const GLASS_PUBLIC_URL = getClientPortalUrl();

export type BrokerBranding = {
  name?: string;
  logoUrl?: string | null;
  agentDisplayName?: string | null;
};

export function getEmailAgentFromName(broker?: BrokerBranding): string {
  if (broker?.name || broker?.agentDisplayName) {
    const base = broker.agentDisplayName || broker.name;
    return `${base} Agent`;
  }
  return "Glass from Clarity Labs";
}

export function buildEmailSignature(
  agentEmail: string,
  broker?: BrokerBranding,
): { text: string; html: string } {
  const poweredByUrl = GLASS_PUBLIC_URL;
  const hasBroker = !!(broker?.name || broker?.agentDisplayName);
  const agentName = getEmailAgentFromName(broker);

  const text = [
    "",
    "-",
    agentName,
    agentEmail,
    ...(hasBroker
      ? ["", `powered by Glass from Clarity Labs - ${poweredByUrl}`]
      : []),
  ].join("\n");

  const logoHtml =
    hasBroker && broker?.logoUrl
      ? `<img src="${broker.logoUrl}" alt="" width="20" height="20" style="display:inline-block;vertical-align:middle;width:20px;height:20px;border-radius:4px;margin-right:8px;object-fit:cover;border:0;" />`
      : buildGlassEmailIconHtml({
          size: 20,
          borderRadius: 4,
          margin: "0 8px 0 0",
        });

  const html = [
    `<br><p style="color:#999;font-size:13px;margin:0">-</p>`,
    `<p style="font-size:13px;margin:4px 0 2px">${logoHtml}<strong>${agentName}</strong></p>`,
    `<p style="font-size:12px;color:#999;margin:0">${agentEmail}</p>`,
    ...(hasBroker
      ? [
          `<p style="font-size:12px;margin:6px 0 0"><a href="${poweredByUrl}" style="color:#A0D2FA;text-decoration:none">powered by Glass from Clarity Labs</a></p>`,
        ]
      : []),
  ].join("\n");

  return { text, html };
}

export async function resolveEmailAgentIdentity(
  ctx: ActionCtx,
  org: Record<string, unknown>,
): Promise<{
  canSend: boolean;
  agentAddress?: string;
  fromHeader?: string;
  brokerBranding?: BrokerBranding;
  reason?: string;
}> {
  let sendingOrg = org;
  if (org.type === "client" && org.brokerOrgId) {
    const brokerOrg = await ctx.runQuery(internal.orgs.getInternal, {
      id: org.brokerOrgId as Id<"organizations">,
    });
    if (brokerOrg) sendingOrg = brokerOrg;
  }

  const handle =
    typeof sendingOrg.agentHandle === "string" && sendingOrg.agentHandle.trim()
      ? sendingOrg.agentHandle
      : "agent";

  const whiteLabelingEnabled = isWhiteLabelingEnabled(
    sendingOrg as { whiteLabelingEnabled?: boolean },
  );
  const logoUrl =
    whiteLabelingEnabled && sendingOrg.iconStorageId
      ? await ctx.storage.getUrl(sendingOrg.iconStorageId as Id<"_storage">)
      : null;
  const brokerBranding: BrokerBranding | undefined = whiteLabelingEnabled
    ? {
        name: typeof sendingOrg.name === "string" ? sendingOrg.name : undefined,
        logoUrl,
        agentDisplayName:
          typeof sendingOrg.agentDisplayName === "string"
            ? sendingOrg.agentDisplayName
            : undefined,
      }
    : undefined;

  const agentAddress = `${handle}@${getAgentDomain()}`;
  return {
    canSend: true,
    agentAddress,
    fromHeader: `${getEmailAgentFromName(brokerBranding)} <${agentAddress}>`,
    brokerBranding,
  };
}
