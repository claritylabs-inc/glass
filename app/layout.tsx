import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Instrument_Serif } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/providers";
import { AuthGuard } from "@/components/auth-guard";
import { AppToaster } from "@/components/ui/toaster";
import { BrandThemeApplier } from "@/components/brand-theme-applier";
import { getViewerBranding } from "@/lib/viewer-branding";
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

const DEFAULT_TITLE = "Glass from Clarity Labs";
const DEFAULT_DESCRIPTION = "Insurance policy intelligence by Clarity Labs";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getViewerBranding();
  const title = branding?.name ?? DEFAULT_TITLE;
  const icon = branding?.iconUrl ?? undefined;

  return {
    title: {
      default: title,
      template: `${title} - %s`,
    },
    description: DEFAULT_DESCRIPTION,
    icons: icon ? { icon } : undefined,
    openGraph: {
      title,
      description: DEFAULT_DESCRIPTION,
      siteName: title,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: DEFAULT_DESCRIPTION,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark");var b=localStorage.getItem("glass:boot-state");var s=localStorage.getItem("glass:sync-scope");if(b&&s){b=JSON.parse(b);s=JSON.parse(s);if(b&&s&&b.userId===s.userId&&b.orgId===s.orgId)window.__GLASS_BOOT__={onboardingComplete:b.onboardingComplete,membershipRole:b.membershipRole,userId:b.userId,orgId:b.orgId}}}catch(e){}})()`,
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
    </ConvexAuthNextjsServerProvider>
  );
}
