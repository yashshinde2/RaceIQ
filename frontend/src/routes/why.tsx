import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { POSTURE_STYLE } from "@/components/raceiq/MatchupCard";
import { ProvenanceTag } from "@/components/raceiq/ProvenanceTag";
import type { Posture } from "@/lib/raceiq/contracts";
import { EMPTY, fmtClock, fmtGap, fmtPct } from "@/lib/raceiq/format";
import { useRaceIQ } from "@/lib/raceiq/store";

export const Route = createFileRoute("/why")({
  head: () => ({
    meta: [
      { title: "Why — RaceIQ" },
      {
        name: "description",
        content:
          "Why did RaceIQ make this decision? Race situation, model assessment, one pass probability and the reasons behind the call.",
      },
      { property: "og:title", content: "Why — RaceIQ" },
      {
        property: "og:description",
        content: "A judge-facing explanation of the RaceIQ decision at this replay state.",
      },
    ],
  }),
  component: Why,
});

interface SituationCardProps {
  label: string;
  code: string;
  team: string;
  position: number | undefined;
  gap: string;
  tyre: string;
  dominant?: boolean;
}

function SituationCard({
  label,
  code,
  team,
  position,
  gap,
  tyre,
  dominant = false,
}: SituationCardProps) {
  return (
    <div
      className={`rounded border p-3 ${
        dominant ? "border-primary/70 bg-primary/10" : "border-border bg-surface-raised"
      }`}
    >
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={`text-xl font-bold ${dominant ? "text-primary" : "text-foreground"}`}>{code}</span>
        <span className="truncate text-xs text-muted-foreground">{team}</span>
      </div>
      <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
        {typeof position === "number" ? `P${position}` : EMPTY}
        {gap !== EMPTY ? ` · ${gap}` : ""}
        {tyre !== EMPTY ? ` · ${tyre}` : ""}
      </p>
    </div>
  );
}

type TagKind = "ACTUAL" | "INFERRED" | "APPROX" | "NOT_OBSERVED" | "MODEL";

const HMM_STATES = [
  "H|OT_avail",
  "H|OT_spent",
  "M|OT_avail",
  "M|OT_spent",
  "Lharvest|OT_avail",
  "Lharvest|OT_spent",
  "Lderate|OT_avail",
  "Lderate|OT_spent",
] as const;

type HmmTable = {
  "H|OT_avail": number;
  "H|OT_spent": number;
  "M|OT_avail": number;
  "M|OT_spent": number;
  "Lharvest|OT_avail": number;
  "Lharvest|OT_spent": number;
  "Lderate|OT_avail": number;
  "Lderate|OT_spent": number;
};

function dominantHmmState(b: HmmTable): string {
  let best: (typeof HMM_STATES)[number] = HMM_STATES[0];
  for (const k of HMM_STATES) {
    if (b[k] > b[best]) best = k;
  }
  return `${best} (${(b[best] * 100).toFixed(0)}%)`;
}

function Tag({ kind }: { kind: TagKind }) {
  const cls: Record<TagKind, string> = {
    ACTUAL: "border-actual/40 text-actual",
    INFERRED: "border-inferred/40 text-inferred",
    APPROX: "border-inferred/40 text-inferred",
    NOT_OBSERVED: "border-border text-muted-foreground",
    MODEL: "border-border text-foreground",
  };
  const label: Record<TagKind, string> = {
    ACTUAL: "ACTUAL",
    INFERRED: "INFERRED",
    APPROX: "APPROX",
    NOT_OBSERVED: "NOT OBSERVED",
    MODEL: "MODEL",
  };
  return (
    <span className={`shrink-0 rounded border px-1 py-px text-[8px] font-mono tracking-wider ${cls[kind]}`}>
      {label[kind]}
    </span>
  );
}

function CalcRow({ label, value, kind }: { label: string; value: string; kind: TagKind }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/60 py-1 last:border-b-0">
      <span className="min-w-0 truncate text-xs text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="data text-xs font-medium tabular-nums">{value}</span>
        <Tag kind={kind} />
      </span>
    </div>
  );
}

