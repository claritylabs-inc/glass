"use client";

const GLASS_ICON_URL = "/glass-icon.svg";
const CONTACT_PHOTO_SIZE = 256;
const CONTACT_TILE_INSET = 34;

export interface AgentContactBroker {
  name: string;
  iconUrl?: string | null;
  whiteLabelingEnabled?: boolean;
}

interface BuildAgentContactVCardArgs {
  broker?: AgentContactBroker | null;
  email: string;
  phone?: string;
}

function escapeVCardValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

async function loadImageFromUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to fetch contact photo");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to load contact photo"));
    image.src = objectUrl;
  });
  return { image, revoke: () => URL.revokeObjectURL(objectUrl) };
}

function drawSquirclePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  if (!imageWidth || !imageHeight) return;

  const scale = Math.min(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;

  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

async function buildSquirclePhoto(iconUrl: string, padding: number) {
  const canvas = document.createElement("canvas");
  canvas.width = CONTACT_PHOTO_SIZE;
  canvas.height = CONTACT_PHOTO_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const { image, revoke } = await loadImageFromUrl(iconUrl);
  const inset = CONTACT_TILE_INSET;
  const radius = 46;

  try {
    ctx.clearRect(0, 0, CONTACT_PHOTO_SIZE, CONTACT_PHOTO_SIZE);
    drawSquirclePath(
      ctx,
      inset,
      inset,
      CONTACT_PHOTO_SIZE - inset * 2,
      CONTACT_PHOTO_SIZE - inset * 2,
      radius,
    );
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();

    ctx.save();
    drawSquirclePath(
      ctx,
      inset,
      inset,
      CONTACT_PHOTO_SIZE - inset * 2,
      CONTACT_PHOTO_SIZE - inset * 2,
      radius,
    );
    ctx.clip();

    const contentInset = inset + padding;
    drawContainedImage(
      ctx,
      image,
      contentInset,
      contentInset,
      CONTACT_PHOTO_SIZE - contentInset * 2,
      CONTACT_PHOTO_SIZE - contentInset * 2,
    );
    ctx.restore();

    const dataUrl = canvas.toDataURL("image/png");
    return {
      base64: dataUrl.split(",")[1] ?? "",
      type: "PNG",
    };
  } finally {
    revoke();
  }
}

async function buildPhotoEntry(iconUrl: string, padding: number) {
  try {
    const photo = await buildSquirclePhoto(iconUrl, padding);
    if (!photo?.base64) return "";
    return `\nPHOTO;ENCODING=b;TYPE=${photo.type}:${photo.base64}`;
  } catch {
    return "";
  }
}

export async function buildAgentContactVCard({
  broker,
  email,
  phone,
}: BuildAgentContactVCardArgs) {
  const whiteLabeledBroker = broker?.whiteLabelingEnabled !== false ? broker : null;
  const firstName = whiteLabeledBroker?.name ?? "Glass";
  const lastName = "Agent";
  const displayName = `${firstName} ${lastName}`;
  const organization = whiteLabeledBroker
    ? "powered by Clarity Labs"
    : "from Clarity Labs";
  const iconUrl = whiteLabeledBroker?.iconUrl ?? GLASS_ICON_URL;
  const photoEntry = await buildPhotoEntry(iconUrl, whiteLabeledBroker ? 18 : 44);

  const vcard =
    "BEGIN:VCARD\n" +
    "VERSION:3.0\n" +
    `FN:${escapeVCardValue(displayName)}\n` +
    `N:${escapeVCardValue(lastName)};${escapeVCardValue(firstName)};;;\n` +
    `ORG:${escapeVCardValue(organization)}\n` +
    `EMAIL;TYPE=INTERNET:${escapeVCardValue(email)}\n` +
    (phone ? `TEL;TYPE=CELL:${escapeVCardValue(phone)}` : "") +
    (phone && photoEntry ? photoEntry : photoEntry.replace(/^\n/, "")) +
    "\nEND:VCARD\n";

  return { vcard, fileName: `${displayName}.vcf`, displayName };
}

export function downloadVCard(vcard: string, fileName: string) {
  const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
