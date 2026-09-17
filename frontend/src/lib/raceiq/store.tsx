import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { backendAdapter, simulationAdapter } from "./adapter";
import type {
  DriverIdentity,
  Posture,
  RaceIQAdapter,
  RaceIQCircuit,
  RaceIQDriverState,
  RaceIQRecommendation,
  RaceIQSnapshot,
  RaceIQWhatIfBranch,
  RaceIQAnalysisSnapshot,
} from "./contracts";

interface RaceIQContextValue {
  adapter: RaceIQAdapter;
  circuits: RaceIQCircuit[];
  circuit: RaceIQCircuit;
  circuitId: string;
  setCircuit: (id: string) => void;
  time: number;
  setTime: (t: number) => void;
  duration: number;
  playing: boolean;
  toggle: () => void;
  pause: () => void;
  snapshot: RaceIQSnapshot;
  selected: string;
  setSelected: (code: string) => void;
  rival: string;
  setRival: (code: string) => void;
  tacticalTarget?: RaceIQDriverState | undefined;
  tacticalRole?: "AHEAD" | "BEHIND";
  tacticalTargetOf?: (code: string) => {
    target: RaceIQDriverState | undefined;
    role: "AHEAD" | "BEHIND";
  };
  /** Contract accessors — components never reach into a data producer. */
  driver: (code: string) => DriverIdentity;
  stateOf: (code: string) => RaceIQDriverState | undefined;
  /** Immediate car ahead of `code` in the actual current race order, if any. */
  aheadOf: (code: string) => RaceIQDriverState | undefined;
  /** Immediate car behind `code` in the actual current race order, if any. */
  behindOf: (code: string) => RaceIQDriverState | undefined;
  recommendationFor: (code: string) => RaceIQRecommendation | undefined;
  whatIf: (code: string, action: Posture) => RaceIQWhatIfBranch | undefined;
  analysisSnapshot?: RaceIQAnalysisSnapshot | undefined;
  analysisFor?: (code: string) => RaceIQAnalysisSnapshot | undefined;
}

const RaceIQContext = createContext<RaceIQContextValue | null>(null);

export function RaceIQProvider({
  children,
  adapter = backendAdapter,
}: {
  children: ReactNode;
  /** Real backend adapter is the default; simulation is available as fallback */
  adapter?: RaceIQAdapter;
}) {
  const firstCircuit = adapter.circuits[0]!;
  const [circuitId, setCircuitId] = useState<string>(firstCircuit.id);
  const [time, setTime] = useState(420);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState("OCO");
  const raf = useRef<number | null>(null);

  const circuit = adapter.circuit(circuitId) ?? firstCircuit;
  const duration = adapter.duration(circuit.id);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const next = t + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, duration]);

  const setCircuit = useCallback(
    (id: string) => {
      setCircuitId(id);
      setTime(Math.min(420, adapter.duration(id)));
    },
    [adapter],
  );

  const snapshot = useMemo(
    () => adapter.snapshotAt(circuit.id, time),
    [adapter, circuit.id, time],
  );

  // Cars in the actual current race order. `aheadOf` / `behindOf` derive the
  // immediate neighbours of the selected Haas driver from this order — the
  // primary workflow never asks the user to pick opponents manually.
  const orderedDrivers = useMemo(
    () => [...snapshot.drivers].sort((a, b) => a.position - b.position),
    [snapshot],
  );
  const aheadOf = (code: string): RaceIQDriverState | undefined => {
    const i = orderedDrivers.findIndex((d) => d.code === code);
    return i > 0 ? orderedDrivers[i - 1] : undefined;
  };
  const behindOf = (code: string): RaceIQDriverState | undefined => {
    const i = orderedDrivers.findIndex((d) => d.code === code);
    return i >= 0 && i < orderedDrivers.length - 1 ? orderedDrivers[i + 1] : undefined;
  };

  const isTracked = (c: string) => Boolean(adapter.driver(c)?.tracked);

  const nonHaasAheadOf = (code: string): RaceIQDriverState | undefined => {
    const i = orderedDrivers.findIndex((d) => d.code === code);
    if (i <= 0) return undefined;
    for (let idx = i - 1; idx >= 0; idx--) {
      const d = orderedDrivers[idx]!;
      if (!isTracked(d.code)) return d;
    }
    return undefined;
  };

  const nonHaasBehindOf = (code: string): RaceIQDriverState | undefined => {
    const i = orderedDrivers.findIndex((d) => d.code === code);
    if (i < 0 || i >= orderedDrivers.length - 1) return undefined;
    for (let idx = i + 1; idx < orderedDrivers.length; idx++) {
      const d = orderedDrivers[idx]!;
      if (!isTracked(d.code)) return d;
    }
    return undefined;
  };

  const tacticalTargetOf = (
    code: string,
  ): { target: RaceIQDriverState | undefined; role: "AHEAD" | "BEHIND" } => {
    const rec = adapter.recommend?.(snapshot, code);
    const posture = rec?.posture;
    const ahead = nonHaasAheadOf(code);
    const behind = nonHaasBehindOf(code);

    if (posture === "DEFEND") {
      if (behind) return { target: behind, role: "BEHIND" };
      return { target: ahead, role: "AHEAD" };
    }
    // ATTACK, HOLD, HARVEST, or default
    if (ahead) return { target: ahead, role: "AHEAD" };
    return { target: behind, role: "BEHIND" };
  };

  const currentTactical = tacticalTargetOf(selected);
  const tacticalTarget = currentTactical.target;
  const tacticalRole = currentTactical.role;
  const rival = tacticalTarget?.code ?? "";

  const value: RaceIQContextValue = {
    adapter,
    circuits: adapter.circuits,
    circuit,
    circuitId: circuit.id,
    setCircuit,
    time,
    setTime,
    duration,
    playing,
    toggle: () => setPlaying((p) => !p),
    pause: () => setPlaying(false),
    snapshot,
    selected,
    setSelected: (code) => {
      setSelected((prev) => {
        // Primary selection is Haas-only: the decision workflow always
        // represents the tracked team (OCO / BEA).
        if (!adapter.driver(code)?.tracked) return prev;
        return code;
      });
    },
    rival,
    setRival: () => {},
    tacticalTarget,
    tacticalRole,
    tacticalTargetOf,
    driver: (code) => adapter.driver(code) ?? { code },
    stateOf: (code) => snapshot.byCode[code],
    aheadOf,
    behindOf,
    recommendationFor: (code) => adapter.recommend?.(snapshot, code),
    whatIf: (code, action) => adapter.whatIf?.(snapshot, code, action),
    analysisSnapshot: adapter.analysisSnapshotAt?.(circuit.id, time, selected),
    analysisFor: (code) => adapter.analysisSnapshotAt?.(circuit.id, time, code),
  };

  return <RaceIQContext.Provider value={value}>{children}</RaceIQContext.Provider>;
}

export function useRaceIQ() {
  const ctx = useContext(RaceIQContext);
  if (!ctx) throw new Error("useRaceIQ must be used inside RaceIQProvider");
  return ctx;
}
