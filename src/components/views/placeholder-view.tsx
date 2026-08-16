"use client";

import { Construction, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PlaceholderViewProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  phase?: string;
}

export function PlaceholderView({
  title,
  description,
  icon: Icon = Construction,
  phase = "Phase à venir",
}: PlaceholderViewProps) {
  return (
    <div className="space-y-4">
      <Card className="border-dashed border-primary/30 bg-primary/[0.02]">
        <CardContent className="py-14 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary mb-3">
            <Icon className="w-7 h-7" />
          </div>
          <Badge variant="secondary" className="mb-2">
            {phase}
          </Badge>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground max-w-md mt-1 leading-relaxed">
            {description}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
