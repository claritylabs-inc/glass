import { ImageResponse } from "next/og";
import { BrandLockup, ogFonts } from "../opengraph-image";

export const alt = "Glass from Clarity Labs - AI Weather Report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const fonts = await ogFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          fontFamily: "Geist",
        }}
      >
        <BrandLockup />
      </div>
    ),
    { ...size, ...(fonts ? { fonts } : {}) },
  );
}