function tyreShort(
  d: { tyre?: { compound?: string | null; ageLaps?: number | null } | null | undefined } | undefined,
): string {
  if (!d?.tyre?.compound) return EMPTY;
  const c = d.tyre.compound.toUpperCase();
  const letter =
    ({ SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" } as Record<string, string>)[c] ??
    c.charAt(0);
  const age =
    typeof d.tyre.ageLaps === "number" ? `${Math.round(d.tyre.ageLaps)}L` : "";
  return age ? `${letter} ${age}` : letter;
}

function Why() {
  const {
    snapshot,
    selected,
    circuit,
    driver: driverOf,
    stateOf,
    recommendationFor,
    analysisSnapshot,
    aheadOf,
    behindOf,
    tacticalTarget,
    tacticalRole = "AHEAD",
  } = useRaceIQ();

  const [showCalc, setShowCalc] = useState(false);
  const [showHmmTable, setShowHmmTable] = useState(false);
  const state = stateOf(selected);
  const driver = driverOf(selected);
  const rec = recommendationFor(selected);
  const analysis = analysisSnapshot;
  const ahead = aheadOf(selected);
  const behind = behindOf(selected);
  const aheadDriver = ahead ? driverOf(ahead.code) : null;
  const behindDriver = behind ? driverOf(behind.code) : null;

  const posture: Posture = analysis?.overtakeEv?.recommendation ?? rec?.posture ?? "HOLD";
  const pPass = analysis?.passModel?.pPass ?? rec?.passProbability;
  const energy = analysis?.energy;
  const soc = energy?.soc ?? state?.soc;
  const opp = analysis?.opponentInference;
  const hmmBelief = opp?.hmmBelief;
  const passFeatures = analysis?.passModel?.features;
  const evBreakdown = analysis?.overtakeEv?.breakdown;
  const rivalCode = opp?.rivalCode ?? tacticalTarget?.code ?? ahead?.code ?? null;
  const targetCode = tacticalTarget?.code ?? rivalCode;

  const opponentSummary = !rivalCode
    ? "No rival directly in battle proximity — the opponent model is not engaged."
    : opp?.trapFlag
      ? `${rivalCode} is conserving aggressively; RaceIQ treats the next overtake window as risky.`
      : posture === "DEFEND"
        ? `${rivalCode} is attacking behind (${tacticalRole === "BEHIND" ? "defensive rival" : "rival"}). Hold position and line.`
        : `${rivalCode} is being tracked ahead. No trap signal: the opponent is racing normally.`;

  // 2-3 plain-language reasons, derived from internal model state. Raw model
  // probabilities stay internal to the engine and are never shown here.
  const reasons: string[] = [];
  if (state && state.position > 1 && targetCode && typeof state.gapAhead === "number" && posture !== "DEFEND") {
    reasons.push(
      state.gapAhead <= 1.0
        ? `Gap to ${targetCode} is inside the overtake window.`
        : `Gap to ${targetCode} is outside the overtake window.`,
    );
  }
  if (typeof soc === "number") {
    reasons.push(
      soc >= 0.45
        ? "Estimated battery is sufficient to support the move."
        : "Estimated battery is low — RaceIQ is prioritising recovery.",
    );
  }
  if (energy?.ersMode === "CLIPPING") {
    reasons.push("Power delivery is clipped on this lap — an overtake would not carry.");
  } else if (energy?.ersMode) {
    reasons.push("Power delivery is healthy — no clipping on the approach.");
  }
  if (opp) {
    reasons.push(
      opp.trapFlag
        ? "The opponent is conserving aggressively — a trap signal."
        : "No trap signal from the opponent.",
    );
  }
  if (typeof pPass === "number") {
    reasons.push(
      pPass >= 0.6
        ? "The estimated pass probability supports an attempt."
        : pPass >= 0.35
          ? "The estimated pass probability is marginal."
          : "The estimated pass probability is too low to justify spending energy.",
    );
  }
  if (
    posture === "DEFEND" &&
    state &&
    typeof state.gapToLeader === "number" &&
    behind &&
    typeof behind.gapToLeader === "number"
  ) {
    const gapBehind = Math.max(0, behind.gapToLeader - state.gapToLeader);
    if (gapBehind < 1.2) {
      reasons.unshift(
        `Car behind (${targetCode ?? behind.code}) is within ${fmtGap(gapBehind)} — hold the racing line.`,
      );
    }
  }
  const shownReasons = reasons.slice(0, 3);

  const gapAheadText =
    state?.position === 1 ? "LEADER" : ahead ? fmtGap(state?.gapAhead, 2) : EMPTY;
  const gapBehindText =
    behind && state && typeof behind.gapToLeader === "number" && typeof state.gapToLeader === "number"
      ? fmtGap(Math.max(0, behind.gapToLeader - state.gapToLeader), 2)
      : EMPTY;
  const pipeline = [
    "Observed race data",
    "Energy estimation",
    "Opponent inference",
    "Pass probability",
    "Strategic value",
    `DECISION — ${posture}`,
  ];

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 space-y-6">
      <header className="panel border border-border/80 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow tracking-wider text-muted-foreground font-semibold">
            WHY · RACEIQ DECISION EXPLAINED
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ProvenanceTag kind={snapshot.positionsProvenance} />
            <ProvenanceTag kind="INFERRED" />
            <span className="text-[11px] text-muted-foreground font-mono">
              {circuit.event} · LAP {snapshot.lap}/{snapshot.totalLaps} · {fmtClock(snapshot.time)}
            </span>
          </div>
        </div>
        <h1 className="mt-4 text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          WHY DID RACEIQ SAY <span className={POSTURE_STYLE[posture]}>{posture}</span>?
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The decision for <b className="text-foreground">{selected}</b> at this replay state, in
          plain language.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to="/"
            className="data rounded border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            ← Live
          </Link>
          <Link
            to="/what-if"
            className="data rounded border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
          >
            What if?
          </Link>
        </div>
      </header>
      {/* 1 — RACE SITUATION */}
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">1 · Race situation</p>
          <ProvenanceTag kind={snapshot.positionsProvenance} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <SituationCard
            label="Ahead"
            code={ahead?.code ?? "—"}
            team={aheadDriver?.team ?? (ahead?.code ? "" : "leader / no car")}
            position={ahead?.position}
            gap={gapAheadText}
            tyre={tyreShort(ahead)}
          />
          <SituationCard
            label="Selected"
            code={selected}
            team={driver.team ?? "—"}
            position={state?.position}
            gap={gapAheadText}
            tyre={tyreShort(state)}
            dominant
          />
          <SituationCard
            label="Behind"
            code={behind?.code ?? "—"}
            team={behindDriver?.team ?? (behind?.code ? "" : "last place / no car")}
            position={behind?.position}
            gap={gapBehindText}
            tyre={tyreShort(behind)}
          />
        </div>
      </section>

      {/* 2 — MODEL ASSESSMENT */}
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">2 · Model assessment</p>
          <ProvenanceTag kind="INFERRED" />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <dt className="text-[11px] text-muted-foreground">Estimated SoC</dt>
            <dd className="data text-sm font-medium">{fmtPct(soc)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">ERS state</dt>
            <dd className="data text-sm font-medium">{energy?.ersMode ?? EMPTY}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Clipping</dt>
            <dd className="data text-sm font-medium">
              {typeof energy?.isClipping === "boolean"
                ? energy.isClipping
                  ? "YES"
                  : "NO"
                : EMPTY}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Overtake window</dt>
            <dd className="data text-sm font-medium">
              {typeof state?.inDetectionWindow === "boolean"
                ? state.inDetectionWindow
                  ? "INSIDE"
                  : "OUTSIDE"
                : EMPTY}
            </dd>
          </div>
        </dl>
        <div className="mt-3 flex items-start gap-1.5 border-t border-border pt-2 text-xs text-muted-foreground">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
            Opponent
          </span>
          <span className="min-w-0">{opponentSummary}</span>
        </div>
      </section>

      {/* 3 — ONE PASS PROBABILITY */}
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">3 · Estimated pass probability</p>
          <ProvenanceTag kind="INFERRED" />
        </div>
        <p className="mt-3 text-3xl font-bold tabular-nums text-foreground">{fmtPct(pPass)}</p>
        <p className="text-[11px] text-muted-foreground">
          A single estimate from the RaceIQ heuristic model. RaceIQ does not claim a trained ML pass
          model; this value is a projection, not a guarantee.
        </p>
      </section>

      {/* 4 — DECISION */}
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">4 · RaceIQ decision</p>
          <ProvenanceTag kind="INFERRED" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`data inline-flex items-center gap-2 rounded border px-3 py-1.5 text-base font-bold tracking-[0.12em] ${POSTURE_STYLE[posture]}`}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            {posture}
          </span>
          {rec?.headline && <span className="text-sm text-muted-foreground">{rec.headline}</span>}
        </div>
      </section>

      {/* 5 — REASONS */}
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">5 · Why</p>
          <ProvenanceTag kind="INFERRED" />
        </div>
        {shownReasons.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2 text-sm text-foreground">
            {shownReasons.map((r) => (
              <li key={r} className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span className="min-w-0">{r}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No reasons available for this state.</p>
        )}
      </section>

      {/* 6 — PIPELINE */}
      <section className="panel p-4">
        <p className="eyebrow">6 · How the decision is built</p>
        <ol className="mt-3 flex flex-col gap-1.5 text-sm text-foreground">
          {pipeline.map((step, i) => (
            <li key={step} className="flex items-center gap-3">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-border bg-surface text-[10px] font-semibold text-muted-foreground">
                {i + 1}
              </span>
              <span className={i === 5 ? POSTURE_STYLE[posture] : "text-foreground"}>{step}</span>
              {i < pipeline.length - 1 && <span className="text-border">↓</span>}
            </li>
          ))}
        </ol>
      </section>
      {/* 7 - SHOW CALCULATION (progressive disclosure, collapsed by default) */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setShowCalc((v) => !v)}
          className="data rounded border border-border px-3 py-1.5 text-xs tracking-[0.12em] text-muted-foreground transition-colors hover:bg-accent"
        >
          {showCalc ? "HIDE CALCULATION" : "SHOW CALCULATION"}
        </button>
      </div>

      {showCalc && (
        <section className="panel border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">Calculation trail - this exact replay state</p>
            <ProvenanceTag kind="INFERRED" />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Every value below comes from the RaceIQ data prepared for this lap and driver. Nothing is recomputed in the browser.
          </p>

          {!analysis ? (
            <p className="mt-3 text-sm text-muted-foreground">Calculation data unavailable for this state.</p>
          ) : (
            <div className="mt-4 grid gap-x-6 gap-y-4 lg:grid-cols-2">
              {/* OBSERVED */}
              <div>
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground">OBSERVED</p>
                <div className="mt-2">
                  <CalcRow label="Race position" value={state?.position !== undefined ? `P${state.position}` : EMPTY} kind="ACTUAL" />
                  <CalcRow label="Gap ahead" value={state?.position === 1 ? "LEADER" : fmtGap(state?.gapAhead, 2)} kind="ACTUAL" />
                  <CalcRow label="Gap behind" value={gapBehindText !== EMPTY ? gapBehindText : EMPTY} kind="ACTUAL" />
                  <CalcRow label="Tyre" value={tyreShort(state)} kind="ACTUAL" />
                  <CalcRow label="Lap" value={`${snapshot.lap} / ${snapshot.totalLaps}`} kind="ACTUAL" />
                  <CalcRow
                    label="Detection window"
                    value={typeof state?.inDetectionWindow === "boolean" ? (state.inDetectionWindow ? "INSIDE" : "OUTSIDE") : EMPTY}
                    kind="ACTUAL"
                  />
                  <CalcRow label="Speed" value={analysis.telemetry.available && typeof analysis.telemetry.speed === "number" ? `${Math.round(analysis.telemetry.speed)} kph` : EMPTY} kind="ACTUAL" />
                  <CalcRow label="Throttle" value={analysis.telemetry.available && typeof analysis.telemetry.throttle === "number" ? `${Math.round(analysis.telemetry.throttle * 100)}%` : EMPTY} kind="ACTUAL" />
                  <CalcRow label="Brake" value={analysis.telemetry.available && typeof analysis.telemetry.brake === "number" ? (analysis.telemetry.brake > 0 ? "ON" : "OFF") : EMPTY} kind="ACTUAL" />
                </div>
              </div>

              {/* DERIVED */}
              <div>
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground">DERIVED (RACEIQ ESTIMATES)</p>
                <div className="mt-2">
                  <CalcRow label="Estimated SoC" value={fmtPct(energy?.soc ?? state?.soc)} kind="INFERRED" />
                  <CalcRow label="SoC trend" value={energy ? `${energy.socTrend >= 0 ? "+" : ""}${(energy.socTrend * 100).toFixed(1)} pt/lap` : EMPTY} kind="INFERRED" />
                  <CalcRow label="ERS state" value={energy?.ersMode ?? EMPTY} kind="INFERRED" />
                  <CalcRow label="Clipping" value={energy ? (energy.isClipping ? "DETECTED" : "none") : EMPTY} kind="INFERRED" />
                  <CalcRow
                    label="Closing speed"
                    value={passFeatures ? `${passFeatures.closing_speed_kph.toFixed(1)} kph` : EMPTY}
                    kind="APPROX"
                  />
                  <CalcRow
                    label="Straight remaining"
                    value={passFeatures ? `${Math.round(passFeatures.straight_remaining_m)} m` : EMPTY}
                    kind="APPROX"
                  />
                  <CalcRow
                    label="Tyre-age delta"
                    value={passFeatures ? `${passFeatures.tyre_age_delta_laps.toFixed(1)} laps` : EMPTY}
                    kind="INFERRED"
                  />
                </div>
                <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                  Closing speed is an analytical approximation from sampled speed, and straight remaining is a static circuit estimate - neither is measured telemetry. Overtake Mode is not directly observed.
                </p>
              </div>

              {/* OPPONENT INFERENCE */}
              <div>
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground">OPPONENT INFERENCE (8-STATE HMM)</p>
                <div className="mt-2">
                  <CalcRow
                    label="Dominant interpretation"
                    value={hmmBelief ? dominantHmmState(hmmBelief) : EMPTY}
                    kind="INFERRED"
                  />
                  <CalcRow label="Trap signal" value={opp?.trapFlag ? "YES - rival conserving" : "no"} kind="INFERRED" />
                  <CalcRow label="P(Overtake available)" value={hmmBelief ? fmtPct(hmmBelief.p_ot_avail) : EMPTY} kind="INFERRED" />
                  <CalcRow label="P(rival derated)" value={hmmBelief ? fmtPct(hmmBelief.p_Lderate ?? undefined) : EMPTY} kind="INFERRED" />
                  <CalcRow label="P(rival harvesting)" value={hmmBelief ? fmtPct(hmmBelief.p_Lharvest ?? undefined) : EMPTY} kind="INFERRED" />
                  <CalcRow label="Rival est. SoC" value={fmtPct(opp?.rivalSoc ?? undefined)} kind="INFERRED" />
                </div>
                {hmmBelief && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowHmmTable((v) => !v)}
                      className="mt-2 text-[10px] tracking-wider text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {showHmmTable ? "hide full 8-state table" : "show full 8-state table"}
                    </button>
                    {showHmmTable && (
                      <div className="mt-1 grid grid-cols-2 gap-x-4">
                        {HMM_STATES.map((k) => {
                          const val = hmmBelief[k];
                          return (
                            <div key={k} className="flex justify-between border-b border-border/50 py-0.5">
                              <span className="font-mono text-[10px] text-muted-foreground">{k}</span>
                              <span className="data tabular-nums text-[10px]">
                                {typeof val === "number" ? `${(val * 100).toFixed(1)}%` : EMPTY}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* PASS MODEL */}
              <div>
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground">PASS MODEL - CANONICAL 12 FEATURES</p>
                <div className="mt-2">
                  {passFeatures ? (
                    <>
                      <CalcRow label="gap_ahead_s" value={passFeatures.gap_ahead_s.toFixed(2)} kind="ACTUAL" />
                      <CalcRow label="closing_speed_kph" value={passFeatures.closing_speed_kph.toFixed(1)} kind="APPROX" />
                      <CalcRow label="straight_remaining_m" value={passFeatures.straight_remaining_m.toFixed(0)} kind="APPROX" />
                      <CalcRow label="tyre_age_delta_laps" value={passFeatures.tyre_age_delta_laps.toFixed(1)} kind="INFERRED" />
                      <CalcRow label="own_est_soc (MJ)" value={passFeatures.own_est_soc.toFixed(2)} kind="INFERRED" />
                      <CalcRow label="rival_est_soc (MJ)" value={passFeatures.rival_est_soc.toFixed(2)} kind="INFERRED" />
                      <CalcRow label="rival_P_Lderate" value={passFeatures.rival_P_Lderate.toFixed(3)} kind="INFERRED" />
                      <CalcRow label="rival_P_Lharvest" value={passFeatures.rival_P_Lharvest.toFixed(3)} kind="INFERRED" />
                      <CalcRow label="trap_flag" value={passFeatures.trap_flag ? "YES" : "NO"} kind="INFERRED" />
                      <CalcRow label="overtake_mode_active" value={passFeatures.overtake_mode_active ? "YES" : "NO"} kind="NOT_OBSERVED" />
                      <CalcRow label="circuit_harvest_potential_mj" value={passFeatures.circuit_harvest_potential_mj.toFixed(2)} kind="INFERRED" />
                      <CalcRow label="laps_remaining" value={String(passFeatures.laps_remaining)} kind="ACTUAL" />
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Pass-model features unavailable for this state.</p>
                  )}
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Model status: {passFeatures?.model_status ?? "HEURISTIC"} - transparent heuristic, no trained ML weights.
                </p>
              </div>

              {/* MODEL OUTPUT */}
              <div className="lg:col-span-2">
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground">MODEL OUTPUT - OVERTAKE EV</p>
                <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
                  {evBreakdown ? (
                    <>
                      <CalcRow label="P(pass)" value={fmtPct(evBreakdown.p_pass)} kind="MODEL" />
                      <CalcRow label="Points gain" value={evBreakdown.points_gain.toFixed(2)} kind="MODEL" />
                      <CalcRow label="Repass risk" value={fmtPct(evBreakdown.repass_risk)} kind="MODEL" />
                      <CalcRow label="Repass cost (pts)" value={evBreakdown.repass_cost_pts.toFixed(2)} kind="MODEL" />
                      <CalcRow label="Repayment cost" value={`${evBreakdown.repayment_cost_s.toFixed(1)} s / ${evBreakdown.repayment_cost_pts.toFixed(2)} pts`} kind="MODEL" />
                      <CalcRow label="Illegal penalty" value={evBreakdown.illegal_penalty.toFixed(2)} kind="MODEL" />
                      <CalcRow label="Strategic EV" value={evBreakdown.strategic_ev.toFixed(2)} kind="MODEL" />
                      <CalcRow label="Recommendation" value={evBreakdown.recommendation} kind="MODEL" />
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">EV breakdown unavailable for this state.</p>
                  )}
                </div>
                {evBreakdown?.why && (
                  <p className="mt-2 text-[11px] text-muted-foreground">{evBreakdown.why}</p>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
