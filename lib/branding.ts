/**
 * Browser-side brand themes and color utilities.
 *
 * Owns CSS variable token generation, accent swatches, readability helpers,
 * and client-side logo color sampling. Convex/server email branding belongs in
 * `convex/lib/branding.ts` and email shells belong in `convex/lib/emailTemplate.ts`.
 */
export type BrandTokens = {
  "--brand": string;
  "--brand-foreground": string;
  "--primary": string;
  "--primary-foreground": string;
  "--primary-light": string;
  "--primary-muted": string;
  "--ring": string;
  "--sidebar-primary": string;
  "--sidebar-primary-foreground": string;
  "--sidebar-ring": string;
  "--chart-1": string;
  "--chart-2": string;
};

export type BrandTheme = {
  id: string;
  label: string;
  /** Canonical accent hex — also what gets stored in `org.brandingColor`. */
  accent: string;
  light: BrandTokens;
  dark: BrandTokens;
};

function tokens(
  primary: string,
  primaryFg: string,
  primaryLight: string,
  primaryMuted: string,
  chart2: string,
): BrandTokens {
  return {
    "--brand": primary,
    "--brand-foreground": primaryFg,
    "--primary": primary,
    "--primary-foreground": primaryFg,
    "--primary-light": primaryLight,
    "--primary-muted": primaryMuted,
    "--ring": primary,
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": primaryFg,
    "--sidebar-ring": primary,
    "--chart-1": primary,
    "--chart-2": chart2,
  };
}

export const BRAND_THEMES: ReadonlyArray<BrandTheme> = [
  {
    id: "slate",
    label: "Slate",
    accent: "#1E293B",
    light: tokens("#1E293B", "#FFFFFF", "#94A3B8", "#475569", "#94A3B8"),
    dark: tokens("#94A3B8", "#0F172A", "#CBD5E1", "#64748B", "#CBD5E1"),
  },
  {
    id: "navy",
    label: "Navy",
    accent: "#1E3A5F",
    light: tokens("#1E3A5F", "#FFFFFF", "#93B4D6", "#3B5F8A", "#93B4D6"),
    dark: tokens("#93B4D6", "#0B1A2E", "#BDD4EB", "#5E83AD", "#BDD4EB"),
  },
  {
    id: "blue",
    label: "Blue",
    accent: "#2C5282",
    light: tokens("#2C5282", "#FFFFFF", "#A7C3E2", "#4A75A8", "#A7C3E2"),
    dark: tokens("#A7C3E2", "#1A2F4A", "#CEDFEF", "#6F96BF", "#CEDFEF"),
  },
  {
    id: "teal",
    label: "Teal",
    accent: "#2B6B6B",
    light: tokens("#2B6B6B", "#FFFFFF", "#9AC7C7", "#4A8E8E", "#9AC7C7"),
    dark: tokens("#9AC7C7", "#0E2D2D", "#C4DEDE", "#6FAEAE", "#C4DEDE"),
  },
  {
    id: "forest",
    label: "Forest",
    accent: "#3F6B4B",
    light: tokens("#3F6B4B", "#FFFFFF", "#A9C9B1", "#5F8C6D", "#A9C9B1"),
    dark: tokens("#A9C9B1", "#152A1C", "#CDE0D2", "#82AC8E", "#CDE0D2"),
  },
  {
    id: "taupe",
    label: "Taupe",
    accent: "#7A5A3A",
    light: tokens("#7A5A3A", "#FFFFFF", "#D6BE9F", "#9A7E5C", "#D6BE9F"),
    dark: tokens("#D6BE9F", "#2A1F13", "#E5D4BB", "#B79A76", "#E5D4BB"),
  },
  {
    id: "rust",
    label: "Rust",
    accent: "#8B3A3A",
    light: tokens("#8B3A3A", "#FFFFFF", "#D99D9D", "#AD5C5C", "#D99D9D"),
    dark: tokens("#D99D9D", "#2E1212", "#E8BFBF", "#BC7979", "#E8BFBF"),
  },
  {
    id: "violet",
    label: "Violet",
    accent: "#5B4A7B",
    light: tokens("#5B4A7B", "#FFFFFF", "#B3A6C7", "#7A6B97", "#B3A6C7"),
    dark: tokens("#B3A6C7", "#1E1730", "#CFC5DC", "#9084AF", "#CFC5DC"),
  },
];

