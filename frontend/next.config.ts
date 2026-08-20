import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Turbopack désactivé pour le build production — il cause des erreurs
  // "Invalid distDirRoot" sur Vercel et ne génère pas les chunks statiques
  // correctement. Webpack (défaut) est stable et éprouvé pour la prod.
  // En dev local, on peut activer Turbopack via `next dev --turbopack`.
  // NOTE: turbopack.root retiré aussi (chemin local hardcodé incompatible Vercel).
};

export default nextConfig;
