import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CLIPFORGE",
  description: "Remove dead space and silence from your videos",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
