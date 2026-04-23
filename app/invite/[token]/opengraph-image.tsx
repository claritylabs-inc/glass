import { ImageResponse } from "next/og";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { BrandLockup, ogFonts } from "../../opengraph-image";

export const runtime = "edge";
export const alt = "Glass from Clarity Labs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { token: string } }) {
  const fonts = await ogFonts();

  type BrokerData = { brokerName?: string; brokerIconUrl?: string | null };
  let data: BrokerData | null = null;
  try {
    const result = await fetchAction(api.clientInvitations.getByToken, { token: params.token });
    data = result as unknown as BrokerData;
  } catch {
    data = null;
  }

  const Fallback = (
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
  );

  if (!data?.brokerName) {
    return new ImageResponse(Fallback, { ...size, ...(fonts ? { fonts } : {}) });
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
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {data.brokerIconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.brokerIconUrl}
              alt=""
              width={96}
              height={96}
              style={{ borderRadius: 20, objectFit: "cover" }}
            />
          ) : null}
          <span
            style={{
              fontSize: 72,
              fontWeight: 500,
              color: "#111827",
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            {data.brokerName}
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
            gap: 6,
            fontSize: 18,
            color: "#9ca3af",
          }}
        >
          <span>Powered by</span>
          <BrandLockup textSize={18} gap={5} />
        </div>
      </div>
    ),
    { ...size, ...(fonts ? { fonts } : {}) },
  );
}
