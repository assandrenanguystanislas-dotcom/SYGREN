"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { TrendingUp, TrendingDown, Award, Minus } from "lucide-react";

import { computationApi } from "@/lib/api";
import { monthLabel } from "@/lib/session-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

interface StudentAnnualCardProps {
  studentId: string;
  studentName: string;
  classLevel?: string;
  averageScale?: number;
}

const COLORS = {
  primary: "#f77f00", // orange
  secondary: "oklch(0.7 0.15 200)", // bleu
  success: "#009e60", // vert
  danger: "oklch(0.577 0.245 27.325)", // rouge
};

const chartConfig = {
  student: { label: "Élève", color: COLORS.primary },
  class: { label: "Classe", color: COLORS.secondary },
} satisfies ChartConfig;

export function StudentAnnualCard({
  studentId,
  studentName,
  classLevel,
  averageScale = 20,
}: StudentAnnualCardProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["annual", studentId],
    queryFn: () => computationApi.getStudentAnnual(studentId, 2026),
    enabled: !!studentId,
  });

  if (isLoading) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-6 text-center text-muted-foreground">
          <p className="text-sm">Calcul du bilan annuel…</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-muted-foreground">
          <p className="text-sm">Bilan annuel non disponible</p>
          <p className="text-xs mt-1">{(error as Error)?.message}</p>
        </CardContent>
      </Card>
    );
  }

  // Préparer les données pour le line chart
  const chartData = data.sessions
    .filter((s) => s.has_average)
    .map((s) => ({
      name: monthLabel(s.month),
      full: `${monthLabel(s.month)} ${s.year}`,
      eleve: s.average,
      rang: s.rank,
      mention: s.mention,
    }));

  const scale = averageScale;
  const passThreshold = scale / 2;

  // Tendance
  const avgs = chartData.map((d) => d.eleve);
  const trend =
    avgs.length >= 2
      ? avgs[avgs.length - 1] - avgs[0]
      : 0;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Bilan annuel — {studentName}
          </span>
          {data.has_annual && (
            <Badge variant="outline" className="text-xs">
              {data.session_count} session(s)
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats principales */}
        {data.has_annual ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Moyenne annuelle */}
            <div className="text-center p-2 rounded-lg bg-muted/40">
              <p className="text-[10px] text-muted-foreground uppercase">Moyenne annuelle</p>
              <p className="text-lg font-bold" style={{ color: COLORS.primary }}>
                {data.annual_average.toFixed(2)}/{scale}
              </p>
            </div>
            {/* Mention */}
            <div className="text-center p-2 rounded-lg bg-muted/40">
              <p className="text-[10px] text-muted-foreground uppercase">Mention</p>
              <p className="text-sm font-semibold">{data.mention}</p>
            </div>
            {/* Tendance */}
            <div className="text-center p-2 rounded-lg bg-muted/40">
              <p className="text-[10px] text-muted-foreground uppercase">Tendance</p>
              <div className="flex items-center justify-center gap-1">
                {trend > 0.5 ? (
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                ) : trend < -0.5 ? (
                  <TrendingDown className="w-4 h-4 text-red-600" />
                ) : (
                  <Minus className="w-4 h-4 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "text-sm font-semibold",
                    trend > 0.5
                      ? "text-emerald-600"
                      : trend < -0.5
                        ? "text-red-600"
                        : "text-muted-foreground"
                  )}
                >
                  {trend > 0 ? "+" : ""}{trend.toFixed(2)}
                </span>
              </div>
            </div>
            {/* Statut */}
            <div className="text-center p-2 rounded-lg bg-muted/40">
              <p className="text-[10px] text-muted-foreground uppercase">Statut</p>
              <div className="flex items-center justify-center">
                {data.annual_average >= passThreshold ? (
                  <Award className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Award className="w-4 h-4 text-amber-600" />
                )}
                <span className="text-sm font-semibold ml-1">
                  {data.annual_average >= passThreshold ? "Réussi" : "Insuffisant"}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucune moyenne annuelle disponible (pas assez de sessions)
          </p>
        )}

        {/* Line chart : évolution des moyennes */}
        {chartData.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Évolution des moyennes
            </p>
            <ChartContainer config={chartConfig} className="h-[200px]">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} className="text-[10px]" />
                <YAxis domain={[0, scale]} tickLine={false} axisLine={false} className="text-[10px]" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="eleve"
                  stroke={COLORS.primary}
                  strokeWidth={2}
                  dot={{ fill: COLORS.primary, r: 4 }}
                  name="Moyenne élève"
                />
              </LineChart>
            </ChartContainer>
          </div>
        )}

        {/* Détail par session */}
        {data.sessions.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Détail par session
            </p>
            <div className="space-y-1">
              {data.sessions.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs py-1.5 px-2 rounded-md hover:bg-muted/40"
                >
                  <span className="text-muted-foreground">
                    {monthLabel(s.month)} {s.year}
                  </span>
                  <div className="flex items-center gap-3">
                    {s.has_average ? (
                      <>
                        <span
                          className={cn(
                            "font-mono font-semibold",
                            s.average >= passThreshold
                              ? "text-emerald-600"
                              : "text-amber-600"
                          )}
                        >
                          {s.average.toFixed(2)}/{scale}
                        </span>
                        {s.rank > 0 && (
                          <span className="text-muted-foreground">
                            #{s.rank}
                          </span>
                        )}
                        <span className="text-muted-foreground">{s.mention}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">Non évalué</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
