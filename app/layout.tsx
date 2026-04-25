import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SecureVault Demo — Hackathon",
  description: "A hackathon demo showing session-based text storage with simulated attack vectors.",
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
