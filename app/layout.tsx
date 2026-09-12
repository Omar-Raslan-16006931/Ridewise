import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Ridewise | Shared Uber ledger",
  description: "A calm, shared Uber ledger for two friends.",
  applicationName: "Ridewise",
  appleWebApp: {
    capable: true,
    title: "Ridewise",
    statusBarStyle: "default",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
