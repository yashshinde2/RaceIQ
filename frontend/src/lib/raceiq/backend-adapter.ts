import melbourneFactual from "@/data/Melbourne_factual.json";
import shanghaiFactual from "@/data/Shanghai_factual.json";
import monzaFactual from "@/data/Monza_factual.json";

import { simulationAdapter } from "./adapter";
import { CIRCUIT_LIST, type CircuitId } from "./circuits";
import type {
  DriverIdentity,
  ErsMode,
  HmmBeliefState,
  OvertakeEvBreakdown,
  PassModelFeatures,
  Posture,
  ProvenancedFactor,
  RaceIQAdapter,
  RaceIQCircuit,
  RaceIQDriverState,
  RaceIQRecommendation,
  RaceIQSnapshot,
  RaceIQWhatIfBranch,
  RiskLevel,
  TimelineSample,
  RaceIQAnalysisSnapshot,
} from "./contracts";
import { DRIVER_BY_CODE } from "./drivers";

interface FactualDriver {
  code: string;
  position: number;
  gapToLeader: number | null;
  gapAhead: number | null;
  soc: number | null;
  nextSoc: number | null;
  socTrend: number | null;
  ersMode: string | null;
  tyre?: {
    compound: "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET" | null;
    ageLaps: number | null;
  } | null;
  lapTiming?: {
    lapStartTime: number | null;
    lapEndTime: number | null;
    lapTime: number | null;
  } | null;
  subLap?: {
    distance?: number[];
    speed?: number[];
    throttle?: number[];
    brake?: number[];
    soc: number[];
    modes: string[];
    kinds: string[];
    clips: boolean[];
  };
  recommendation?: {
    posture: Posture;
    /** Model emits no confidence value; null rather than a canned number. */
    confidence: number | null;
    passProbability: number;
    overtakeEv: number;
    energyCost: number;
    reason: string;
    constraints: string[];
    factors: {
      label: string;
      value: string;
      provenance: "ACTUAL" | "INFERRED" | "PROJECTED" | "SAMPLE";
    }[];
    whatIfBranches?: Record<
      string,
      {
        projectedPosition?: number;
        projectedGap?: number;
        projectedSoc?: number;
        energySpendMj?: number;
        minSocMj?: number;
        passesAhead?: number;
        repassesBehind?: number;
        score?: number;
        horizonLaps?: number;
        inputsUnavailable?: string[];
        inputApproximations?: Record<string, string>;
        outcome?: string;
        risk?: string;
      }
    >;
    hmm_belief?: HmmBeliefState;
    pass_features?: PassModelFeatures;
    ev_breakdown?: OvertakeEvBreakdown;
  };
}

interface FactualLap {
  lap: number;
  drivers: FactualDriver[];
}

interface FactualCircuitMetadata {
  season: number;
  sessionType: string;
  event: string;
  circuit: string;
  date: string;
  source: string;
  telemetryYear: number;
  ruleset: string;
  positionsProvenance: "ACTUAL" | "INFERRED" | "PROJECTED" | "SAMPLE";
  energyProvenance: "ACTUAL" | "INFERRED" | "PROJECTED" | "SAMPLE";
}

interface FactualCircuitData {
  metadata?: FactualCircuitMetadata;
  season?: number;
  sessionType?: string;
  circuitId: string;
  circuitKey: string;
  totalLaps: number;
  baseLapTime: number;
  harvestCapMj: number;
  laps: FactualLap[];
}

const FACTUAL_DATA: Record<string, FactualCircuitData> = {
  melbourne: melbourneFactual as unknown as FactualCircuitData,
  shanghai: shanghaiFactual as unknown as FactualCircuitData,
  monza: monzaFactual as unknown as FactualCircuitData,
};

export const BACKEND_CIRCUITS: RaceIQCircuit[] = CIRCUIT_LIST.map((base) => {
  const factual = FACTUAL_DATA[base.id.toLowerCase()];
  return {
    ...base,
    laps: factual ? factual.totalLaps : base.laps,
    baseLapTime: factual ? factual.baseLapTime : base.baseLapTime,
  };
});

