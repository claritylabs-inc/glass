import { createSpotSocialImage } from "@/lib/spot-social-image";

export const alt = "Spot - AI Weather Report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return createSpotSocialImage();
}
