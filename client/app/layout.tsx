import type React from "react";
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { PWAProvider } from "../components/pwa-provider";

const _geist = GeistSans;
const _geistMono = GeistMono;

export const metadata: Metadata = {
    title: "SYNCRO — Subscription Manager",
    description: "Self-custodial subscription management on Stellar",
    generator: "v0.app",
    manifest: "/manifest.json",
    themeColor: "#6366f1",
    viewport: "width=device-width, initial-scale=1, maximum-scale=1",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`font-sans antialiased`} suppressHydrationWarning>
                <PWAProvider>
                    {children}
                </PWAProvider>
            </body>
        </html>
    );
}
