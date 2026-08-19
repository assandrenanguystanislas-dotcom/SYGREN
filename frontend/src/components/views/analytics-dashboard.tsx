"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  BarChart3,
  Building2,
  Calendar,
  GraduationCap,
  Loader2,
  PieChart as PieChartIcon,
  School as SchoolIcon,
  TrendingUp,
  TrendingDown,
  Users,
  Award,
  Target,
  CheckCircle2,
  Clock,
} from "lucide-react";

import { dashboardApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { DashboardData, EntityPerformance, YearComparison } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// Couleurs pour les graphiques (charte Côte d'Ivoire : orange + vert + neutres)
const COLORS = {
  primary: "oklch(0.646 0.222 41.116)", // orange
  success: "oklch(0.548 0.154 150)", // vert
  warning: "oklch(0.828 0.189 84.429)", // ambre
  danger: "oklch(0.577 0.245 27.325)", // rouge
  blue: "oklch(0.7 0.15 200)",
  purple: "oklch(0.65 0.2 300)",
  pink: "oklch(0.75 0.18 0)",
  slate: "oklch(0.7 0.02 95)",
};

// Couleurs pour les mentions (par ordre d'excellence)
const MENTION_COLORS = [
  COLORS.success,    // Très Bien
  "oklch(0.6 0.15 140)", // Bien
  "oklch(0.75 0.15 100)", // Assez Bien
  COLORS.warning,    // Passable
  "oklch(0.7 0.15 60)", // Faible
  COLORS.danger,     // Insuffisant
  "oklch(0.55 0.2 350)", // Très Insuffisant
];

const SCOPE_LABELS: Record<string, string> = {
  global: "Vue globale SYGREN",
  iep: "Circonscription (IEP)",
  school: "Établissement",
  class: "Ma classe",
};

export function AnalyticsDashboard() {
  const user = useAuthStore((s) => s.user);
  const [yearFilter, setYearFilter] = useState("2026");
  const [genderFilter, setGenderFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", yearFilter, genderFilter, levelFilter],
    queryFn: () =>
      dashboardApi.get({
        year: yearFilter,
        gender: genderFilter || undefined,
        level: levelFilter || undefined,
      }),
  });

  if (isLoading) return <LoadingState />;
  if (error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-destructive font-medium">
            Impossible de charger le tableau de bord
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {(error as Error).message}
          </p>
        </CardContent>
      </Card>
    );

  if (!data) return null;

  const entityLabel =
    data.scope === "global" || data.scope === "iep" ? "Écoles" : "Classes";
  const entities = data.schools ?? data.classes ?? [];

  return (
    <div className="space-y-4">
      {/* Bandeau d'en-tête avec scope */}
      <Card className="relative overflow-hidden border-border/60">
        <div className="absolute inset-x-0 top-0 h-1 ci-flag-stripe" />
        <CardContent className="pt-6 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-lg">{data.scope_name}</h2>
                <p className="text-xs text-muted-foreground">
                  Tableau de bord analytique · {SCOPE_LABELS[data.scope]}
                </p>
              </div>
            </div>
            <Badge variant="secondary" className="capitalize">
              {SCOPE_LABELS[data.scope]}
            </Badge>
          </div>

          {/* Filtres : Année + Sexe + Niveau */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Année :</span>
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger className="h-7 w-[90px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2024">2024</SelectItem>
                  <SelectItem value="2025">2025</SelectItem>
                  <SelectItem value="2026">2026</SelectItem>
                  <SelectItem value="2027">2027</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-xs font-medium text-muted-foreground">Sexe :</span>
              <FilterChip label="Tous" active={genderFilter === ""} onClick={() => setGenderFilter("")} />
              <FilterChip label="G" active={genderFilter === "M"} onClick={() => setGenderFilter("M")} />
              <FilterChip label="F" active={genderFilter === "F"} onClick={() => setGenderFilter("F")} />
            </div>

            <div className="flex items-center gap-1">
              <span className="text-xs font-medium text-muted-foreground">Niveau :</span>
              <FilterChip label="Tous" active={levelFilter === ""} onClick={() => setLevelFilter("")} />
              <FilterChip label="CP" active={levelFilter === "CP"} onClick={() => setLevelFilter("CP")} />
              <FilterChip label="CE" active={levelFilter === "CE"} onClick={() => setLevelFilter("CE")} />
              <FilterChip label="CM" active={levelFilter === "CM"} onClick={() => setLevelFilter("CM")} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs principaux */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {(data.scope === "global" || data.scope === "iep") && (
          <KpiCard
            label="Écoles"
            value={data.school_count ?? 0}
            icon={<SchoolIcon className="w-4 h-4" />}
            tone="primary"
          />
        )}
        <KpiCard
          label="Classes"
          value={data.class_count}
          icon={<Building2 className="w-4 h-4" />}
          tone="success"
        />
        <KpiCard
          label="Élèves"
          value={data.student_count}
          icon={<Users className="w-4 h-4" />}
          tone="primary"
        />
        <KpiCard
          label="Enseignants"
          value={data.teacher_count}
          icon={<GraduationCap className="w-4 h-4" />}
          tone="success"
        />
        <KpiCard
          label="Performance"
          value={data.avg_performance > 0 ? data.avg_performance.toFixed(2) : "—"}
          hint="/ 20"
          icon={<TrendingUp className="w-4 h-4" />}
          tone="primary"
        />
        <KpiCard
          label="Taux réussite"
          value={`${data.pass_rate.toFixed(0)}%`}
          hint="≥ 10/20"
          icon={<Award className="w-4 h-4" />}
          tone="success"
        />
      </div>

      {/* Comparaison inter-annuelle */}
      {data.year_comparison && (
        <YearComparisonCard data={data.year_comparison} />
      )}

      {/* Jauges de complétion (cahier des charges §3 Module 5) */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Jauges de complétion des saisies
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Gauge
            label="Taux de complétion global"
            value={data.completion_rate}
            hint={`${data.session_stats.closed + data.session_stats.validated} / ${data.session_stats.total} sessions clôturées`}
            color="primary"
          />
          <div className="grid gap-3 sm:grid-cols-4 pt-2">
            <SessionStatusCard
              label="Brouillon"
              count={data.session_stats.draft}
              total={data.session_stats.total}
              icon={<Clock className="w-4 h-4" />}
              color="slate"
            />
            <SessionStatusCard
              label="Saisie ouverte"
              count={data.session_stats.open}
              total={data.session_stats.total}
              icon={<Activity className="w-4 h-4" />}
              color="warning"
            />
            <SessionStatusCard
              label="Saisie fermée"
              count={data.session_stats.closed}
              total={data.session_stats.total}
              icon={<Clock className="w-4 h-4" />}
              color="primary"
            />
            <SessionStatusCard
              label="Validées"
              count={data.session_stats.validated}
              total={data.session_stats.total}
              icon={<CheckCircle2 className="w-4 h-4" />}
              color="success"
            />
          </div>
        </CardContent>
      </Card>

      {/* Graphiques en grille */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Tendance mensuelle */}
        {data.monthly_trend.length > 0 && (
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Tendance mensuelle
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Évolution de la moyenne et du taux de complétion
              </p>
            </CardHeader>
            <CardContent>
              <TrendChart trend={data.monthly_trend} />
            </CardContent>
          </Card>
        )}

        {/* Distribution des mentions */}
        {data.mentions.labels.length > 0 && (
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <PieChartIcon className="w-4 h-4 text-primary" />
                Distribution des mentions
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Répartition des élèves par mention
              </p>
            </CardHeader>
            <CardContent>
              <MentionsChart mentions={data.mentions} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Comparatif multi-entités (écoles ou classes) */}
      {entities.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Comparatif {entityLabel.toLowerCase()}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Performance moyenne et taux de complétion par {entityLabel.toLowerCase().slice(0, -1)}
            </p>
          </CardHeader>
          <CardContent>
            <EntitiesChart entities={entities} />
          </CardContent>
        </Card>
      )}

      {/* Détail par entité (tableau récapitulatif) */}
      {entities.length > 0 && (
        <Card className="border-border/60 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Détail par {entityLabel.toLowerCase().slice(0, -1)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto scroll-sygren">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left p-3 font-medium text-muted-foreground">
                      Nom
                    </th>
                    <th className="text-center p-3 font-medium text-muted-foreground">
                      Classes
                    </th>
                    <th className="text-center p-3 font-medium text-muted-foreground">
                      Élèves
                    </th>
                    <th className="text-center p-3 font-medium text-muted-foreground">
                      Sessions
                    </th>
                    <th className="text-center p-3 font-medium text-muted-foreground">
                      Complétion
                    </th>
                    <th className="text-center p-3 font-medium text-muted-foreground">
                      Performance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entities.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="p-3 font-medium">{e.name}</td>
                      {data.scope !== "school" && (
                        <td className="text-center p-3 text-muted-foreground">
                          {e.class_count ?? "—"}
                        </td>
                      )}
                      <td className="text-center p-3">{e.student_count}</td>
                      <td className="text-center p-3">{e.session_count}</td>
                      <td className="text-center p-3">
                        <span
                          className={cn(
                            "inline-block px-2 py-0.5 rounded text-xs font-medium",
                            e.completion_rate >= 75
                              ? "bg-emerald-100 text-emerald-700"
                              : e.completion_rate >= 50
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-600",
                          )}
                        >
                          {e.completion_rate.toFixed(0)}%
                        </span>
                      </td>
                      <td className="text-center p-3">
                        <span
                          className={cn(
                            "font-bold",
                            e.avg_performance >= 10
                              ? "text-emerald-600"
                              : "text-amber-600",
                          )}
                        >
                          {e.avg_performance > 0
                            ? e.avg_performance.toFixed(2)
                            : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// === Composant KPI ===
function KpiCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: React.ReactNode;
  tone: "primary" | "success";
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="py-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
          <span className={tone === "primary" ? "text-primary" : "text-[var(--success)]"}>
            {icon}
          </span>
        </div>
        <p className="text-xl font-bold">
          {value}
          {hint && (
            <span className="text-xs text-muted-foreground ml-1">{hint}</span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

// === Jauge de complétion ===
function Gauge({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: number;
  hint?: string;
  color: "primary" | "success";
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-bold text-base">
          {value.toFixed(0)}%
        </span>
      </div>
      <Progress
        value={value}
        className={cn("h-3", color === "success" && "[&>div]:bg-[var(--success)]")}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// === Carte statut session ===
function SessionStatusCard({
  label,
  count,
  total,
  icon,
  color,
}: {
  label: string;
  count: number;
  total: number;
  icon: React.ReactNode;
  color: "slate" | "warning" | "primary" | "success";
}) {
  const colorClass = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    primary: "border-orange-200 bg-orange-50 text-orange-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  }[color];

  return (
    <div className={cn("rounded-lg border p-3 text-center", colorClass)}>
      <div className="flex items-center justify-center mb-1">{icon}</div>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-[11px] font-medium mt-0.5">{label}</p>
      <p className="text-[10px] opacity-70">
        sur {total}
      </p>
    </div>
  );
}

// === Graphique tendance mensuelle (LineChart) ===
function TrendChart({ trend }: { trend: DashboardData["monthly_trend"] }) {
  const data = trend.map((t) => ({
    label: t.label,
    performance: Number(t.avg_performance.toFixed(2)),
    completion: Number(t.completion_rate.toFixed(0)),
  }));

  const config: ChartConfig = {
    performance: { label: "Performance", color: COLORS.primary },
    completion: { label: "Complétion %", color: COLORS.success },
  };

  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <LineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0 0)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          yAxisId="left"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          domain={[0, 20]}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          domain={[0, 100]}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="performance"
          stroke={COLORS.primary}
          strokeWidth={2.5}
          dot={{ fill: COLORS.primary, r: 4 }}
          name="Performance"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="completion"
          stroke={COLORS.success}
          strokeWidth={2.5}
          strokeDasharray="5 5"
          dot={{ fill: COLORS.success, r: 4 }}
          name="Complétion %"
        />
      </LineChart>
    </ChartContainer>
  );
}

// === Graphique mentions (PieChart) ===
function MentionsChart({ mentions }: { mentions: DashboardData["mentions"] }) {
  const data = mentions.labels.map((label, i) => ({
    name: label,
    value: mentions.values[i],
    color: MENTION_COLORS[i] ?? COLORS.slate,
  }));

  const config: ChartConfig = Object.fromEntries(
    mentions.labels.map((label, i) => [
      label,
      { label, color: MENTION_COLORS[i] ?? COLORS.slate },
    ]),
  );

  const total = mentions.values.reduce((a, b) => a + b, 0);

  return (
    <div className="flex items-center gap-4">
      <ChartContainer config={config} className="h-[180px] w-[180px] shrink-0">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={45}
            outerRadius={75}
            paddingAngle={2}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="flex-1 space-y-1.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span
              className="w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: d.color }}
            />
            <span className="flex-1 truncate">{d.name}</span>
            <span className="font-semibold">{d.value}</span>
            <span className="text-muted-foreground">
              ({total > 0 ? ((d.value / total) * 100).toFixed(0) : 0}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// === Graphique comparatif entités (BarChart) ===
function EntitiesChart({ entities }: { entities: EntityPerformance[] }) {
  const data = entities.map((e) => ({
    name: e.name.length > 15 ? e.name.slice(0, 13) + "…" : e.name,
    fullName: e.name,
    performance: Number(e.avg_performance.toFixed(2)),
    completion: Number(e.completion_rate.toFixed(0)),
  }));

  const config: ChartConfig = {
    performance: { label: "Performance", color: COLORS.primary },
  };

  return (
    <ChartContainer config={config} className="h-[240px] w-full">
      <BarChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0 0)" />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          domain={[0, 20]}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent />
          }
        />
        <Bar
          dataKey="performance"
          fill={COLORS.primary}
          radius={[4, 4, 0, 0]}
          name="Performance"
        />
      </BarChart>
    </ChartContainer>
  );
}

function LoadingState() {
  return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm">Calcul des indicateurs de performance…</p>
      </CardContent>
    </Card>
  );
}

// Filtre chip (bouton toggle)
function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center h-7 px-2.5 rounded-md border text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

// Carte comparaison inter-annuelle
function YearComparisonCard({ data }: { data: YearComparison }) {
  const perfUp = data.perf_delta >= 0;
  const passUp = data.pass_delta >= 0;

  const chartData = [
    { name: String(data.previous_year), perf: data.previous_perf, pass: data.previous_pass_rate },
    { name: String(data.current_year), perf: data.current_perf, pass: data.current_pass_rate },
  ];

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Comparaison {data.previous_year} vs {data.current_year}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Performance moyenne</p>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold">{data.current_perf.toFixed(2)}</span>
              <span className={`text-xs flex items-center gap-0.5 ${perfUp ? "text-emerald-600" : "text-red-600"}`}>
                {perfUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {perfUp ? "+" : ""}{data.perf_delta.toFixed(2)}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {data.previous_year}: {data.previous_perf.toFixed(2)} → {data.current_year}: {data.current_perf.toFixed(2)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Taux de réussite</p>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold">{data.current_pass_rate.toFixed(1)}%</span>
              <span className={`text-xs flex items-center gap-0.5 ${passUp ? "text-emerald-600" : "text-red-600"}`}>
                {passUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {passUp ? "+" : ""}{data.pass_delta.toFixed(1)}pts
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {data.previous_year}: {data.previous_pass_rate.toFixed(1)}% → {data.current_year}: {data.current_pass_rate.toFixed(1)}%
            </p>
          </div>
        </div>
        <ChartContainer config={{ perf: { label: "Performance" }, pass: { label: "Réussite %" } }} className="h-[150px]">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="perf" fill={COLORS.primary} radius={[4, 4, 0, 0]} name="Performance" />
            <Bar dataKey="pass" fill={COLORS.success} radius={[4, 4, 0, 0]} name="Réussite %" />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
