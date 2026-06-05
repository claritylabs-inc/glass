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

export function policyCertificateDedupeKey(params: {
  orgId: string;
  policyId: string;
  holderId: string;
}) {
  return [params.orgId, params.policyId, params.holderId].join("::");
}

export function holderSnapshot(params: {
  displayName: string;
  email?: string;
  phone?: string;
  address?: CertificateHolderAddressInput;
}) {
  return {
    displayName: params.displayName,
    email: params.email,
    phone: params.phone,
    address: params.address,
  };
}
