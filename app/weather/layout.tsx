import type { Metadata } from "next";

const TITLE = "Glass from Clarity Labs";
const DESCRIPTION = "AI Weather Report — current model routing across Glass.";

export const metadata: Metadata = {
  title: `${TITLE} - AI Weather Report`,
  description: DESCRIPTION,
  openGraph: {
    title: `${TITLE} - AI Weather Report`,
    description: DESCRIPTION,
    siteName: TITLE,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} - AI Weather Report`,
    description: DESCRIPTION,
  },
};

export default function WeatherLayout({ children }: { children: React.ReactNode }) {
  return children;
}
