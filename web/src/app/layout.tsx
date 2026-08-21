import "./globals.css"

import type { Metadata } from "next"
import { Geist_Mono, Inter } from "next/font/google"
import Script from "next/script"

import { AppProvider } from "@/components/providers/app-provider"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  applicationName: "DisCloud",
  title: {
    default: "DisCloud",
    template: "%s · DisCloud",
  },
  description: "Self-hosted multi-user file storage backed by Discord attachments and PostgreSQL.",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <Script src="/runtime-config.js" strategy="beforeInteractive" />
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  )
}