import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

// Police Inter — sans-serif moderne pour la lisibilité des données chiffrées
// (cahier des charges §5.2)
const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SYGREN — Gestion de Relevé Électronique de Note",
  description:
    "Plateforme de digitalisation de la gestion des évaluations scolaires pour les écoles primaires de Côte d'Ivoire.",
  keywords: [
    "SYGREN",
    "éducation",
    "Côte d'Ivoire",
    "notes",
    "bulletins",
    "IEP",
  ],
  authors: [{ name: "SYGREN" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <Toaster />
        <SonnerToaster position="top-right" richColors />
      </body>
    </html>
  );
}
