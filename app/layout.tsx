import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retina Marketing Solution",
  description: "Pharmaceutical marketing and distribution",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
