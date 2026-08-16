"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plus, Search, Loader2 } from "lucide-react";

import { subjectsApi } from "@/lib/api";
import type { Subject } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function SubjectsView() {
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["subjects"],
    queryFn: subjectsApi.list,
  });

  const subjects: Subject[] = data?.subjects ?? [];
  const filtered = subjects.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (isLoading) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">Chargement des matières depuis le backend Go…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-destructive font-medium">
            Impossible de charger les matières
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Vérifiez que le backend Go (port 8080) est en cours d'exécution.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* En-tête + recherche */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <BookOpen className="w-4 h-4" />
              </div>
              <div>
                <CardTitle className="text-base">Matières</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {subjects.length} matière(s) configurée(s) · coefficient par
                  défaut = 1
                </p>
              </div>
            </div>
            <Button size="sm" className="shadow-sm" disabled>
              <Plus className="w-4 h-4 mr-1.5" />
              Nouvelle matière
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une matière…"
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Grille des matières */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((subject, i) => (
          <Card
            key={subject.id}
            className="border-border/60 hover:shadow-md hover:border-primary/30 transition-all animate-in-up"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <CardContent className="py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-sm">
                  {subject.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-sm">{subject.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Créée le{" "}
                    {new Date(subject.created_at).toLocaleDateString("fr-FR")}
                  </p>
                </div>
              </div>
              <Badge variant="secondary" className="font-mono">
                coef. {subject.coefficient}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Aucune matière trouvée</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
