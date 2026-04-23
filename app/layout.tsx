import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Instrument_Serif } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/providers";
import { AuthGuard } from "@/components/auth-guard";
import { AppToaster } from "@/components/ui/toaster";
import { BrandThemeApplier } from "@/components/brand-theme-applier";
import { PoweredByFooter } from "@/components/powered-by-footer";
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
  const branding = await getViewerBranding().catch(() => null);

  if (branding) {
    const icons = branding.iconUrl ? { icon: branding.iconUrl } : undefined;
    return {
      title: {
        default: branding.name,
        template: `%s | ${branding.name}`,
      },
      description: DEFAULT_DESCRIPTION,
      icons,
      openGraph: {
        title: branding.name,
        description: DEFAULT_DESCRIPTION,
        siteName: branding.name,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: branding.name,
        description: DEFAULT_DESCRIPTION,
      },
    };
  }

  return {
    title: {
      default: DEFAULT_TITLE,
      template: "%s | Glass",
    },
    description: DEFAULT_DESCRIPTION,
    openGraph: {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      siteName: DEFAULT_TITLE,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const branding = await getViewerBranding().catch(() => null);
  const showPoweredBy = !!branding?.isClientUnderBroker;

  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
            }}
          />
        </head>
        <body
          className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
        >
          <ConvexClientProvider>
            <BrandThemeApplier />
            <AuthGuard>{children}</AuthGuard>
            {showPoweredBy ? <PoweredByFooter /> : null}
            <AppToaster />
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
