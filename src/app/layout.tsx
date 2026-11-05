import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { FishCompanion } from "@/components/FishCompanion";
import "./globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "GENCASO — Global Trading Tax Intelligence",
  description: "Get your crypto tax ready with Gencaso. Estimated tax for Perpetual DEX and Prediction Market traders.",
};

export const viewport: Viewport = { themeColor: "#03060f", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} ${serif.variable} antialiased`}>
        {children}
        <FishCompanion />
      </body>
    </html>
  );
}
