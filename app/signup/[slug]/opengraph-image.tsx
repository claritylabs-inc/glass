import { ImageResponse } from "next/og";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { BrandLockup, ogFonts } from "../../opengraph-image";

export const runtime = "edge";
export const alt = "Glass from Clarity Labs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { slug: string } }) {
  const fonts = await ogFonts();
  const broker = await fetchQuery(api.orgs.publicBrokerBySlug, { slug: params.slug }).catch(
    () => null,
  );

  if (!broker) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#faf8f4",
            fontFamily: "Geist",
          }}
        >
          <BrandLockup />
        </div>
      ),
      { ...size, ...(fonts ? { fonts } : {}) },
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#faf8f4",
          position: "relative",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          {broker.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={broker.iconUrl}
              alt=""
              width={132}
              height={132}
              style={{ borderRadius: 24, objectFit: "cover" }}
            />
          ) : null}
          <span
            style={{
              fontSize: 100,
              fontWeight: 500,
              color: "#111827",
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            {broker.name}
          </span>
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 48,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            fontSize: 20,
            color: "#9ca3af",
          }}
        >
          <span>Powered by</span>
          <BrandLockup iconSize={22} glassSize={22} suffixSize={22} gap={6} />
        </div>
      </div>
    ),
    { ...size, ...(fonts ? { fonts } : {}) },
  );
}
