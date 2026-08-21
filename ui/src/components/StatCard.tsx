interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: "emerald" | "rose" | "amber" | "blue" | "slate" | "violet";
}

const accents: Record<NonNullable<StatCardProps["accent"]>, string> = {
  emerald: "text-emerald-400",
  rose: "text-rose-400",
  amber: "text-amber-400",
  blue: "text-blue-400",
  violet: "text-violet-400",
  slate: "text-slate-300",
};

export function StatCard({ label, value, sub, accent = "slate" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accents[accent]}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}
