import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "runmysocials",
  description: "Private single-user dashboard — not public, no sign-up.",
  manifest: "/app/manifest.json",
  // iOS uses apple-touch-icon for the Home Screen (installing is what enables Web Push there, F8).
  icons: { icon: "/app/icons/icon-192.png", apple: "/app/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "autopilot", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#111111",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
