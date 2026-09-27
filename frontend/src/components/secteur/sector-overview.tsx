"use client";

/**
 * v33 — SectorOverview : corps de la vue « MON SECTEUR » rendu PARTAGÉ.
 *
 * « reproduire la même chose en créant dans module mon secteur » : le
 * rendu exact de la spécification mon-secteur-conseiller.png (capture
 * production v31) est désormais UN composant unique utilisé :
 *   - par la vue conseiller (ConseillerView) — son périmètre strict ;
 *   - par la supervision admin / inspector (SectorViewDialog) — bouton
 *     « Voir le secteur » de la plage Secteurs d'écoles et de l'onglet
 *     Conseillers (endpoint identique GET /api/conseiller/staff,
 *     paramètre ?sector_id= prévu côté serveur dès la v5).
 *
 * Éléments qui accompagnent le module (session 31) : écoles DÉPLIABLES
 * (classes, titulaires, effectifs G/F), filtre personnel par école,
 * recherche, contacts cliquables, libellés exacts de la spécification.
 *
 * Session 42 — bouton « État nominatif » : demande utilisateur (« dans le
 * module utilisateurs, le conseiller peut voir l'état nominatif mais ne
 * peut pas l'imprimer »). À côté du filtre école du personnel, un bouton
 * ouvre le document officiel « ÉTAT NOMINATIF DU PERSONNEL » de l'école
 * sélectionnée (/personnel-doc) en CONSULTATION : la données est déjà
 * autorisée au conseiller côté backend (GET /api/reports/personnel — case
 * conseiller, bornée à SON secteur, liste blanche ConseillerScope v6) et
 * l'IMPRESSION y reste verrouillée par print-guard.tsx (badge « Zone
 * Imprimer / PDF verrouillée » + blocage @media print — seul l'Admin IEP
 * et le Super Admin impriment), exactement comme les bulletins. Le bouton
 * est aussi utile à la supervision (dialog admin/inspector) — le backend
 * borne chaque rôle de toute façon.
 *
 * v14 — TOTAUX D'APRÈS L'ÉTAT NOMINATIF DU PERSONNEL (demande utilisateur :
 * « annuler le calcul par niveaux — je veux que l'administrateur et le
 * conseiller sachent le nombre total d'enseignants, de niveaux et d'élèves
 * à travers l'état nominatif du personnel ») :
 *   - les badges d'en-tête et les cartes écoles affichent ENSEIGNANTS /
 *     NIVEAUX / ÉLÈVES calculés côté serveur d'après les dossiers du
 *     personnel + les niveaux déclarés sans enseignant (plus de comptage
 *     sur les classes standard auto-créées — 6 niveaux fantômes — ni sur
 *     les inscrits) ; une école à 1, 2, 3 niveaux affiche 1, 2, 3
 *     niveaux, les niveaux sans enseignant comptent aussi ;
 *   - le détail dépliable d'une école montre les NIVEAUX RÉELS (cours,
 *     titulaire, effectifs F/G/T, totaux) au lieu de la liste des
 *     classes standard.
 *
 * Lecture seule : composant de CONSULTATION (autorité hiérarchique),
 * la gestion des comptes reste réservée à l'administration.
 */

import { useState } from "react";
import {
  School as SchoolIcon,
  Users,
  Building2,
  GraduationCap,
  Phone,
  Mail,
  MapPin,
  UserRound,
  Search,
  ChevronDown,
  BookOpen,
  FileText,
} from "lucide-react";

import type {
  ConseillerStaffMember,
  ConseillerStaffResponse,
  SectorNiveau,
  SectorSchool,
} from "@/lib/types";
import { ROLE_LABELS } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityCombobox } from "@/components/entity-combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Fonction d'un membre du personnel — l'adjoint au directeur est un compte
 *  « teacher » dans SYGREN (libellé RBAC) ; la FONCTION du dossier personnel
 *  (DIRECTEUR | ADJOINT(E)) prime quand elle est renseignée. */