/** Swatches shown in the accent picker (one per theme). */
export const BRAND_SWATCHES = BRAND_THEMES.map((t) => t.accent);

export function themeForAccent(hex: string | undefined | null): BrandTheme | null {
  if (!hex) return null;
  const h = hex.toLowerCase();
  return BRAND_THEMES.find((t) => t.accent.toLowerCase() === h) ?? null;
}

/**
 * Fallback token set for a custom hex that doesn't match any curated theme.
 * Derives sensible but muted tokens from the accent.
 */
export function deriveTokens(accent: string, mode: "light" | "dark"): BrandTokens {
  const rgb = hexToRgb(accent);
  if (!rgb) {
    // Fall back to slate.
    return mode === "light" ? BRAND_THEMES[0].light : BRAND_THEMES[0].dark;
  }
  const light = lighten(accent, mode === "light" ? 0.45 : 0.55);
  const brand = mode === "dark" ? light : accent;
  const fg = readableTextFor(brand) === "light" ? "#FFFFFF" : "#0F172A";
  const muted = lighten(accent, mode === "light" ? 0.2 : -0.1);
  const chart2 = light;
  return {
    "--brand": brand,
    "--brand-foreground": fg,
    "--primary": brand,
    "--primary-foreground": fg,
    "--primary-light": light,
    "--primary-muted": muted,
    "--ring": brand,
    "--sidebar-primary": brand,
    "--sidebar-primary-foreground": fg,
    "--sidebar-ring": brand,
    "--chart-1": brand,
    "--chart-2": chart2,
  };
}

function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const mix = (c: number) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `#${[mix(rgb.r), mix(rgb.g), mix(rgb.b)]
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

export function tokensForAccent(
  accent: string | undefined | null,
  mode: "light" | "dark",
): BrandTokens | null {
  if (!accent) return null;
  const theme = themeForAccent(accent);
  if (theme) return mode === "light" ? theme.light : theme.dark;
  return deriveTokens(accent, mode);
}

// Backwards-compat exports — still referenced by some older code.
export const DARK_PRESETS = BRAND_SWATCHES;
export const PALE_PRESETS: ReadonlyArray<string> = [];

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const n = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(n)) return null;
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const linearize = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

export function readableTextFor(accent: string): "light" | "dark" {
  return relativeLuminance(accent) > 0.45 ? "dark" : "light";
}

export function extractDomain(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).hostname;
  } catch {
    return null;
  }
}

function desaturate(r: number, g: number, b: number, factor = 0.35): [number, number, number] {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  return [
    Math.round(r + (gray - r) * factor),
    Math.round(g + (gray - g) * factor),
    Math.round(b + (gray - b) * factor),
  ];
}

export async function sampleBrandColors(imgUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 48;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve([]);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        const buckets = new Map<
          string,
          { r: number; g: number; b: number; count: number; sat: number }
        >();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const light = (max + min) / 2 / 255;
          if (sat < 0.15 || light < 0.12 || light > 0.92) continue;
          const key = `${Math.round(r / 40)}-${Math.round(g / 40)}-${Math.round(b / 40)}`;
          const existing = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0, sat: 0 };
          existing.r += r; existing.g += g; existing.b += b;
          existing.count += 1; existing.sat = Math.max(existing.sat, sat);
          buckets.set(key, existing);
        }
        if (buckets.size === 0) return resolve([]);
        const ranked = Array.from(buckets.values())
          .sort((a, b) => b.count * (0.4 + b.sat) - a.count * (0.4 + a.sat))
          .slice(0, 5);
        const colors: string[] = [];
        for (const b of ranked) {
          const [dr, dg, db] = desaturate(
            Math.round(b.r / b.count),
            Math.round(b.g / b.count),
            Math.round(b.b / b.count),
            0.3,
          );
          const hex = `#${[dr, dg, db]
            .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase()}`;
          if (!colors.some((c) => c === hex)) colors.push(hex);
          if (colors.length >= 3) break;
        }
        resolve(colors);
      } catch {
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = imgUrl;
  });
}
