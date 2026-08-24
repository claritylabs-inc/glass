import { createGlassSocialImage } from "@/lib/glass-social-image";

export const alt = "Glass from Clarity Labs - AI Weather Report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return createGlassSocialImage();
}
