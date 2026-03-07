import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Policies",
};

export default function PoliciesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
