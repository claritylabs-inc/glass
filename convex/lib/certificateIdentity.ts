export type CertificateHolderAddressInput = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  formatted?: string;
};

export function normalizeCertificateHolderName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s&.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCertificateHolderEmail(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function normalizeCertificateHolderContactName(value?: string) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

export function normalizeCertificateHolderAddress(address?: CertificateHolderAddressInput) {
  if (!address) return undefined;
  const normalized = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
    address.formatted,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) =>
      part
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s#/-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join("|");
  return normalized || undefined;
}

export function certificateHolderDedupeKey(params: {
  orgId: string;
  displayName: string;
  normalizedAddressKey?: string;
  normalizedEmail?: string;
}) {
  return [
    params.orgId,
    normalizeCertificateHolderName(params.displayName),
    params.normalizedAddressKey ?? "",
    params.normalizedEmail ?? "",
  ].join("::");
}

export function certificateHolderAddressLines(address?: CertificateHolderAddressInput) {
  if (!address) return [];
  const cityStateZip = [
    address.city?.trim(),
    [address.state?.trim(), address.postalCode?.trim()].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  return [
    address.formatted?.trim(),
    address.line1?.trim(),
    address.line2?.trim(),
    cityStateZip,
    address.country?.trim(),
  ].filter((line): line is string => Boolean(line));
}

export function certificateHolderDisplayBlock(params: {
  displayName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: CertificateHolderAddressInput;
}) {
  return [
    params.displayName.trim(),
    params.contactName?.trim() ? `Attn: ${params.contactName.trim()}` : undefined,
    params.email?.trim() ? `Email: ${params.email.trim()}` : undefined,
    params.phone?.trim() ? `Phone: ${params.phone.trim()}` : undefined,
    ...certificateHolderAddressLines(params.address),
  ].filter(Boolean).join("\n");
}

function certificateHolderLabeledValue(line: string, label: string) {
  const value = line.match(new RegExp(`^${label}\\s*:?\\s*(.+)$`, "i"))?.[1]?.trim();
  return value || undefined;
}

export function parseCertificateHolderBlock(
  certificateHolder: string | undefined,
  displayName?: string,
) {
  const lines = certificateHolder?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean) ?? [];
  const holderLines = displayName &&
    normalizeCertificateHolderName(lines[0] ?? "") ===
      normalizeCertificateHolderName(displayName)
    ? lines.slice(1)
    : lines;
  let contactName: string | undefined;
  let email: string | undefined;
  let phone: string | undefined;
  const addressLines: string[] = [];

  for (const line of holderLines) {
    const attention = certificateHolderLabeledValue(line, "Attn|Attention");
    if (attention) {
      contactName = attention;
      continue;
    }
    const labeledEmail = certificateHolderLabeledValue(line, "Email|E-mail");
    if (labeledEmail) {
      email = labeledEmail;
      continue;
    }
    const bareEmail = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    if (bareEmail && line === bareEmail) {
      email = bareEmail;
      continue;
    }
    const labeledPhone = certificateHolderLabeledValue(line, "Phone|Tel|Telephone");
    if (labeledPhone) {
      phone = labeledPhone;
      continue;
    }
    addressLines.push(line);
  }

  return {
    contactName,
    email,
    phone,
    address: addressLines.length > 0
      ? { formatted: addressLines.join("\n") }
      : undefined,
  };
}

export function policyCertificateDedupeKey(params: {
  orgId: string;
  policyId: string;
  holderId: string;
}) {
  return [params.orgId, params.policyId, params.holderId].join("::");
}

export function holderSnapshot(params: {
  displayName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: CertificateHolderAddressInput;
}) {
  return {
    displayName: params.displayName,
    contactName: params.contactName,
    email: params.email,
    phone: params.phone,
    address: params.address,
  };
}
