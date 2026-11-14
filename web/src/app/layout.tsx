import type { Metadata } from "next";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fire Seasons — Historical Thermal Anomalies",
  description:
    "Explore satellite-detected thermal activity by region, month and sensor, with MODIS and VIIRS kept separate. Frontera Signal, NASA Space Apps Challenge 2026.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
