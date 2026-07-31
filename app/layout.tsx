import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"],
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const SITE_NAME = "XYZ Construction";
const TITLE = "XYZ Construction — Where Vision Becomes Structure";
const DESCRIPTION =
  "Ground-up luxury residences, engineered from first pour to final light. A scroll-scrubbed build timelapse.";

export const metadata: Metadata = {
  // Placeholder origin: XYZ Construction is a fictional brand built as a
  // portfolio piece, so there is no real domain to point at. Setting it anyway
  // keeps Next from warning about resolving relative OG image URLs.
  metadataBase: new URL("https://xyz-construction-demo.example"),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Clyntel Web Services", url: "https://clyntel.ca" }],
  creator: "Clyntel Web Services",
  keywords: [
    "luxury construction",
    "custom homes",
    "residential builder",
    "scroll experience",
  ],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_CA",
    images: [
      {
        url: "/hero-poster.jpg",
        width: 1280,
        height: 720,
        alt: "Foundation rebar laid out on a hillside build site at first light.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/hero-poster.jpg"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0b0e13",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
