/* eslint-disable @next/next/no-img-element -- ImageResponse renders embedded raster brand assets. */
import { readFile } from "fs/promises";
import { join } from "path";
import { ImageResponse } from "next/og";
import {
  spotSocialAsciiTypographyStyle,
  spotSocialUrlTypographyStyle,
  spotSocialWordmarkTypographyStyle,
} from "@/lib/typography";

export const SPOT_SOCIAL_IMAGE_SIZE = { width: 1200, height: 630 };

const ASCII_GLYPHS = "  ..::+?N9#";
const ASCII_COLUMNS = 154;
const ASCII_ROWS = 68;

function noise(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

const STATIC_ASCII_FIELD = Array.from({ length: ASCII_ROWS }, (_, y) =>
  Array.from({ length: ASCII_COLUMNS }, (_, x) => {
    const normalizedY = y / ASCII_ROWS;
    const center =
      0.5 + Math.sin(x * 0.075) * 0.055 + Math.sin(x * 0.021) * 0.035;
    const band = Math.exp(-Math.pow((normalizedY - center) / 0.24, 2));
    const wave = 0.5 + 0.5 * Math.sin(x * 0.13 + y * 0.17);
    const strength = band * (0.22 + wave * 0.5) + noise(x, y) * 0.1;
    const glyphIndex = Math.min(
      ASCII_GLYPHS.length - 1,
      Math.floor(strength * ASCII_GLYPHS.length),
    );

    return ASCII_GLYPHS[glyphIndex];
  }).join(""),
).join("\n");

function imageDataUrl(mimeType: string, data: Buffer) {
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

type SpotSocialAssets = {
  redaction: Buffer;
  geist: Buffer;
  skySrc: string;
  iconSrc: string;
};

let assetsPromise: Promise<SpotSocialAssets> | undefined;

function loadSpotSocialAssets() {
  assetsPromise ??= Promise.all([
    readFile(join(process.cwd(), "app/fonts/redaction/Redaction-Regular.ttf")),
    readFile(join(process.cwd(), "app/fonts/geist/Geist-Regular.ttf")),
    readFile(join(process.cwd(), "public/spot/hero-clouds-v1.jpg")),
    readFile(join(process.cwd(), "public/spot/logo-icon.png")),
  ]).then(([redaction, geist, sky, icon]) => ({
    redaction,
    geist,
    skySrc: imageDataUrl("image/jpeg", sky),
    iconSrc: imageDataUrl("image/png", icon),
  }));

  return assetsPromise;
}

function SpotSocialCard({
  skySrc,
  iconSrc,
}: Omit<SpotSocialAssets, "redaction" | "geist">) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        overflow: "hidden",
        background: "#f7f5ef",
      }}
    >
      <img
        src={skySrc}
        alt=""
        width={1200}
        height={630}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          background: "rgba(247, 245, 239, 0.16)",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: -14,
          left: -12,
          width: 1240,
          height: 670,
          display: "flex",
          overflow: "hidden",
          whiteSpace: "pre",
          color: "rgba(38, 67, 84, 0.16)",
          ...spotSocialAsciiTypographyStyle,
        }}
      >
        {STATIC_ASCII_FIELD}
      </div>

      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 80,
        }}
      >
        <div
          style={{
            flex: 1,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              color: "#000000",
              ...spotSocialWordmarkTypographyStyle,
            }}
          >
            <img src={iconSrc} alt="" width={96} height={96} />
            <span>spot</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            color: "rgba(0, 0, 0, 0.58)",
            ...spotSocialUrlTypographyStyle,
          }}
        >
          app.spot.insure
        </div>
      </div>
    </div>
  );
}

export async function createSpotSocialImage() {
  const assets = await loadSpotSocialAssets();
  const { redaction, geist, ...cardAssets } = assets;
  return new ImageResponse(<SpotSocialCard {...cardAssets} />, {
    ...SPOT_SOCIAL_IMAGE_SIZE,
    fonts: [
      {
        name: "Redaction",
        data: redaction,
        style: "normal",
        weight: 400,
      },
      {
        name: "Geist",
        data: geist,
        style: "normal",
        weight: 400,
      },
    ],
  });
}
