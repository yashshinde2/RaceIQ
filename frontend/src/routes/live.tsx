import { createFileRoute } from "@tanstack/react-router";
import { DriverContext } from "@/components/raceiq/DriverContext";
import { HaasPanel } from "@/components/raceiq/HaasPanel";
import { MatchupCard } from "@/components/raceiq/MatchupCard";
import { ProvenanceTag } from "@/components/raceiq/ProvenanceTag";
import { ReplayBar } from "@/components/raceiq/ReplayBar";
import { TimingGrid } from "@/components/raceiq/TimingGrid";
import { TrackMap } from "@/components/raceiq/TrackMap";
import { EMPTY, fmtGap, fmtPct } from "@/lib/raceiq/format";
import { useRaceIQ } from "@/lib/raceiq/store";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Live Race — RaceIQ" },
      {
        name: "description",
        content:
          "Follow the replay, see where every car is, and get one clear RaceIQ call for the Haas drivers.",
      },
      { property: "og:title", content: "Live Race — RaceIQ" },
      {
        property: "og:description",
        content: "Race replay, 22-driver timing and a single RaceIQ recommendation for Haas.",
      },
    ],
  }),
  component: LiveRace,
});

function SelectedDriver() {
  const { snapshot, selected, driver: driverOf, stateOf } = useRaceIQ();
  const state = stateOf(selected);
  const driver = driverOf(selected);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Selected driver</p>
        <ProvenanceTag kind={snapshot.positionsProvenance} />
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <p className="data truncate text-base font-semibold">
            {selected}
            {driver.name ? ` · ${driver.name}` : ""}
          </p>
          <p className="truncate text-xs text-muted-foreground">{driver.team}</p>
        </div>
        <span
          className="data shrink-0 rounded border border-border px-2.5 py-1 text-sm font-semibold"
          style={{ color: driver.color }}
        >
          {state ? `P${state.position}` : EMPTY}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div>
          <dt className="text-[11px] text-muted-foreground">Gap to leader</dt>
          <dd className="data text-sm font-medium">
            {state?.position === 1 ? "leader" : fmtGap(state?.gapToLeader)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Gap ahead</dt>
          <dd className="data text-sm font-medium">
            {state?.position === 1 ? EMPTY : fmtGap(state?.gapAhead)}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>Tyre</span>
            <span className="text-[9px] text-actual font-mono font-medium">(ACTUAL)</span>
          </dt>
          <dd className="data text-sm font-semibold">
            {state?.tyre?.compound
              ? `${state.tyre.compound}${typeof state.tyre.ageLaps === "number" ? ` · ${Math.round(state.tyre.ageLaps)} LAPS` : ""}`
              : EMPTY}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>Battery (est.)</span>
            <span className="text-[9px] text-inferred font-mono font-medium">(INFERRED)</span>
          </dt>
          <dd className="data text-sm font-medium">{fmtPct(state?.soc)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>Energy state</span>
            <span className="text-[9px] text-inferred font-mono font-medium">(INFERRED)</span>
          </dt>
          <dd className="data text-sm font-medium">{state?.ersMode ?? EMPTY}</dd>
        </div>
      </dl>
    </div>
  );
}

function LiveRace() {
  return (
    <main className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 sm:py-6">
      <h1 className="sr-only">RaceIQ live race replay</h1>
      <ReplayBar />

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
        <TrackMap />
        <div className="space-y-4">
          <HaasPanel />
          <DriverContext />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start">
        <TimingGrid />
        <div className="space-y-4">
          <MatchupCard />
          <SelectedDriver />
        </div>
      </div>
    </main>
  );
}