const CIRCUITS_BY_ID: Record<string, RaceIQCircuit> = Object.fromEntries(
  BACKEND_CIRCUITS.map((c) => [c.id.toLowerCase(), c]),
);

function getDriver(code: string): DriverIdentity {
  const d = DRIVER_BY_CODE[code];
  if (d) return d;
  return {
    code,
    name: code,
    team: "Independent",
    color: "#8c8f93",
    tracked: false,
  };
}

function getDuration(circuitId: string): number {
  const factual = FACTUAL_DATA[circuitId.toLowerCase()];
  if (factual) {
    return factual.totalLaps * factual.baseLapTime;
  }
  return simulationAdapter.duration(circuitId);
}

function getSnapshotAt(circuitId: string, time: number): RaceIQSnapshot {
  const circuitKey = circuitId.toLowerCase();
  const factual = FACTUAL_DATA[circuitKey];
  const circuit = CIRCUITS_BY_ID[circuitKey] ?? BACKEND_CIRCUITS[0]!;

  // Must be valid 2026 factual Grand Prix race dataset (Rule 7: reject non-2026 data)
  if (
    !factual ||
    !factual.laps ||
    factual.laps.length === 0 ||
    (factual.season !== undefined && factual.season !== 2026) ||
    (factual.metadata && (factual.metadata.season !== 2026 || factual.metadata.sessionType !== "Race"))
  ) {
    const simSnap = simulationAdapter.snapshotAt(circuitId, time);
    return {
      ...simSnap,
      positionsProvenance: "SAMPLE",
      energyProvenance: "SAMPLE",
    };
  }

  const baseLapTime = factual.baseLapTime || 90.0;
  const clampedTime = Math.max(0, Math.min(time, factual.totalLaps * baseLapTime));
  const currentLapNum = Math.min(
    factual.totalLaps,
    Math.max(1, Math.floor(clampedTime / baseLapTime) + 1),
  );
  const lapIndex = Math.min(factual.laps.length - 1, Math.max(0, currentLapNum - 1));
  const baseLapFraction = (clampedTime % baseLapTime) / baseLapTime;
  const lapData = factual.laps[lapIndex];

  if (!lapData || !lapData.drivers) {
    const simSnap = simulationAdapter.snapshotAt(circuitId, time);
    return {
      ...simSnap,
      positionsProvenance: "SAMPLE",
      energyProvenance: "SAMPLE",
    };
  }

  const detect = circuit.detectionLine ?? 0.52;
  const activate = circuit.activationLine ?? 0.63;

  // Find P1 (race leader on this lap) for authoritative reference timing
  const leader = lapData.drivers.find((drv) => drv.position === 1) ?? lapData.drivers[0];
  const leaderLapTime = leader?.lapTiming?.lapTime && leader.lapTiming.lapTime > 0
    ? leader.lapTiming.lapTime
    : baseLapTime;
  const leaderStartTime = leader?.lapTiming?.lapStartTime;

  const drivers: RaceIQDriverState[] = lapData.drivers.map((d) => {
    // Physical cumulative race gap to P1 from FastF1
    const gapToLeader =
      typeof d.gapToLeader === "number" ? d.gapToLeader : d.position === 1 ? 0 : undefined;
    const gapAhead =
      typeof d.gapAhead === "number" ? d.gapAhead : d.position === 1 ? 0 : undefined;

    // Factual lap progress calculation:
    // 1. Derive driver's local time progress in their current lap
    let normTimeFrac: number;
    if (d.position === 1) {
      normTimeFrac = baseLapFraction;
    } else if (
      typeof d.lapTiming?.lapStartTime === "number" &&
      typeof leaderStartTime === "number" &&
      typeof d.lapTiming?.lapTime === "number" &&
      d.lapTiming.lapTime > 0
    ) {
      // Driver's exact lap progress from their own lapStartTime and lapTime:
      // Current session time is leaderStartTime + baseLapFraction * leaderLapTime
      const tCurrent = leaderStartTime + baseLapFraction * leaderLapTime;
      const tDriverInLap = tCurrent - d.lapTiming.lapStartTime;
      const driverTimeFraction = tDriverInLap / d.lapTiming.lapTime;
      normTimeFrac = ((driverTimeFraction % 1.0) + 1.0) % 1.0;
    } else {
      // Robust timing fallback using gapToLeader and driver's own lap time or baseLapTime
      const driverLapDur = d.lapTiming?.lapTime && d.lapTiming.lapTime > 0 ? d.lapTiming.lapTime : baseLapTime;
      const gapSec = gapToLeader ?? (d.position - 1) * 1.5;
      const tDriver = baseLapFraction * baseLapTime - gapSec;
      normTimeFrac = (((tDriver / driverLapDur) % 1.0) + 1.0) % 1.0;
    }

    // 2. Map local progress to normalized circuit progress using actual telemetry distance if available
    let lapFraction: number;
    if (d.subLap?.distance && Array.isArray(d.subLap.distance) && d.subLap.distance.length > 1) {
      const dists = d.subLap.distance;
      const nDist = dists.length;
      const u = Math.max(0, Math.min(normTimeFrac * (nDist - 1), nDist - 1));
      const idx = Math.floor(u);
      const r = u - idx;
      const dMeters = dists[idx]! + r * (dists[Math.min(idx + 1, nDist - 1)]! - dists[idx]!);
      const maxDist = dists[nDist - 1]!;
      lapFraction = maxDist > 0 ? dMeters / maxDist : normTimeFrac;
    } else {
      lapFraction = normTimeFrac;
    }

    // Ensure strictly in [0, 1) and rounded to 4 decimals
    lapFraction = ((lapFraction % 1.0) + 1.0) % 1.0;
    if (lapFraction >= 1.0) lapFraction = 0.0;
    lapFraction = Number(lapFraction.toFixed(4));

    let interpolatedSoc: number;
    let socTrend: number;
    let ersMode: ErsMode;
    let aeroMode: "STRAIGHT" | "CORNER";

    if (d.subLap && Array.isArray(d.subLap.soc) && d.subLap.soc.length > 1) {
      const nSegments = d.subLap.soc.length - 1;
      const u = Math.max(0, Math.min(lapFraction * nSegments, nSegments));
      const idx = Math.min(Math.floor(u), nSegments - 1);
      const r = u - idx;
      const socSample = d.subLap.soc[idx]! + r * (d.subLap.soc[idx + 1]! - d.subLap.soc[idx]!);
      interpolatedSoc = Number(socSample.toFixed(4));
      socTrend = Number((d.subLap.soc[idx + 1]! - d.subLap.soc[idx]!).toFixed(4));

      const nearestIdx = Math.min(Math.max(0, Math.round(u)), d.subLap.modes.length - 1);
      const isClipping = Boolean(d.subLap.clips && d.subLap.clips[nearestIdx]);
      const rawMode = d.subLap.modes[nearestIdx];

      if (isClipping || rawMode === "CLIPPING") {
        ersMode = "CLIPPING";
      } else if (
        rawMode === "DEPLOY" ||
        rawMode === "HARVEST" ||
        rawMode === "RECHARGE" ||
        rawMode === "BALANCED"
      ) {
        ersMode = rawMode;
      } else {
        ersMode = "BALANCED";
      }

      const kind = d.subLap.kinds?.[nearestIdx];
      aeroMode = kind === "straight" ? "STRAIGHT" : "CORNER";
    } else {
      // Continuous driver-specific interpolated SoC (Requirement 6 fallback):
      // SoC(t) = SoC(L) + lapFraction * (SoC(L+1) - SoC(L))
      const socStart = typeof d.soc === "number" ? d.soc : 0.5;
      const socEnd = typeof d.nextSoc === "number" ? d.nextSoc : socStart;
      interpolatedSoc = Number((socStart + baseLapFraction * (socEnd - socStart)).toFixed(4));
      socTrend = typeof d.socTrend === "number" ? d.socTrend : 0.0;

      ersMode =
        d.ersMode === "DEPLOY" ||
        d.ersMode === "HARVEST" ||
        d.ersMode === "RECHARGE" ||
        d.ersMode === "BALANCED" ||
        d.ersMode === "CLIPPING"
          ? d.ersMode
          : "BALANCED";

      aeroMode =
        lapFraction > detect && lapFraction < activate + 0.08 ? "STRAIGHT" : "CORNER";
    }

    const inDetectionWindow = Boolean(
      (gapAhead !== undefined && gapAhead <= 1.0 && gapAhead > 0) ||
        (baseLapFraction > detect - 0.05 && baseLapFraction < detect + 0.05),
    );

    return {
      code: d.code,
      position: d.position,
      lapFraction,
      lapsDone: Math.max(0, currentLapNum - 1 + lapFraction),
      gapToLeader,
      gapAhead,
      soc: interpolatedSoc,
      socTrend,
      ersMode,
      aeroMode,
      inDetectionWindow,
      tyre: d.tyre ?? null,
      lapTiming: d.lapTiming ?? null,
      subLap: d.subLap ?? null,
    };
  });

  drivers.sort((a, b) => a.position - b.position);
  const byCode = Object.fromEntries(drivers.map((d) => [d.code, d]));

  return {
    session: {
      source: "raceiq-backend-replay",
      circuitId: circuit.id,
      lap: currentLapNum,
      totalLaps: factual.totalLaps,
      time: clampedTime,
    },
    circuitId: circuit.id,
    time: clampedTime,
    lap: currentLapNum,
    totalLaps: factual.totalLaps,
    positionsProvenance: factual.metadata?.positionsProvenance ?? "ACTUAL",
    energyProvenance: factual.metadata?.energyProvenance ?? "INFERRED",
    drivers,
    byCode,
  };
}

