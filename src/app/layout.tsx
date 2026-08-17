import type { Metadata, Viewport } from "next"
import { JetBrains_Mono } from "next/font/google"
import "./globals.css"

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Radius | Supply Chain Blast Radius on HydraDB",
  description:
    "A live npm and PyPI dependency graph on HydraDB. Trace exposure, shared maintainers, and resolved lockfiles the instant a package is compromised.",
  keywords: [
    "supply chain security",
    "dependency graph",
    "npm security",
    "PyPI security",
    "blast radius",
    "graph database",
    "HydraDB",
    "vulnerability detection",
  ],
  authors: [{ name: "Radius" }],
  creator: "Radius",
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="font-mono antialiased">
        {children}
      </body>
    </html>
  )
}
