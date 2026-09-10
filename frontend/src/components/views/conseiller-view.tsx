"use client";

/**
 * v5 (session 26) — ConseillerView : vue « MON SECTEUR » du conseiller
 * pédagogique.
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
} from "lucide-react";

import { conseillerApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { ROLE_LABELS, type ConseillerStaffMember } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

  // Filtrage local du personnel (recherche nom / école / contact)
  const q = search.trim().toLowerCase();
  const filteredStaff = staff.filter(
    (m) =>
      !q ||
      m.full_name.toLowerCase().includes(q) ||
      (m.school_name ?? "").toLowerCase().includes(q) ||
      (m.phone ?? "").toLowerCase().includes(q) ||
      (m.email ?? "").toLowerCase().includes(q),
  );

  const directors = staff.filter((m) => m.role === "director").length;
  const adjoints = staff.length - directors;

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
          </CardDescription>
        </CardHeader>
        <CardContent>
          {schools.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-4 text-center">
              Aucune école rattachée à ce secteur pour le moment.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {schools.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2"
                >
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    {s.code && (
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {s.code}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
            Personnel placé sous votre autorité pédagogique (comptes actifs
            des écoles du secteur).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {staff.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par nom, école ou contact…"
                className="pl-9"
              />
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
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {m.phone}
                          </span>
                        )}
                        {m.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {m.email}
                          </span>
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
