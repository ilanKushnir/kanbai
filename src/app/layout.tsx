import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Kanbai — capture fast, let agents sort", template: "%s · Kanbai" },
  description:
    "The bridge between fast human capture and serious agentic execution. Notes on the go, Kanban when it counts, AI agents that sort the rest.",
  applicationName: "Kanbai",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Kanbai" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d15" },
  ],
  width: "device-width",
  initialScale: 1,
  // Native-like: stop iOS from auto-zooming on input focus (which then makes the
  // whole standalone app pan-scrollable). Honored in display:standalone home-screen apps.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Set the theme class before paint to avoid a flash.
const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('kanbai-theme');
    var d = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (d) document.documentElement.classList.add('dark');
    var c = d ? '#0b0d15' : '#f2f3f8';
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.setAttribute('content', c);
    });
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <Script id="kanbai-theme-no-flash" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {/* In the root layout (not the (app) group) so /login also installs the
            worker that recovers clients stuck on the Cloudflare-cached /sw.js. */}
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
