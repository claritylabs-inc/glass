import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Instrument_Serif } from "next/font/google";
import { ConvexClientProvider } from "@/components/providers";
import { AuthGuard } from "@/components/auth-guard";
import { AppToaster } from "@/components/ui/toaster";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Clarity Labs",
    template: "%s | Clarity Labs",
  },
  description: "AI-powered insurance policy extraction from email",
  openGraph: {
    title: "Clarity Labs",
    description: "AI-powered insurance policy extraction from email",
    siteName: "Clarity Labs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Clarity Labs",
    description: "AI-powered insurance policy extraction from email",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        <ConvexClientProvider>
          <AuthGuard>{children}</AuthGuard>
          <AppToaster />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
