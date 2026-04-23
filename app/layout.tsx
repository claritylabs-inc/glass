import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Instrument_Serif } from "next/font/google";
import { ConvexClientProvider } from "@/components/providers";
import { AuthGuard } from "@/components/auth-guard";
import { AppToaster } from "@/components/ui/toaster";
import { BrandThemeApplier } from "@/components/brand-theme-applier";
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

export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "Glass",
    template: "%s | Glass",
  },
  description: "AI-powered insurance intelligence by Clarity Labs",
  openGraph: {
    title: "Glass",
    description: "AI-powered insurance intelligence by Clarity Labs",
    siteName: "Glass",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Glass",
    description: "AI-powered insurance intelligence by Clarity Labs",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var raw=localStorage.getItem("brandTheme");if(!raw)return;var b=JSON.parse(raw);var isDark=document.documentElement.classList.contains("dark");var t=isDark?b.dark:b.light;if(!t)return;var s=document.documentElement.style;for(var k in t){s.setProperty(k,t[k])}document.documentElement.dataset.brandTokensLight=JSON.stringify(b.light);document.documentElement.dataset.brandTokensDark=JSON.stringify(b.dark)}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        <ConvexClientProvider>
          <BrandThemeApplier />
          <AuthGuard>{children}</AuthGuard>
          <AppToaster />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
