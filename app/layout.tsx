import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";

/*
 * DM Sans must be the VARIABLE face: the design's signature UI weight is 550, and a
 * static face snaps to 500 or 600 with no error anywhere. Passing no `weight` to
 * next/font selects the variable font.
 */
const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans-loaded",
  display: "swap",
});

const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CiteProof — citation and quotation audit for AI-drafted briefs",
  description:
    "Checks every case citation and every quotation in a legal brief against primary law, and says so when it cannot be sure.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