function getRecommendation(
  snapshot: RaceIQSnapshot,
  code: string,
): RaceIQRecommendation | undefined {
  const circuitKey = snapshot.circuitId.toLowerCase();
  const factual = FACTUAL_DATA[circuitKey];
  if (!factual || !factual.laps) return undefined;

  const baseLapTime = factual.baseLapTime || 90.0;
  const currentLapNum = Math.min(
    factual.totalLaps,
    Math.max(1, Math.floor(snapshot.time / baseLapTime) + 1),
  );
  const lapIndex = Math.min(factual.laps.length - 1, Math.max(0, currentLapNum - 1));
  const lapData = factual.laps[lapIndex];
  if (!lapData) return undefined;

  const driverData = lapData.drivers.find((d) => d.code === code);
  // No exported recommendation exists for this state (e.g. the race leader has
  // no car ahead to price against). Coverage audit: OCO and BEA have 100%
  // coverage on all circuits; the only missing cells are P1 laps. The UI
  // renders NO CALL instead of a fabricated posture.
  if (!driverData || !driverData.recommendation) {
    return undefined;
  }

  const rec = driverData.recommendation;
  const driverState = snapshot.byCode[code];
  const factors = rec.factors.map((f) => {
    if (f.label === "Battery (est.)" && driverState?.soc !== undefined) {
      return {
        ...f,
        value: `${Math.round(driverState.soc * 100)}%`,
      };
    }
    return f;
  });

  return {
    posture: rec.posture,
    headline: rec.reason.split("->")[1]?.trim() || rec.posture,
    reason: rec.reason,
    confidence: rec.confidence,
    passProbability: rec.passProbability,
    overtakeEv: rec.overtakeEv,
    energyCost: rec.energyCost,
    constraints: rec.constraints,
    factors: factors as ProvenancedFactor[],
    hmmBelief: rec.hmm_belief,
    passFeatures: rec.pass_features,
    evBreakdown: rec.ev_breakdown,
  };
}

