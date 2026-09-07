"use client";

// === Carte « Mon profil » — module Utilisateurs (rôles Directeur et
// Enseignant) ===
//
// Demande utilisateur (isolation des données) : une fois dans SA page, le
// directeur ou l'enseignant n'accède PAS aux données des autres — seules
// SES informations lui sont accessibles (le directeur voit en plus les
// enseignants de SON école via l'onglet dédié). Cette carte affiche donc
// le profil + le dossier personnel de l'agent CONNECTÉ uniquement,
// en lecture seule :
//   - Identité : nom, rôle, établissement (code + nom), contacts ;
//   - Dossier personnel « État nominatif » : matricule, sexe, naissance,
//     catégorie, classe, échelon, cours (CP1..CM2), fonction, dates
//     F.P / DREN / IEP, effectifs et redoublants F/G/T ;
//   - Les champs non renseignés sont masqués (aucun 0 factice).
//
// Source unique : GET /api/me (données fraîches à chaque affichage — le
// store Zustand peut être périmé si le dossier a été modifié après login).

import { useQuery } from "@tanstack/react-query";
import { IdCard, Loader2, UserRound } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { authApi } from "@/lib/api";
import { ROLE_LABELS, formatDossierDate, type User } from "@/lib/types";
import {
  CLASSE_GRADE_LABELS,
  hasPersonnelData,
  personnelOf,
} from "@/components/personnel-dossier-fields";

/** Une ligne « libellé : valeur » du dossier (masquée si vide). */
function DossierRow({ label, value }: { label: string; value?: string | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-border/60 last:border-0">
      <span className="text-[11px] text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-right">{value}</span>
    </div>
  );
}

/** Groupe F/G/T (effectif ou redoublants) — masqué si tout est vide. */
function FGTGroup({
  label,
  f,
  g,
  t,
}: {
  label: string;
  f?: number | null;
  g?: number | null;
  t?: number | null;
}) {
  if (f == null && g == null && t == null) return null;
  const cell = (v: number | null | undefined, cap: string) =>
    v != null ? `${cap} ${v < 10 ? `0${v}` : v}` : null;
  const parts = [cell(f, "F"), cell(g, "G"), cell(t, "T")].filter(Boolean);
  return <DossierRow label={label} value={parts.join(" · ")} />;
}

export function MyProfileCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["me-profile"],
    queryFn: () => authApi.me(),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const u: User = data;
  const dossier = personnelOf(u);
  const hasDossier = hasPersonnelData(dossier);
  const naissance = [
    formatDossierDate(dossier.date_naissance),
    dossier.lieu_naissance ? `à ${dossier.lieu_naissance}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="w-5 h-5 text-primary" aria-hidden />
          Mon profil
          <Badge variant="outline" className="text-[10px]">
            {ROLE_LABELS[u.role] ?? u.role}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Identité + établissement */}
        <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
          <p className="text-sm font-semibold">{u.full_name}</p>
          <p className="text-xs text-muted-foreground">
            Établissement :{" "}
            {u.school_name ? (
              <>
                {u.school_name}
                {u.school_code ? (
                  <span className="font-mono ml-1.5">({u.school_code})</span>
                ) : null}
              </>
            ) : (
              "—"
            )}
          </p>
          {u.phone && (
            <p className="text-xs text-muted-foreground">Téléphone : {u.phone}</p>
          )}
          {u.email && (
            <p className="text-xs text-muted-foreground">Courriel : {u.email}</p>
          )}
        </div>

        {/* Dossier personnel (état nominatif) — lecture seule */}
        {hasDossier ? (
          <div className="rounded-lg border p-3 space-y-0.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground pb-1.5">
              <IdCard className="w-3.5 h-3.5" />
              Dossier personnel — État nominatif du personnel
            </div>
            <DossierRow label="Matricule" value={dossier.matricule} />
            <DossierRow label="Sexe" value={dossier.sexe} />
            <DossierRow label="Naissance" value={naissance} />
            <DossierRow label="Catégorie" value={dossier.categorie} />
            <DossierRow
              label="Classe"
              value={
                dossier.classe_grade != null
                  ? (CLASSE_GRADE_LABELS[dossier.classe_grade] ??
                    String(dossier.classe_grade))
                  : null
              }
            />
            <DossierRow
              label="Échelon"
              value={dossier.echelon != null ? `Échelon ${dossier.echelon}` : null}
            />
            <DossierRow label="Cours" value={dossier.cours} />
            <DossierRow
              label="Fonction"
              value={
                dossier.fonction === "ADJOINT(E)" ? "Adjoint(e)" : dossier.fonction
              }
            />
            <DossierRow
              label="Entrée F.P"
              value={formatDossierDate(dossier.date_entree_fp)}
            />
            <DossierRow
              label="Entrée DREN"
              value={formatDossierDate(dossier.date_entree_dren)}
            />
            <DossierRow
              label="Entrée IEP"
              value={formatDossierDate(dossier.date_entree_iep)}
            />
            <FGTGroup
              label="Effectif"
              f={dossier.effectif_f}
              g={dossier.effectif_g}
              t={dossier.effectif_t}
            />
            <FGTGroup
              label="Redoublants"
              f={dossier.redoublant_f}
              g={dossier.redoublant_g}
              t={dossier.redoublant_t}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Aucune information de dossier personnel renseignée pour le moment.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
