"use client";

/**
 * v33 — ConseillerView : module « MON SECTEUR » du conseiller pédagogique.
 *
 * Périmètre STRICT (demande utilisateur : « ces conseillers pourront voir
 * seulement leurs directeurs et leurs adjoints aux directeurs ») :
 *   - le secteur est déduit côté serveur (users.sector_id du compte
 *     connecté — aucun choix possible) ;
 *   - la vue liste les ÉCOLES du secteur et le PERSONNEL concerné :
 *     les directeurs ET les adjoints au directeur ACTIFS de ces écoles ;
 *   - aucun autre module n'est accessible (dashboard-shell grise tout le
 *     reste, page.tsx refuse les accès directs par hash, la matrice RBAC
 *     v5 ne donne au conseiller que la lecture de ce module).
 *
 * v33 — « reproduire la même chose » : le rendu (libellés exacts de la
 * spécification mon-secteur-conseiller.png, écoles dépliables classes/
 * titulaires/effectifs G/F, filtre personnel par école, contacts
 * cliquables) est extrait dans le composant PARTAGÉ SectorOverview,
 * désormais aussi utilisé par la supervision admin/inspector
 * (SectorViewDialog) — une seule implémentation, zéro divergence.
 *
 * Lecture seule : le conseiller CONSULTE (autorité hiérarchique), la
 * gestion des comptes reste réservée à l'administration.
 */

import { useQuery } from "@tanstack/react-query";
import { Network, Loader2 } from "lucide-react";

import { conseillerApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { SectorOverview } from "@/components/secteur/sector-overview";
import { Card, CardContent } from "@/components/ui/card";

export function ConseillerView() {
  const user = useAuthStore((s) => s.user);

  const { data, isLoading, error } = useQuery({
    queryKey: ["conseiller-staff"],
    queryFn: () => conseillerApi.staff(),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">Chargement de votre secteur…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-destructive font-medium">
            Impossible de charger votre secteur
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {(error as Error).message}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Aucun secteur affecté — message d'accueil (l'administration rattache
  // le conseiller à un secteur depuis le module Écoles > Secteurs).
  if (!data?.sector) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Network className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">
            Aucun secteur ne vous est encore affecté
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            {user?.full_name ? `${user.full_name}, v` : "V"}otre secteur
            d&apos;écoles sera défini par l&apos;administration (module
            Écoles &gt; Secteurs d&apos;écoles). Vous verrez ici vos écoles,
            vos directeurs et leurs adjoints.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Corps de la vue — composant partagé avec la supervision admin
  // (SectorViewDialog) : rendu identique à la spécification PNG.
  return (
    <SectorOverview
      data={data}
      welcomeLine={`Bienvenue ${user?.full_name ?? ""} — voici votre périmètre de suivi.`}
    />
  );
}
