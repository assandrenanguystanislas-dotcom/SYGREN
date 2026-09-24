"use client";

import { useState } from "react";
import { ArrowLeftRight, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EntityCombobox, type ComboItem } from "@/components/entity-combobox";
import type { TransferPerson } from "@/components/school-transfer-dialog";

/**
 * Changement d'école (Task 53) — LA « PLAGE » demandée : une zone dédiée
 * en tête des modules Utilisateurs (adjoints, directeurs) et Élèves dans
 * laquelle on déclare le changement d'établissement d'un enseignant ou
 * d'un élève.
 *
 * On choisit la personne dans la bande déroulante (recherche par nom,
 * par école actuelle) puis « Changer d'école » ouvre le dialogue guidé
 * de transfert (school-transfer-dialog.tsx). Les listes proposent le
 * périmètre déjà autorisé par le backend (RBAC) : aucune action hors
 * périmètre n'est donc proposée.
 */
export function SchoolTransferSection({
  persons,
  entityLabel,
  onTransfer,
  emptyHint,
}: {
  /** Personnes transférables (déjà filtrées selon le rôle connecté). */
  persons: TransferPerson[];
  /** Libellé du sélecteur, ex : « un adjoint(e) au directeur ». */
  entityLabel: string;
  /** Ouvre le dialogue de transfert avec la personne choisie. */
  onTransfer: (person: TransferPerson) => void;
  /** Affiché quand la liste est vide (ex : « sélectionnez d'abord une école »). */
  emptyHint?: string;
}) {
  const [pickedId, setPickedId] = useState("");

  const items: ComboItem[] = persons.map((p) => ({
    value: p.id,
    label: p.name,
    // La saisie retrouve aussi la personne par son école actuelle.
    keywords: p.currentSchoolName ?? "",
    right: (
      <span className="truncate max-w-[45%] text-[10px] text-muted-foreground shrink-0">
        {p.currentSchoolName ?? "—"}
      </span>
    ),
  }));

  const picked = persons.find((p) => p.id === pickedId) ?? null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowLeftRight className="w-5 h-5 text-primary" aria-hidden />
          Changement d&apos;école
        </CardTitle>
        <CardDescription>
          L&apos;enseignant ou l&apos;élève a changé d&apos;établissement ?
          Sélectionnez-le puis transférez son dossier vers sa nouvelle école —
          son compte, son dossier et son historique sont conservés.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <EntityCombobox
            items={items}
            value={pickedId}
            onChange={setPickedId}
            placeholder={`Choisir ${entityLabel}…`}
            searchPlaceholder="Nom ou école actuelle…"
            emptyText="Aucun résultat."
            groupLabel={`Personnes transférables (${persons.length})`}
            icon={
              <ArrowLeftRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            }
            className="w-full sm:max-w-md"
          />
          <Button
            size="sm"
            className="shrink-0"
            disabled={!picked}
            onClick={() => {
              if (picked) {
                onTransfer(picked);
                setPickedId("");
              }
            }}
          >
            <ArrowLeftRight className="w-4 h-4 mr-1.5" />
            Changer d&apos;école
          </Button>
        </div>
        {persons.length === 0 ? (
          emptyHint ? (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
              {emptyHint}
            </p>
          ) : null
        ) : (
          <p className="text-xs text-muted-foreground">
            {persons.length} personne{persons.length > 1 ? "s" : ""}{" "}
            transférable{persons.length > 1 ? "s" : ""} dans votre périmètre.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
