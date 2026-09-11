"use client";

/**
 * v31 — ConseillerView : module « MON SECTEUR » du conseiller pédagogique.
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
 * v31 — « éléments qui l'accompagnent » (le module est désormais complet,
 * conforme à la spécification mon-secteur-conseiller.png) :
 *   - écoles DÉPLIABLES : classes actives de l'école (niveau, titulaire,
 *     effectif Garçons / Filles / Total) — données du même endpoint strict ;
 *   - effectif détaillé G/F par école ;
 *   - personnel filtrable PAR ÉCOLE + contacts cliquables (tél. / email) ;
 *   - libellés exacts de la spécification (carte « Directeurs et adjoints
 *     au directeur » : « Personnel de ces communautés éducatives, désigné
 *     pour superviser et rendre compte au niveau du secteur. »).
 *
 * Lecture seule : le conseiller CONSULTE (autorité hiérarchique), la
 * gestion des comptes reste réservée à l'administration.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Network,
  School as SchoolIcon,
  Users,
  Building2,
  GraduationCap,
  Phone,
  Mail,
  Loader2,
  MapPin,
  UserRound,
  Search,
  ChevronDown,
  BookOpen,
} from "lucide-react";

import { conseillerApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import {
  ROLE_LABELS,
  type ConseillerStaffMember,
  type SectorSchool,
} from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Fonction d'un membre du personnel — l'adjoint au directeur est un compte
 *  « teacher » dans SYGREN (libellé RBAC) ; la FONCTION du dossier personnel
 *  (DIRECTEUR | ADJOINT(E)) prime quand elle est renseignée. */
function fonctionLabel(m: ConseillerStaffMember): string {
  if (m.role === "director") return "Directeur";
  if (m.fonction === "ADJOINT(E)") return "Adjoint(e) au directeur";
  if (m.fonction === "DIRECTEUR") return "Directeur";
  return ROLE_LABELS[m.role] ?? m.role;
}

export function ConseillerView() {
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState("");
  const [schoolFilter, setSchoolFilter] = useState<string>("all");
  // École dont le détail (classes, effectifs G/F) est déplié — une seule
  // à la fois (null = toutes repliées).
  const [expandedSchool, setExpandedSchool] = useState<string | null>(null);

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

  const sector = data?.sector ?? null;
  const schools = data?.schools ?? [];
  const staff = data?.staff ?? [];

  // Aucun secteur affecté — message d'accueil (l'administration rattache
  // le conseiller à un secteur depuis le module Écoles > Secteurs).
  if (!sector) {
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

  // Statistiques des écoles (session 27) : élèves et classes cumulés
  // du secteur (affichés dans l'en-tête et sur chaque carte école).
  const totalStudents = schools.reduce(
    (acc, s) => acc + (s.student_count ?? 0),
    0,
  );
  const totalClasses = schools.reduce(
    (acc, s) => acc + (s.class_count ?? 0),
    0,
  );

  // École dépliée (détail classes / effectifs G-F) — session 31.
  const expanded =
    schools.find((s) => s.id === expandedSchool) ?? null;

  return (
    <div className="space-y-4">
      {/* En-tête du secteur */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Network className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-lg leading-tight">
                Secteur {sector.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                Bienvenue {user?.full_name ?? ""} — voici votre périmètre de
                suivi.
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
              <Badge variant="secondary" className="gap-1">
                <Users className="w-3 h-3" />
                {totalStudents} élève(s)
              </Badge>
              <Badge variant="secondary" className="gap-1">
                {totalClasses} classe(s)
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
            Cliquez sur une école pour voir ses classes et leurs effectifs.
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
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        <Users className="w-3 h-3" />
                        {s.student_count ?? 0} élève(s)
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-sky-200 bg-sky-50 text-sky-700"
                      >
                        {s.class_count ?? 0} classe(s)
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

              {/* Détail de l'école dépliée : classes + effectifs G/F
                  (élément qui accompagne le module — session 31). */}
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
                        className="text-[10px] border-sky-200 bg-sky-50 text-sky-700"
                      >
                        {(expanded.garcons ?? 0)} garçon(s)
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-pink-200 bg-pink-50 text-pink-700"
                      >
                        {(expanded.filles ?? 0)} fille(s)
                      </Badge>
                    </div>
                  </div>
                  {(expanded.classes ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-2 text-center">
                      Aucune classe active dans cette école.
                    </p>
                  ) : (
                    <div className="rounded-md border overflow-hidden bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Classe</TableHead>
                            <TableHead>Titulaire</TableHead>
                            <TableHead className="text-center">G</TableHead>
                            <TableHead className="text-center">F</TableHead>
                            <TableHead className="text-center">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {expanded.classes!.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-medium">
                                <span className="flex items-center gap-1.5">
                                  <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
                                  {c.name}
                                </span>
                              </TableCell>
                              <TableCell className="text-sm">
                                {c.teacher_name || (
                                  <span className="text-muted-foreground">
                                    Non affecté
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-center text-sm">
                                {c.garcons}
                              </TableCell>
                              <TableCell className="text-center text-sm">
                                {c.filles}
                              </TableCell>
                              <TableCell className="text-center text-sm font-semibold">
                                {c.student_count}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
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
              <Select value={schoolFilter} onValueChange={setSchoolFilter}>
                <SelectTrigger className="sm:w-[240px]">
                  <SelectValue placeholder="Toutes les écoles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les écoles</SelectItem>
                  {schools.map((s: SectorSchool) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