function getWhatIf(
  snapshot: RaceIQSnapshot,
  code: string,
  action: Posture,
): RaceIQWhatIfBranch | undefined {
  const driverState = snapshot.byCode[code];
  const seed = {
    source: snapshot.session.source,
    circuitId: snapshot.circuitId,
    lap: snapshot.lap,
    totalLaps: snapshot.totalLaps,
    time: snapshot.time,
    driver: code,
    position: driverState?.position,
    gapAhead: driverState?.gapAhead,
    soc: driverState?.soc,
  };

  const circuitKey = snapshot.circuitId.toLowerCase();
  const factual = FACTUAL_DATA[circuitKey];
  if (factual && factual.laps) {
    const baseLapTime = factual.baseLapTime || 90.0;
    const currentLapNum = Math.min(
      factual.totalLaps,
      Math.max(1, Math.floor(snapshot.time / baseLapTime) + 1),
    );
    const lapIndex = Math.min(factual.laps.length - 1, Math.max(0, currentLapNum - 1));
    const lapData = factual.laps[lapIndex];
    const driverData = lapData?.drivers.find((d) => d.code === code);
    const branchData = driverData?.recommendation?.whatIfBranches?.[action];

    if (branchData) {
      return {
        seed,
        action,
        projectedPosition: branchData.projectedPosition,
        projectedGap: branchData.projectedGap,
        projectedSoc: branchData.projectedSoc,
        energySpendMj: branchData.energySpendMj,
        minSocMj: branchData.minSocMj,
        passesAhead: branchData.passesAhead,
        repassesBehind: branchData.repassesBehind,
        score: branchData.score,
        horizonLaps: branchData.horizonLaps,
        inputsUnavailable: branchData.inputsUnavailable,
        inputApproximations: branchData.inputApproximations,
        outcome: branchData.outcome,
        // Model-generated branches carry no canned risk default: absent risk
        // stays undefined rather than a fabricated MEDIUM.
        risk: branchData.risk as RiskLevel | undefined,
        // Model-generated branches carry neither confidence nor canned
        // opponent narratives - those fields stay absent (UI shows a dash).
      };
    }
  }

  // No pre-computed branch exists for this (driver, action, replay state) in
  // the factual data preparation. We must not fabricate a "dynamic" projection
  // at runtime — that would imply a backend calculation this static frontend
  // does not run. The UI reports that no branch is available for this state.
  return undefined;
}

