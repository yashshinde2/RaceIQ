import { Link } from "@tanstack/react-router";
import type { Posture } from "@/lib/raceiq/contracts";
import { EMPTY, fmtPct, fmtSeconds, isNum, pctWidth } from "@/lib/raceiq/format";
import { useRaceIQ } from "@/lib/raceiq/store";
import { ProvenanceTag } from "./ProvenanceTag";

export const POSTURE_STYLE: Record<Posture, string> = {
  ATTACK: "text-attack border-attack/50 bg-attack/10",
  HOLD: "text-hold border-hold/50 bg-hold/10",
  DEFEND: "text-defend border-defend/50 bg-defend/10",
  HARVEST: "text-harvest border-harvest/50 bg-harvest/10",
};

export function MatchupCard() {
  const {
    selected,
    tacticalTarget,
    tacticalRole = "AHEAD",
    driver: driverOf,
    stateOf,
    recommendationFor,
  } = useRaceIQ();

  const a = stateOf(selected);
  const b = tacticalTarget;
  const da = driverOf(selected);
  const db = b ? driverOf(b.code) : undefined;
  const rec = recommendationFor(selected);

  const socDelta =
    isNum(a?.soc) && isNum(b?.soc) ? Math.round(((a?.soc ?? 0) - (b?.soc ?? 0)) * 100) : undefined;
  const gap =
    isNum(a?.gapToLeader) && isNum(b?.gapToLeader)
      ? Math.abs((a?.gapToLeader ?? 0) - (b?.gapToLeader ?? 0))
      : undefined;

  const gapFormatted = isNum(gap) ? `+${gap.toFixed(1)}s` : EMPTY;
  const relationText = b ? `${tacticalRole} · ${gapFormatted}` : "NO RIVAL ENGAGED";

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Tactical target</p>
        <ProvenanceTag kind="INFERRED" />
      </div>

      {b && db ? (
        <>
          {/* TACTICAL TARGET HEADLINE BANNER */}
          <div className="mt-2.5 flex items-center justify-between rounded border border-border bg-surface-raised px-3 py-2">
            <div className="flex items-center gap-2.5">
              <span className="data grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-xs font-semibold">
                P{b.position}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="h-3.5 w-[3px] rounded-sm" style={{ backgroundColor: db.color }} />
                  <span className="data text-sm font-bold">{b.code}</span>
                  <span className="truncate text-xs text-muted-foreground">{db.name ?? db.team}</span>
                </div>
                <span className="block text-[10px] text-muted-foreground">{db.team}</span>
              </div>
            </div>
            <div className="text-right">
              <span className="data inline-block rounded bg-muted/60 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-primary">
                {relationText}
              </span>
            </div>
          </div>

          {/* HEAD TO HEAD TELEMETRY COMPARISON */}
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="data grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border text-[11px]">
                {a?.position ?? EMPTY}
              </span>
              <span className="min-w-0">
                <span className="data block truncate text-xs font-semibold">{selected} (HAAS)</span>
                <span className="block truncate text-[10px] text-muted-foreground">{da.team}</span>
              </span>
            </div>
            <div className="text-center">
              <p className="eyebrow">ΔSoC</p>
              <p
                className={`data text-lg font-semibold ${(socDelta ?? 0) >= 0 ? "text-harvest" : "text-primary"}`}
              >
                {isNum(socDelta) ? `${socDelta >= 0 ? "+" : ""}${socDelta}%` : EMPTY}
              </p>
            </div>
            <div className="flex min-w-0 items-center justify-end gap-2 text-right">
              <span className="min-w-0">
                <span className="data block truncate text-xs font-semibold">{b.code}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{db.team}</span>
              </span>
              <span className="data grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border text-[11px]">
                {b.position ?? EMPTY}
              </span>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="h-full rounded-full"
                  style={{ width: `${pctWidth(a?.soc)}%`, backgroundColor: da.color }}
                />
              </span>
              <span className="data text-xs">{fmtPct(a?.soc)}</span>
            </div>
            <div className="text-center">
              <p className="eyebrow">Gap</p>
              <p className="data text-xs font-medium">{fmtSeconds(gap)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="data text-xs">{fmtPct(b.soc)}</span>
              <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="h-full rounded-full"
                  style={{ width: `${pctWidth(b.soc)}%`, backgroundColor: db.color }}
                />
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="mt-3 rounded border border-border/50 bg-surface-raised/40 p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No active non-Haas tactical opponent in immediate proximity.
          </p>
        </div>
      )}

      {/* RECOMMENDED CALL & WHY / WHAT-IF ACTION BUTTONS */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">RECOMMENDED</span>
          {rec ? (
            <span
              className={`data inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-bold tracking-[0.12em] ${POSTURE_STYLE[rec.posture]}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {rec.posture}
            </span>
          ) : (
            <span className="data inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs tracking-[0.12em] text-muted-foreground">
              NO CALL
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            to="/why"
            className="data rounded border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            WHY?
          </Link>
          <Link
            to="/what-if"
            className="data rounded border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
          >
            WHAT IF?
          </Link>
        </div>
      </div>
      {rec?.reason && <p className="mt-2 text-xs text-muted-foreground">{rec.reason}</p>}
    </div>
  );
}
