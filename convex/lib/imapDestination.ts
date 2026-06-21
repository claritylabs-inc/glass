"use node";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { domainToASCII } from "node:url";

const ALLOWED_IMAP_PORTS = new Set([143, 993]);

const blockedAddresses = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

export type ResolvedImapDestination = {
  normalizedHost: string;
  connectionHost: string;
  port: number;
  servername?: string;
  resolvedAddresses: string[];
};

export function validateImapPort(port: number) {
  if (!Number.isInteger(port) || !ALLOWED_IMAP_PORTS.has(port)) {
    throw new Error("Connected email supports IMAP ports 993 and 143 only");
  }
  return port;
}

export function isBlockedImapAddress(address: string) {
  const version = isIP(address);
  if (version === 0) return true;
  const normalizedAddress = address.toLowerCase();
  if (
    version === 6 &&
    (normalizedAddress.startsWith("::ffff:") ||
      normalizedAddress.startsWith("0:0:0:0:0:ffff:"))
  ) {
    return true;
  }
  return blockedAddresses.check(address, version === 4 ? "ipv4" : "ipv6");
}

function validateDnsHostname(host: string) {
  if (host.length > 253) {
    throw new Error("IMAP host is too long");
  }
  if (!host.includes(".")) {
    throw new Error("IMAP host must be a public DNS hostname or public IP address");
  }

  const labels = host.split(".");
  for (const label of labels) {
    if (!label || label.length > 63) {
      throw new Error("IMAP host is not a valid DNS hostname");
    }
    if (!/^[a-z0-9-]+$/.test(label) || label.startsWith("-") || label.endsWith("-")) {
      throw new Error("IMAP host is not a valid DNS hostname");
    }
  }
}

export function normalizeImapHost(input: string) {
  if (!input.trim()) {
    throw new Error("IMAP host is required");
  }
  if (/\s/.test(input)) {
    throw new Error("IMAP host cannot contain whitespace");
  }

  const rawHost = input.toLowerCase().replace(/\.$/, "");
  if (
    rawHost.includes("://") ||
    rawHost.includes("@") ||
    /[/?#\\]/.test(rawHost) ||
    rawHost.startsWith("[") ||
    rawHost.endsWith("]")
  ) {
    throw new Error("IMAP host must be a hostname or IP address, not a URL");
  }

  if (isIP(rawHost) !== 0) {
    if (isBlockedImapAddress(rawHost)) {
      throw new Error("IMAP host must resolve to a public network address");
    }
    return rawHost;
  }

  const asciiHost = domainToASCII(rawHost);
  if (!asciiHost) {
    throw new Error("IMAP host is not a valid DNS hostname");
  }

  if (asciiHost.includes(":")) {
    throw new Error("IMAP host must not include a port");
  }

  validateDnsHostname(asciiHost);
  return asciiHost;
}

export function validateResolvedImapAddresses(addresses: string[]) {
  if (addresses.length === 0) {
    throw new Error("IMAP host could not be resolved");
  }

  const uniqueAddresses = [...new Set(addresses)];
  const unsafeAddress = uniqueAddresses.find((address) => isBlockedImapAddress(address));
  if (unsafeAddress) {
    throw new Error("IMAP host resolves to a private or reserved network address");
  }

  return uniqueAddresses;
}

export async function resolveImapDestination(args: {
  host: string;
  port: number;
}): Promise<ResolvedImapDestination> {
  const normalizedHost = normalizeImapHost(args.host);
  const port = validateImapPort(args.port);

  if (isIP(normalizedHost) !== 0) {
    return {
      normalizedHost,
      connectionHost: normalizedHost,
      port,
      resolvedAddresses: [normalizedHost],
    };
  }

  let records: string[];
  try {
    records = (await lookup(normalizedHost, { all: true, verbatim: true })).map(
      (record) => record.address,
    );
  } catch {
    throw new Error("IMAP host could not be resolved");
  }

  const resolvedAddresses = validateResolvedImapAddresses(records);
  return {
    normalizedHost,
    connectionHost:
      resolvedAddresses.find((address) => isIP(address) === 4) ?? resolvedAddresses[0],
    port,
    servername: normalizedHost,
    resolvedAddresses,
  };
}