function getAnalysisSnapshot(
  circuitId: string,
  time: number,
  code: string,
): RaceIQAnalysisSnapshot | undefined {
  const snapshot = getSnapshotAt(circuitId, time);
  const driverState = snapshot.byCode[code];
  if (!driverState) return undefined;

  const circuitKey = circuitId.toLowerCase();
  const factual = FACTUAL_DATA[circuitKey];
  const circuit = CIRCUITS_BY_ID[circuitKey] ?? BACKEND_CIRCUITS[0]!;

  const baseLapTime = factual?.baseLapTime || 90.0;
  const currentLapNum = snapshot.lap;
  const lapIndex = Math.min((factual?.laps.length ?? 1) - 1, Math.max(0, currentLapNum - 1));
  const lapData = factual?.laps[lapIndex];
  const factualDriver = lapData?.drivers.find((d) => d.code === code);
  const rec = getRecommendation(snapshot, code);

  // Determine tactical rival: for Haas drivers, tactical opponent must be a non-Haas rival
  const isHaas = (c: string) => Boolean(DRIVER_BY_CODE[c]?.tracked);
  const ordered = [...snapshot.drivers].sort((a, b) => a.position - b.position);
  const myIdx = ordered.findIndex((d) => d.code === code);
  const nonHaasAhead =
    myIdx > 0 ? ordered.slice(0, myIdx).reverse().find((d) => !isHaas(d.code)) : undefined;
  const nonHaasBehind =
    myIdx >= 0 && myIdx < ordered.length - 1
      ? ordered.slice(myIdx + 1).find((d) => !isHaas(d.code))
      : undefined;

  let rivalCode: string | null = null;
  if (rec?.posture === "DEFEND") {
    rivalCode = nonHaasBehind?.code ?? nonHaasAhead?.code ?? null;
  } else {
    rivalCode = nonHaasAhead?.code ?? nonHaasBehind?.code ?? null;
  }
  const rivalDriver = rivalCode ? snapshot.byCode[rivalCode] : undefined;

  // Build timelines across all completed laps up to current lap
  const history: TimelineSample[] = [];
  const socOverTime: { lap: number; time: number; soc: number }[] = [];
  const ersModeOverTime: { lap: number; time: number; mode: ErsMode }[] = [];
  const clippingEventsOverTime: { lap: number; time: number; clipping: boolean }[] = [];
  const gapOverTime: {
    lap: number;
    time: number;
    gapAhead: number | null;
    gapToLeader: number | null;
  }[] = [];
  const pPassOverTime: { lap: number; time: number; pPass: number }[] = [];
  const strategicEvOverTime: { lap: number; time: number; ev: number }[] = [];
  const recommendationOverTime: { lap: number; time: number; posture: Posture }[] = [];
  const hmmProbabilitiesOverTime: {
    lap: number;
    time: number;
    pLderate: number;
    pLharvest: number;
    pOtAvail: number;
  }[] = [];

  if (factual?.laps) {
    const maxLapIdx = Math.min(factual.laps.length - 1, lapIndex);
    for (let l = 0; l <= maxLapIdx; l++) {
      const lData = factual.laps[l];
      if (!lData) continue;
      const lDriver = lData.drivers.find((d) => d.code === code);
      if (!lDriver) continue;

      const tLap = (lData.lap - 1) * baseLapTime;
      const soc = typeof lDriver.soc === "number" ? lDriver.soc : 0.5;
      const ersMode = (lDriver.ersMode ?? "BALANCED") as ErsMode;
      const isClipping = ersMode === "CLIPPING" || Boolean(lDriver.subLap?.clips?.some(Boolean));
      const lRec = lDriver.recommendation;

      const sample: TimelineSample = {
        lap: lData.lap,
        time: tLap,
        soc,
        ersMode,
        isClipping,
        gapAhead: lDriver.gapAhead,
        gapToLeader: lDriver.gapToLeader,
        pPass: lRec?.passProbability ?? null,
        strategicEv: lRec?.overtakeEv ?? null,
        posture: lRec?.posture ?? null,
        pLderate: lRec?.hmm_belief?.p_Lderate ?? null,
        pLharvest: lRec?.hmm_belief?.p_Lharvest ?? null,
        pOtAvail: lRec?.hmm_belief?.p_ot_avail ?? null,
        trapFlag: lRec?.hmm_belief?.trap_flag ?? null,
      };

      history.push(sample);
      socOverTime.push({ lap: lData.lap, time: tLap, soc });
      ersModeOverTime.push({ lap: lData.lap, time: tLap, mode: ersMode });
      clippingEventsOverTime.push({ lap: lData.lap, time: tLap, clipping: isClipping });
      gapOverTime.push({
        lap: lData.lap,
        time: tLap,
        gapAhead: lDriver.gapAhead,
        gapToLeader: lDriver.gapToLeader,
      });

      if (typeof lRec?.passProbability === "number") {
        pPassOverTime.push({ lap: lData.lap, time: tLap, pPass: lRec.passProbability });
      }
      if (typeof lRec?.overtakeEv === "number") {
        strategicEvOverTime.push({ lap: lData.lap, time: tLap, ev: lRec.overtakeEv });
      }
      if (lRec?.posture) {
        recommendationOverTime.push({ lap: lData.lap, time: tLap, posture: lRec.posture });
      }
      if (lRec?.hmm_belief) {
        hmmProbabilitiesOverTime.push({
          lap: lData.lap,
          time: tLap,
          pLderate: lRec.hmm_belief.p_Lderate ?? 0,
          pLharvest: lRec.hmm_belief.p_Lharvest ?? 0,
          pOtAvail: lRec.hmm_belief.p_ot_avail ?? 0,
        });
      }
    }
  }

  // Pre-computed counterfactual branches exported by the backend for this
  // state. Only branches that actually exist are included — a missing action
  // stays absent and the UI shows "no branch available" instead of an invented
  // projection.
  const whatIfBranches: Partial<Record<Posture, RaceIQWhatIfBranch>> = {};
  for (const a of ["ATTACK", "HOLD", "DEFEND", "HARVEST"] as const) {
    const br = getWhatIf(snapshot, code, a);
    if (br) whatIfBranches[a] = br;
  }

  const hmm = rec?.hmmBelief;

    const subLap = factualDriver?.subLap;
    const subLapIdx = subLap && typeof driverState.lapFraction === "number"
      ? Math.min(15, Math.max(0, Math.floor(driverState.lapFraction * 16)))
      : 0;

    return {
      raceState: {
        circuitId: circuit.id,
        circuitName: circuit.name,
        lap: currentLapNum,
        totalLaps: factual?.totalLaps ?? snapshot.totalLaps,
        time: snapshot.time,
        driver: code,
        rival: rivalCode,
        position: driverState.position,
        gapAhead: driverState.gapAhead ?? null,
        cumulativeGapToLeader: driverState.gapToLeader ?? null,
        lapFraction: driverState.lapFraction ?? 0,
      },
      telemetry: {
        available: Boolean(subLap),
        provenance: snapshot.positionsProvenance,
        speed: subLap?.speed ? subLap.speed[subLapIdx] : undefined,
        throttle: subLap?.throttle ? subLap.throttle[subLapIdx] : undefined,
        brake: subLap?.brake ? subLap.brake[subLapIdx] : undefined,
        distance: subLap?.distance ? subLap.distance[subLapIdx] : undefined,
        relevantTrackSegment: subLap?.kinds ? subLap.kinds[subLapIdx] : undefined,
        detectionWindow: {
          detectionLine: circuit.detectionLine ?? 0.52,
          activationLine: circuit.activationLine ?? 0.63,
          inWindow: driverState.inDetectionWindow ?? false,
        },
        straightContext: {
          longestStraightM: rec?.passFeatures?.straight_remaining_m,
          closingSpeedKph: rec?.passFeatures?.closing_speed_kph,
          detectionGapS: driverState.gapAhead ?? null,
        },
        subLapCheckpoints: subLap,
      },
    energy: {
      soc: driverState.soc ?? 0,
      socTrend: driverState.socTrend ?? 0.0,
      ersMode: driverState.ersMode ?? "BALANCED",
      isClipping: driverState.ersMode === "CLIPPING",
      energyProvenance: snapshot.energyProvenance,
      harvestCapMj: factual?.harvestCapMj ?? 8.5,
      harvestPotentialMj: rec?.passFeatures?.circuit_harvest_potential_mj ?? null,
    },
    opponentInference: {
      rivalCode,
      rivalSoc: rivalDriver?.soc ?? null,
      rivalErsMode: rivalDriver?.ersMode ?? null,
      pLderate: hmm?.p_Lderate ?? null,
      pLharvest: hmm?.p_Lharvest ?? null,
      pOtAvail: hmm?.p_ot_avail ?? null,
      trapFlag: hmm?.trap_flag ?? false,
      trapProbability: hmm?.trap_prob ?? null,
      hmmBelief: hmm,
      provenance: "INFERRED",
    },
    passModel: rec?.passFeatures
      ? {
          features: rec.passFeatures,
          pPass: rec.passProbability ?? rec.passFeatures.p_pass ?? 0,
          modelProvenance: "HEURISTIC",
        }
      : undefined,
    overtakeEv: rec?.evBreakdown
      ? {
          breakdown: rec.evBreakdown,
          strategicEv: rec.overtakeEv ?? rec.evBreakdown.strategic_ev,
          recommendation: rec.posture,
        }
      : undefined,
    whatIfBranches,
    timelines: {
      socOverTime,
      ersModeOverTime,
      clippingEventsOverTime,
      gapOverTime,
      pPassOverTime,
      strategicEvOverTime,
      recommendationOverTime,
      hmmProbabilitiesOverTime,
      history,
    },
  };
}

export const backendAdapter: RaceIQAdapter = {
  id: "raceiq-backend-replay",
  kind: "recorded",
  circuits: BACKEND_CIRCUITS,
  circuit: (circuitId) => CIRCUITS_BY_ID[circuitId.toLowerCase()] ?? BACKEND_CIRCUITS[0],
  driver: getDriver,
  duration: getDuration,
  snapshotAt: getSnapshotAt,
  recommend: getRecommendation,
  whatIf: getWhatIf,
  analysisSnapshotAt: getAnalysisSnapshot,
};

