"use client";

/**
 * v33 — SectorViewDialog : SUPVISION admin / inspector d'un secteur,
 * reproduisant exactement la vue « Mon Secteur » du conseiller.
 *
 * « reproduire la même chose en créant dans module mon secteur » : le
 * dialogue affiche le MÊME composant que la vue conseiller
 * (SectorOverview — libellés, badges, écoles dépliables classes/titulaires/
 * effectifs G/F, filtre par école, recherche, contacts cliquables), avec
 * les données du MÊME endpoint GET /api/conseiller/staff?sector_id=…
 * (paramètre prévu côté serveur pour admin/inspector depuis la v5).
 *
 * Points d'entrée : plage « Secteurs d'écoles » (module Écoles, bouton
 * œil par secteur) et onglet « Conseillers » (module Utilisateurs, bouton
 * œil « Voir son secteur »).
 */

import { useQuery } from "@tanstack/react-query";
import { Loader2, Network } from "lucide-react";

import { conseillerApi } from "@/lib/api";
import { SectorOverview } from "@/components/secteur/sector-overview";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SectorViewDialog({
  open,
  onOpenChange,
  sectorId,
  sectorName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectorId: string;
  sectorName?: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["conseiller-staff", sectorId],
    queryFn: () => conseillerApi.staff(sectorId),
    enabled: open && !!sectorId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="w-4 h-4 text-primary" />
            Secteur {sectorName ?? ""}
          </DialogTitle>
          <DialogDescription>
            Vue « Mon Secteur » — consultation de supervision (écoles,
            classes, effectifs, directeurs et adjoints au directeur).
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-14 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm">Chargement du secteur…</p>
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-8 text-center">
            Impossible de charger ce secteur : {(error as Error).message}
          </p>
        ) : data?.sector ? (
          <SectorOverview
            data={data}
            welcomeLine="Consultation de supervision — périmètre vu par le(s) conseiller(s) affecté(s)."
          />
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Secteur introuvable.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
