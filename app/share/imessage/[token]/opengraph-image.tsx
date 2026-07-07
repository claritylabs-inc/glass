import { ImageResponse } from "next/og";
import { GLOBE_PATH, ogFonts } from "../../../opengraph-image";
import {
  compactList,
  formatDate,
  loadAppCardView,
  policyLineBusinessLabels,
  truncate,
  type AppCardView,
  type Policy,
} from "./view";

type ImageParams = { token: string };
const BRAND_BLUE = "#A0D2FA";

export const alt = "Glass shared record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function kindLabel(kind: AppCardView["kind"]) {
  return kind[0].toUpperCase() + kind.slice(1);
}

function heroTitle(view: AppCardView) {
  return truncate(view.title, 82) ?? "Glass record";
}

function heroSubtitle(view: AppCardView) {
  if (view.policy) {
    return compactList([
      view.policy.carrier,
      policyLineBusinessLabels(view.policy).join(", "),
      `${formatDate(view.policy.effectiveDate)} to ${formatDate(view.policy.expirationDate)}`,
    ]);
  }
  if (view.certificate) {
    return compactList([
      view.certificate.holderName,
    ]);
  }
  return view.subtitle ?? "";
}

function detailStatus(view: AppCardView) {
  if (view.certificate) return "Certificate";
  return view.subtitle ?? "Shared record";
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 7 }}>
      <div style={{ fontSize: 21, color: "#737373", fontWeight: 400 }}>{label}</div>
      <div style={{ fontSize: 30, color: "#000000", fontWeight: 500, lineHeight: 1.18 }}>
        {truncate(value, 44)}
      </div>
    </div>
  );
}

function globeSvg(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 65 65" width="${size}" height="${size}"><circle cx="32.5" cy="32.5" r="31" fill="none" stroke="${BRAND_BLUE}" stroke-width="1.25"/><path fill="${BRAND_BLUE}" fill-rule="evenodd" d="${GLOBE_PATH}"/></svg>`;
}

function globeDataUri(size: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(globeSvg(size))}`;
}

function GlassMark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <img src={globeDataUri(34)} alt="" width={34} height={34} />
      <div style={{ fontSize: 28, fontWeight: 500, color: "#000000", letterSpacing: 0 }}>
        Glass
      </div>
    </div>
  );
}

function FallbackImage() {
  return (
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
      <GlassMark />
    </div>
  );
}

function PolicyDetails({ policy }: { policy: Policy }) {
  const coverageRows = policy.coverages.slice(0, 2);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, width: "100%" }}>
      <div style={{ display: "flex", gap: 24, width: "100%" }}>
        <DetailRow label="Named insured" value={policy.insuredName || "Not listed"} />
        <DetailRow label="Policy number" value={policy.policyNumber || "Not listed"} />
      </div>
      {coverageRows.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            border: "1px solid #e5e5e5",
            borderRadius: 8,
            overflow: "hidden",
            width: "100%",
          }}
        >
          {coverageRows.map((coverage, index) => (
            <div
              key={`${coverage.name}-${coverage.limit ?? ""}-${coverage.deductible ?? ""}`}
              style={{
                display: "flex",
                alignItems: "center",
                borderBottom: index === coverageRows.length - 1 ? "0" : "1px solid #eeeeee",
                padding: "16px 20px",
                gap: 18,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
                <div style={{ fontSize: 24, fontWeight: 500, color: "#000000" }}>
                  {truncate(coverage.name, 52)}
                </div>
                <div style={{ fontSize: 19, color: "#737373" }}>
                  Deductible: {coverage.deductible ?? "Not listed"}
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 500, color: "#000000" }}>
                {truncate(coverage.limit ?? "Not listed", 30)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default async function Image({
  params,
}: {
  params: ImageParams | Promise<ImageParams>;
}) {
  const { token } = await params;
  const fonts = await ogFonts();
  const view = await loadAppCardView(token).catch(() => null);

  if (!view) {
    return new ImageResponse(<FallbackImage />, {
      ...size,
      ...(fonts ? { fonts } : {}),
    });
  }

  const subtitle = heroSubtitle(view);
  const title = heroTitle(view);
  const titleSize = title.length > 62 ? 46 : title.length > 42 ? 54 : 62;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#ffffff",
          color: "#000000",
          fontFamily: "Geist",
          padding: "58px 70px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <GlassMark />
          <div style={{ fontSize: 24, color: "#737373", fontWeight: 500 }}>
            {kindLabel(view.kind)}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 52 }}>
          <div
            style={{
              fontSize: titleSize,
              lineHeight: 1.04,
              fontWeight: 500,
              color: "#000000",
              letterSpacing: 0,
              maxWidth: 1000,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                fontSize: 30,
                lineHeight: 1.22,
                color: "#525252",
                maxWidth: 1000,
              }}
            >
              {truncate(subtitle, 130)}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "flex-end", width: "100%" }}>
          {view.policy ? (
            <PolicyDetails policy={view.policy} />
          ) : (
            <div style={{ display: "flex", gap: 24, width: "100%" }}>
              <DetailRow label="Organization" value={view.orgName} />
              <DetailRow label="Status" value={detailStatus(view)} />
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid #eeeeee",
            marginTop: 30,
            paddingTop: 20,
            width: "100%",
            fontSize: 22,
            color: "#737373",
          }}
        >
          <div>{truncate(view.orgName, 70)}</div>
          <div>app.glass.insure</div>
        </div>
      </div>
    ),
    { ...size, ...(fonts ? { fonts } : {}) },
  );
}