function fonctionLabel(m: ConseillerStaffMember): string {
  if (m.role === "director") return "Directeur";
  if (m.fonction === "ADJOINT(E)") return "Adjoint(e) au directeur";
  if (m.fonction === "DIRECTEUR") return "Directeur";
  return ROLE_LABELS[m.role] ?? m.role;
}

export function SectorOverview({
  data,
  welcomeLine,
}: {
  data: ConseillerStaffResponse;
  /** Ligne d'accueil sous le nom du secteur (le conseiller reçoit
   *  « Bienvenue … », la supervision admin une ligne de consultation). */
  welcomeLine?: string;
}) {
  const [search, setSearch] = useState("");
  const [schoolFilter, setSchoolFilter] = useState<string>("all");
  // École dont le détail (classes, effectifs G/F) est déplié — une seule
  // à la fois (null = toutes repliées).
  const [expandedSchool, setExpandedSchool] = useState<string | null>(null);

  const sector = data.sector;
  const schools = data.schools ?? [];
  const staff = data.staff ?? [];

  // Filtrage local du personnel (recherche nom / école / contact + filtre
  // par école — élément qui accompagne le module, session 31).
  const q = search.trim().toLowerCase();
  const filteredStaff = staff.filter(
    (m) =>
      (schoolFilter === "all" || m.school_id === schoolFilter) &&
      (!q ||
        m.full_name.toLowerCase().includes(q) ||
        (m.school_name ?? "").toLowerCase().includes(q) ||
        (m.phone ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q)),
  );

  const directors = staff.filter((m) => m.role === "director").length;
  const adjoints = staff.length - directors;

  // v14 — TOTAUX D'APRÈS L'ÉTAT NOMINATIF DU PERSONNEL (demande
  // utilisateur) : enseignants (agents tenant un cours), niveaux réels
  // (tenus + déclarés sans enseignant) et élèves (effectifs des
  // dossiers + lignes déclarées). Calculés côté serveur ; repli local
  // sur la somme des écoles si besoin.
  const totalTeachers =
    data.counts?.teachers ??
    schools.reduce((acc, s) => acc + (s.nom_teachers ?? 0), 0);
  const totalNiveaux =
    data.counts?.levels ??
    schools.reduce((acc, s) => acc + (s.nom_levels ?? 0), 0);
  const totalEleves =
    data.counts?.students ??
    schools.reduce((acc, s) => acc + (s.nom_students ?? 0), 0);

  // École dépliée (détail des NIVEAUX RÉELS — v14) — session 31.
  const expanded =
    schools.find((s) => s.id === expandedSchool) ?? null;

  /** Somme d'une colonne du détail des niveaux (fallback si absent). */
  const sumNiveaux = (
    niveaux: SectorNiveau[] | undefined,
    pick: (n: SectorNiveau) => number,
  ): number => (niveaux ?? []).reduce((acc, n) => acc + pick(n), 0);

  return (
    <div className="space-y-4">
      {/* En-tête du secteur */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <SchoolIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-lg leading-tight">
                Secteur {sector?.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                {welcomeLine ?? "Voici votre périmètre de suivi."}
              </p>
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <Badge variant="secondary" className="gap-1">
                <SchoolIcon className="w-3 h-3" />
                {schools.length} école(s)
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Building2 className="w-3 h-3" />
                {directors} directeur(s)
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <GraduationCap className="w-3 h-3" />
                {adjoints} adjoint(s)
              </Badge>
              {/* v14 — TOTAUX D'APRÈS L'ÉTAT NOMINATIF DU PERSONNEL */}
              <Badge variant="secondary" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                <Users className="w-3 h-3" />
                {totalTeachers} enseignant(s)
              </Badge>
              <Badge variant="secondary" className="gap-1 border-sky-200 bg-sky-50 text-sky-700">
                <BookOpen className="w-3 h-3" />
                {totalNiveaux} niveau(x)
              </Badge>
              <Badge variant="secondary" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
                <GraduationCap className="w-3 h-3" />
                {totalEleves} élève(s)
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Écoles du secteur */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SchoolIcon className="w-4 h-4 text-primary" />
            Écoles du secteur
          </CardTitle>
          <CardDescription>
            Les établissements dont relèvent vos directeurs et leurs adjoints.
            Cliquez sur une école pour voir ses NIVEAUX RÉELS et leurs
            effectifs d&apos;après l&apos;état nominatif du personnel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {schools.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-4 text-center">
              Aucune école rattachée à ce secteur pour le moment.
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {schools.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setExpandedSchool((cur) => (cur === s.id ? null : s.id))
                    }
                    aria-expanded={expandedSchool === s.id}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                      expandedSchool === s.id
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/60 bg-card hover:border-primary/30 hover:bg-muted/30"
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      {s.code && (
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {s.code}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* v14 — totaux d'après l'ÉTAT NOMINATIF DU PERSONNEL */}
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        <Users className="w-3 h-3" />
                        {s.nom_teachers ?? 0} enseignant(s)
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-sky-200 bg-sky-50 text-sky-700"
                      >
                        {s.nom_levels ?? 0} niveau(s)
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-amber-200 bg-amber-50 text-amber-700"
                      >
                        {s.nom_students ?? 0} élève(s)
                      </Badge>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${
                          expandedSchool === s.id ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </button>
                ))}
              </div>

              {/* v14 — Détail de l'école dépliée : les NIVEAUX RÉELS,
                  calculés d'après l'ÉTAT NOMINATIF DU PERSONNEL (cours
                  tenus par les agents + niveaux déclarés sans enseignant)
                  — remplace la liste des classes standard auto-créées
                  (calcul annulé, demande utilisateur). */}
              {expanded && (
                <div className="rounded-lg border border-primary/25 bg-muted/20 p-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <SchoolIcon className="w-4 h-4 text-primary" />
                    <p className="text-sm font-semibold">{expanded.name}</p>
                    {expanded.code && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {expanded.code}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 sm:ml-auto">
                      <Badge
                        variant="outline"
                        className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        {expanded.nom_teachers ?? 0} enseignant(s)
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-pink-200 bg-pink-50 text-pink-700"
                      >
                        {(expanded.nom_filles ?? 0)} fille(s)
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-sky-200 bg-sky-50 text-sky-700"
                      >
                        {(expanded.nom_garcons ?? 0)} garçon(s)
                      </Badge>
                    </div>
                  </div>
                  {(expanded.niveaux ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-2 text-center">
                      Aucun niveau tenu par un agent ni niveau déclaré — les
                      données se saisissent dans les dossiers du personnel
                      (module Utilisateurs) et via « Niveaux sans enseignant ».
                    </p>
                  ) : (
                    <div className="rounded-md border overflow-hidden bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Niveau (cours)</TableHead>
                            <TableHead>Titulaire</TableHead>
                            <TableHead className="text-center">F</TableHead>
                            <TableHead className="text-center">G</TableHead>
                            <TableHead className="text-center">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {expanded.niveaux!.map((n) => (
                            <TableRow key={n.cours}>
                              <TableCell className="font-medium">
                                <span className="flex items-center gap-1.5">
                                  <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
                                  {n.cours}
                                  {n.vacant && (
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] border-rose-200 bg-rose-50 text-rose-700"
                                    >
                                      sans enseignant
                                    </Badge>
                                  )}
                                </span>
                              </TableCell>
                              <TableCell className="text-sm">
                                {n.titulaire || (
                                  <span className="italic text-muted-foreground">
                                    — sans enseignant —
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-center text-sm">
                                {n.filles}
                              </TableCell>
                              <TableCell className="text-center text-sm">
                                {n.garcons}
                              </TableCell>
                              <TableCell className="text-center text-sm font-semibold">
                                {n.total}
                              </TableCell>
                            </TableRow>
                          ))}
                          {/* Totaux de l&apos;école (état nominatif) */}
                          <TableRow className="bg-emerald-50/60 font-semibold">
                            <TableCell
                              colSpan={2}
                              className="text-xs uppercase tracking-wide text-emerald-800"
                            >
                              Total — {expanded.nom_teachers ?? 0} enseignant
                              {(expanded.nom_teachers ?? 0) > 1 ? "s" : ""} ·{" "}
                              {(expanded.niveaux ?? []).length} niveau
                              {(expanded.niveaux ?? []).length > 1 ? "x" : ""}
                            </TableCell>
                            <TableCell className="text-center text-sm">
                              {sumNiveaux(expanded.niveaux, (n) => n.filles)}
                            </TableCell>
                            <TableCell className="text-center text-sm">
                              {sumNiveaux(expanded.niveaux, (n) => n.garcons)}
                            </TableCell>
                            <TableCell className="text-center text-sm font-bold text-emerald-800">
                              {sumNiveaux(expanded.niveaux, (n) => n.total)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Calcul d&apos;après l&apos;ÉTAT NOMINATIF DU PERSONNEL :
                    un niveau existe s&apos;il est tenu par un agent ou
                    déclaré sans enseignant — une école à 1, 2, 3 niveaux
                    affiche 1, 2, 3 niveaux.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Personnel du secteur : directeurs + adjoints */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="w-4 h-4 text-primary" />
            Directeurs et adjoints au directeur
          </CardTitle>
          <CardDescription>
            Personnel de ces communautés éducatives, désigné pour superviser
            et rendre compte au niveau du secteur.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(staff.length > 0 || schools.length > 0) && (
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher par nom, école ou contact…"
                  className="pl-9"
                />
              </div>
              {/* v12 — clic dans le champ + premières lettres : la liste
                  se filtre (plus besoin de faire défiler). */}
              <EntityCombobox
                className="sm:w-[240px]"
                items={schools.map((s: SectorSchool) => ({
                  value: s.id,
                  label: s.name,
                }))}
                value={schoolFilter}
                onChange={setSchoolFilter}
                allowEmpty
                emptyValue="all"
                emptyLabel="Toutes les écoles"
                placeholder="Toutes les écoles"
                searchPlaceholder="Premières lettres de l'école…"
              />
              {/* Session 42 — « État nominatif » : consultation du document
                  officiel de l'école sélectionnée (impression verrouillée
                  dans le document pour le conseiller — cf. print-guard). */}
              {(() => {
                const target =
                  schoolFilter !== "all" ? schoolFilter : "";
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={!target}
                    title={
                      target
                        ? "Consulter l'état nominatif du personnel de l'école sélectionnée (consultation — impression réservée à l'Admin IEP et au Super Admin)"
                        : "Sélectionnez d'abord une école dans le filtre"
                    }
                    onClick={() =>
                      window.open(
                        `/personnel-doc?school=${target}`,
                        "_blank",
                      )
                    }
                  >
                    <FileText className="w-4 h-4 mr-1.5" />
                    État nominatif
                  </Button>
                );
              })()}
            </div>
          )}
          {staff.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-6 text-center">
              Aucun directeur ni adjoint au directeur dans les écoles de ce
              secteur.
            </p>
          ) : filteredStaff.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-6 text-center">
              Aucun résultat pour « {search} ».
            </p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Nom</TableHead>
                    <TableHead>Fonction</TableHead>
                    <TableHead>École</TableHead>
                    <TableHead>Contact</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStaff.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <UserRound className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          {m.full_name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            m.role === "director"
                              ? "border-sky-300 text-sky-700 bg-sky-50"
                              : "border-slate-300 text-slate-700 bg-slate-50"
                          }
                        >
                          {fonctionLabel(m)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {m.school_name ?? "—"}
                        {m.school_code && (
                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                            {m.school_code}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.phone && (
                          <a
                            href={`tel:${m.phone.replace(/\s+/g, "")}`}
                            className="flex items-center gap-1 hover:text-primary"
                          >
                            <Phone className="w-3 h-3" />
                            {m.phone}
                          </a>
                        )}
                        {m.email && (
                          <a
                            href={`mailto:${m.email}`}
                            className="flex items-center gap-1 hover:text-primary"
                          >
                            <Mail className="w-3 h-3" />
                            {m.email}
                          </a>
                        )}
                        {!m.phone && !m.email && "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
