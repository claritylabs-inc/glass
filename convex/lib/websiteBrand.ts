"use node";

import { isIP } from "node:net";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

const USER_AGENT = "Mozilla/5.0 (compatible; GlassBot/1.0)";
const MAX_HTML_BYTES = 1_000_000;
const MAX_STYLESHEET_BYTES = 750_000;
const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const MAX_COLOR_CANDIDATES = 8;
const MAX_STYLESHEETS = 2;

type WebsiteBrandSignals = {
  website: string;
  title?: string;
  colorCandidates: string[];
};

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168
  );
}

function isPrivateIpv6(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

export function normalizePublicWebsiteUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only public http(s) websites are supported");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("Local and metadata websites are not supported");
  }
  const ipVersion = isIP(hostname);
  if (
    ipVersion === 4 && isPrivateIpv4(hostname) ||
    ipVersion === 6 && isPrivateIpv6(hostname)
  ) {
    throw new Error("Private network websites are not supported");
  }
  parsed.hash = "";
  return parsed.toString();
}

async function fetchPublic(
  rawUrl: string,
  init: RequestInit = {},
  redirectsRemaining = MAX_REDIRECTS,
): Promise<Response> {
  const url = normalizePublicWebsiteUrl(rawUrl);
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: {
      "User-Agent": USER_AGENT,
      ...init.headers,
    },
  });
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get("location");
  if (!location || redirectsRemaining <= 0) {
    throw new Error("Website redirected too many times");
  }
  return await fetchPublic(
    new URL(location, url).toString(),
    init,
    redirectsRemaining - 1,
  );
}

function normalizedHex(value: string) {
  const hex = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(hex)) return hex;
  if (/^#[0-9A-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return null;
}

function isUsefulBrandColor(hex: string) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
  const luminance = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
  return spread >= 24 && luminance >= 0.12 && luminance <= 0.88;
}

export function extractWebsiteBrandColors(html: string) {
  const priorityColors: string[] = [];
  const metaMatches = html.matchAll(
    /<meta[^>]+(?:name|property)=["'](?:theme-color|msapplication-TileColor)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
  );
  for (const match of metaMatches) priorityColors.push(match[1]);
  const reverseMetaMatches = html.matchAll(
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:theme-color|msapplication-TileColor)["'][^>]*>/gi,
  );
  for (const match of reverseMetaMatches) priorityColors.push(match[1]);

  const counts = new Map<string, number>();
  for (const match of html.matchAll(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi)) {
    const color = normalizedHex(match[0]);
    if (!color || !isUsefulBrandColor(color)) continue;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  const colors = [
    ...priorityColors,
    ...Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([color]) => color),
  ];
  return Array.from(
    new Set(
      colors
        .map(normalizedHex)
        .filter((color): color is string => Boolean(color))
        .filter(isUsefulBrandColor),
    ),
  ).slice(0, MAX_COLOR_CANDIDATES);
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
}

function extractIconCandidates(html: string, website: string) {
  const candidates: string[] = [];
  for (const match of html.matchAll(
    /<link[^>]+rel=["']([^"']*icon[^"']*)["'][^>]*href=["']([^"']+)["']/gi,
  )) {
    candidates.push(match[2]);
  }
  for (const match of html.matchAll(
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']([^"']*icon[^"']*)["']/gi,
  )) {
    candidates.push(match[1]);
  }
  candidates.push("/apple-touch-icon.png", "/favicon.ico");
  const hostname = new URL(website).hostname;
  candidates.push(
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`,
  );
  return Array.from(
    new Set(candidates.map((candidate) => new URL(candidate, website).toString())),
  );
}

export function extractWebsiteStylesheetUrls(html: string, website: string) {
  const candidates: string[] = [];
  for (const match of html.matchAll(
    /<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]*href=["']([^"']+)["']/gi,
  )) {
    candidates.push(match[1]);
  }
  for (const match of html.matchAll(
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*stylesheet[^"']*["']/gi,
  )) {
    candidates.push(match[1]);
  }
  return Array.from(
    new Set(candidates.map((candidate) => new URL(candidate, website).toString())),
  ).slice(0, MAX_STYLESHEETS);
}

async function fetchWebsiteHtml(rawUrl: string) {
  const response = await fetchPublic(rawUrl);
  if (!response.ok) throw new Error(`Website returned ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new Error("Website did not return HTML");
  }
  const html = (await response.text()).slice(0, MAX_HTML_BYTES);
  return {
    html,
    website: normalizePublicWebsiteUrl(response.url || rawUrl),
  };
}

async function readStylesheetBrandColors(html: string, website: string) {
  const stylesheets = await Promise.all(
    extractWebsiteStylesheetUrls(html, website).map(async (url) => {
      try {
        const response = await fetchPublic(url);
        if (!response.ok) return [];
        const contentType = response.headers.get("content-type") ?? "";
        if (
          !contentType.includes("text/css") &&
          !new URL(response.url || url).pathname.endsWith(".css")
        ) {
          return [];
        }
        const css = (await response.text()).slice(0, MAX_STYLESHEET_BYTES);
        return extractWebsiteBrandColors(css);
      } catch {
        return [];
      }
    }),
  );
  return Array.from(new Set(stylesheets.flat()));
}

export async function readWebsiteBrandSignals(
  rawUrl: string,
): Promise<WebsiteBrandSignals> {
  const { html, website } = await fetchWebsiteHtml(rawUrl);
  const stylesheetColors = await readStylesheetBrandColors(html, website);
  return {
    website,
    title: extractTitle(html),
    colorCandidates: Array.from(
      new Set([...stylesheetColors, ...extractWebsiteBrandColors(html)]),
    ).slice(0, MAX_COLOR_CANDIDATES),
  };
}

export async function fetchWebsiteFavicon(rawUrl: string): Promise<Blob | null> {
  const { html, website } = await fetchWebsiteHtml(rawUrl);
  for (const candidate of extractIconCandidates(html, website)) {
    try {
      const response = await fetchPublic(candidate);
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") ?? "";
      if (
        !contentType.startsWith("image/") &&
        !new URL(candidate).pathname.endsWith(".ico")
      ) {
        continue;
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 64 || buffer.byteLength > MAX_IMAGE_BYTES) {
        continue;
      }
      return new Blob([buffer], { type: contentType || "image/x-icon" });
    } catch {
      continue;
    }
  }
  return null;
}

export async function storeWebsiteFavicon(
  ctx: ActionCtx,
  rawUrl: string,
): Promise<Id<"_storage"> | null> {
  const icon = await fetchWebsiteFavicon(rawUrl);
  return icon ? await ctx.storage.store(icon) : null;
}
