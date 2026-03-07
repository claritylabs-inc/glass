import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Extractions",
};

export default function ExtractionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
