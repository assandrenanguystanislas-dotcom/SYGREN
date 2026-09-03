"use client";

// === Portail Parent (v2) — consultation + impression du bulletin
// individuel de l'enfant ===
//
// Compte de rôle « parent » (créé dans le module Utilisateurs → onglet
// Parents). Le parent saisit (ou retrouve pré-saisi) LE MATRICULE DE SON
// ENFANT, puis :
//   - « Bulletin de fin d'année » (module Résultats) : ouvre le bulletin
//     individuel « RESULTATS DE FIN D'ANNEE » de l'enfant (v3 : UN SEUL
//     exemplaire, page B5 portrait, drapeau CI) — CONSULTATION +
//     IMPRESSION autorisées ;
//   - « Bulletins de période » (module Bulletins) : choisit une session
//     (composition mensuelle / passage) et ouvre le bulletin individuel
//     B5 de l'enfant (UN seul exemplaire) — CONSULTATION + IMPRESSION
//     autorisées.
//
// L'impression est VERROUILLÉE pour le parent sur tout autre document :
// les pages d'impression vérifient le rôle (lib/print-guard) et n'autorisent
// le parent QUE pour ces deux documents ouverts en mode matricule.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  GraduationCap,
  Loader2,
  Search,
  UserRound,
  FileText,
  CalendarDays,
  Printer,
  Home,
  CheckCircle2,
} from "lucide-react";

import { parentPortalApi, type ParentStudentInfo } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { monthLabel, SESSION_STATUS_CONFIG } from "@/lib/session-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Libellé court du type d'évaluation (sélecteur de session). */
function evalTypeShort(evalType: string): string {
  switch (evalType) {
    case "composition":
      return "Composition";
    case "composition_passage":
      return "Composition de passage";
    case "exam_blanc":
      return "Examen blanc";
    default:
      return "Évaluation";
  }
}

export function ParentPortalView() {
  const user = useAuthStore((s) => s.user);
  // Matricule pré-rempli depuis le compte (child_matricule — champ du
  // dossier parent) ; le parent peut le modifier à la saisie.
  const [matricule, setMatricule] = useState(user?.child_matricule ?? "");
  const [submitted, setSubmitted] = useState<string | null>(
    user?.child_matricule ?? null,
  );

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["parent-portal", "student", submitted],
    queryFn: () => parentPortalApi.student(submitted!),
    enabled: !!submitted,
  });

  function search(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(matricule.trim() || null);
  }

  // Ouvre un document dans un nouvel onglet (token via URL — pattern des
  // autres documents SYGREN ; la page gère le verrou d'impression).
  function openDoc(path: string, params: Record<string, string>) {
    let token = "";
    try {
      const raw = localStorage.getItem("sygren-auth");
      if (raw) token = JSON.parse(raw)?.state?.token ?? "";
    } catch {
      /* token absent — la page affichera l'erreur */
    }
    const qs = new URLSearchParams({ ...params, t: token });
    window.open(`${window.location.origin}${path}?${qs.toString()}`, "_blank");
  }

  return (
    <div className="space-y-4">
      {/* === Recherche par matricule === */}
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Home className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-base">Portail Parent</h2>
              <p className="text-xs text-muted-foreground">
                Consultez et imprimez le bulletin individuel de votre enfant à
                partir de son matricule
              </p>
            </div>
          </div>
          <form onSubmit={search} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5 min-w-[220px] flex-1 max-w-[360px]">
              <Label
                htmlFor="matricule"
                className="text-xs font-medium text-muted-foreground"
              >
                Matricule de l&apos;enfant
              </Label>
              <Input
                id="matricule"
                value={matricule}
                onChange={(e) => setMatricule(e.target.value)}
                placeholder="Ex : 196254015U"
                className="font-mono"
              />
            </div>
            <Button type="submit" disabled={!matricule.trim() || isFetching}>
              {isLoading || isFetching ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Search className="w-4 h-4 mr-1.5" />
              )}
              Rechercher
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* === États === */}
      {!submitted ? (
        <EmptyCard
          icon={<UserRound className="w-8 h-8 mx-auto mb-3 text-primary/50" />}
          title="Saisissez le matricule de votre enfant"
          text="Le matricule figure sur les documents scolaires (relevé, bulletin, certificat)."
        />
      ) : isLoading || isFetching ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm">Recherche de l&apos;élève…</p>
          </CardContent>
        </Card>
      ) : error || !data ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-8 text-center">
            <p className="text-sm font-medium text-destructive">
              {(error as Error)?.message ||
                "Élève introuvable — vérifiez le matricule."}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Contactez l&apos;école en cas de doute sur le matricule.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ParentPortalResults info={data} onOpenDoc={openDoc} />
      )}
    </div>
  );
}

