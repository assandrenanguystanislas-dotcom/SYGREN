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
        {/* === Décor officiel ivoirien (toute l'interface) ===
            Demande utilisateur : interface aux COULEURS DU DRAPEAU IVOIRIEN
            avec, EN FILIGRANE, l'ARMOIRIE DE LA CÔTE D'IVOIRE.
            1. Bande tricolore ORANGE · BLANC · VERT fixée en haut de TOUTES
               les pages (connexion, application, chargement) — z-index au-
               dessus de l'en-tête pour rester toujours visible.
            2. Armoiries de la République en filigrane FIXE au centre du
               viewport (z-index -1 : derrière le contenu, au-dessus du
               fond ; non interactive ; masquée à l'impression — les
               documents imprimables ont leur propre filigrane dédié). */}
        <div className="fixed inset-x-0 top-0 z-[60] h-1.5 ci-flag-stripe" aria-hidden="true" />
        <div className="ci-app-watermark" aria-hidden="true">
          <img src="/ci-coat-of-arms.png" alt="" draggable={false} />
        </div>
        {children}
        <Toaster />
        <SonnerToaster position="top-right" richColors />
      </body>
    </html>
  );
}
