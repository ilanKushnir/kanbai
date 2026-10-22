import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter_Tight } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"] });

/** Canvas colours mirrored into the iOS status bar (see the no-flash script). */
export const CANVAS_LIGHT = "#f2f2f2";
export const CANVAS_DARK = "#000000";

export const metadata: Metadata = {
  title: { default: "KanbAi — your day, one list", template: "%s · KanbAi" },
  description:
    "A calm place for your tasks and projects. Capture in one line, work from one list, and let your AI agent keep it current.",
  applicationName: "KanbAi",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "KanbAi" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: CANVAS_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: CANVAS_DARK },
  ],
  width: "device-width",
  initialScale: 1,
  // Native-like: stop iOS from auto-zooming on input focus (which then makes the
  // whole standalone app pan-scrollable). Honored in display:standalone home-screen apps.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Set the theme class before first paint (an inline <head> script runs while
// the HTML is parsed — next/script's beforeInteractive waits for the runtime,
// which let installed apps paint one frame in the wrong theme).
const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('kanbai-theme');
    var d = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    var r = document.documentElement;
    r.classList.toggle('dark', d);
    r.style.colorScheme = d ? 'dark' : 'light';
    var c = d ? '${CANVAS_DARK}' : '${CANVAS_LIGHT}';
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
      className={`${geistSans.variable} ${geistMono.variable} ${interTight.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* The canvas colour before the stylesheet arrives, so a cold start never
            shows a white (or black) frame in the other theme. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `html{background:${CANVAS_LIGHT}}html.dark{background:${CANVAS_DARK}}`,
          }}
        />
      </head>
      <body className="min-h-full">
        {/* In the root layout (not the (app) group) so /login also installs the
            worker that recovers clients stuck on the Cloudflare-cached /sw.js. */}
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