function ParentPortalResults({
  info,
  onOpenDoc,
}: {
  info: ParentStudentInfo;
  onOpenDoc: (path: string, params: Record<string, string>) => void;
}) {
  const st = info.student;
  // Sessions avec résultats (les bulletins de période) — triées de la plus
  // récente à la plus ancienne (ordre déjà DESC côté API).
  const sessions = info.sessions ?? [];
  const [sessionId, setSessionId] = useState<string | undefined>(
    sessions[0]?.id,
  );
  // Année de fin d'année — défaut : année système.
  const [year, setYear] = useState<string>(
    String(info.system_year ?? new Date().getFullYear()),
  );

  return (
    <>
      {/* === Carte élève === */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold">{st.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {info.class.name} · {info.school.name}
                  {info.iep?.name ? ` · IEP ${info.iep.name}` : ""}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {st.matricule}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* === Deux familles de bulletins (Résultats / Bulletins) === */}
      <Tabs defaultValue="end-of-year" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="end-of-year" className="gap-1.5 text-xs">
            <CalendarDays className="w-3.5 h-3.5" />
            Fin d&apos;année
          </TabsTrigger>
          <TabsTrigger value="period" className="gap-1.5 text-xs">
            <FileText className="w-3.5 h-3.5" />
            Périodes
          </TabsTrigger>
        </TabsList>

        {/* --- Bulletin individuel de FIN D'ANNÉE (module Résultats) --- */}
        <TabsContent value="end-of-year" className="space-y-3">
          <Card className="border-border/60">
            <CardContent className="py-4 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5 min-w-[140px]">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Année de référence
                  </Label>
                  <Select value={year} onValueChange={setYear}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(info.years ?? []).map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="shadow-sm"
                  onClick={() =>
                    onOpenDoc("/bulletin-fin-annee", {
                      matricule: st.matricule,
                      year,
                    })
                  }
                >
                  <Printer className="w-4 h-4 mr-1.5" />
                  Consulter &amp; imprimer le bulletin
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Bulletin individuel « Résultats de fin d&apos;année » —
                moyennes (compositions, composition de passage, annuelle),
                rang dans la classe, décision du conseil des maîtres, signatures.
                Bulletin UNIQUE au format B5 (un seul exemplaire).
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Bulletins individuels de PÉRIODE (module Bulletins) --- */}
        <TabsContent value="period" className="space-y-3">
          <Card className="border-border/60">
            <CardContent className="py-4 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5 min-w-[260px] flex-1 max-w-[420px]">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Session d&apos;évaluation
                  </Label>
                  <Select
                    value={sessionId ?? ""}
                    onValueChange={setSessionId}
                    disabled={sessions.length === 0}
                  >
                    <SelectTrigger className="w-full overflow-hidden">
                      <SelectValue
                        placeholder={
                          sessions.length === 0
                            ? "Aucune session disponible"
                            : "Choisir une session…"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent className="max-h-56">
                      {sessions.map((s) => {
                        const c =
                          SESSION_STATUS_CONFIG[
                            s.status as keyof typeof SESSION_STATUS_CONFIG
                          ];
                        return (
                          <SelectItem key={s.id} value={s.id}>
                            {monthLabel(s.month)} {s.year} —{" "}
                            {evalTypeShort(s.eval_type)} N°{s.eval_number}
                            {c ? ` (${c.label})` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="shadow-sm"
                  disabled={!sessionId}
                  onClick={() =>
                    onOpenDoc("/bulletins", {
                      matricule: st.matricule,
                      session_id: sessionId!,
                    })
                  }
                >
                  <Printer className="w-4 h-4 mr-1.5" />
                  Consulter &amp; imprimer le bulletin
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Bulletin individuel de période (modèle officiel B5) — notes par
                matière, moyenne, rang, appréciation et visas. Bulletin UNIQUE
                (un seul exemplaire).
              </p>
              {sessions.length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Aucune session d&apos;évaluation n&apos;est encore disponible
                  pour l&apos;école de votre enfant.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Rappel des droits */}
      <Card className="border-border/60">
        <CardContent className="py-3 flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            En tant que <strong>parent</strong>, vous pouvez consulter et
            imprimer le bulletin individuel de votre enfant. Les autres
            documents officiels (tableaux de classe, synthèses, relevés)
            sont réservés à l&apos;administration.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function EmptyCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <Card className="border-dashed border-primary/30 bg-primary/5">
      <CardContent className="py-12 text-center">
        {icon}
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{text}</p>
      </CardContent>
    </Card>
  );
}
