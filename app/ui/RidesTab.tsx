"use client";

import { useMemo } from "react";
import { monthKeyOf, personalTotal } from "../../lib/analytics";
import type { Member, Trip } from "../../lib/types";
import { egp } from "./format";
import { RideList } from "./rides";
import { Segmented } from "./Segmented";

export type RidesFilter = "all" | "unsettled" | "shared" | "solo";

export function RidesTab({
  trips,
  filter,
  onFilter,
  members,
  currentUserId,
  onOpenRide,
}: {
  trips: Trip[];
  filter: RidesFilter;
  onFilter: (filter: RidesFilter) => void;
  members: Member[];
  currentUserId: string;
  onOpenRide: (trip: Trip) => void;
}) {
  const groups = useMemo(() => {
    const visible = trips.filter((trip) => {
      if (filter === "unsettled") return trip.trip_mode === "shared" && !trip.settled_at;
      if (filter === "shared") return trip.trip_mode === "shared";
      if (filter === "solo") return trip.trip_mode === "solo";
      return true;
    });
    const byMonth = new Map<string, Trip[]>();
    for (const trip of visible) {
      const key = monthKeyOf(trip.ride_at);
      byMonth.set(key, [...(byMonth.get(key) ?? []), trip]);
    }
    return [...byMonth.entries()].map(([key, list]) => ({
      key,
      label: new Date(list[0].ride_at).toLocaleDateString("en", { month: "long", year: "numeric" }),
      trips: list,
      share: personalTotal(list, currentUserId),
    }));
  }, [trips, filter, currentUserId]);

  return (
    <div className="stack">
      <Segmented
        label="Filter rides"
        value={filter}
        onChange={onFilter}
        options={[
          { value: "all", label: "All" },
          { value: "unsettled", label: "Unsettled" },
          { value: "shared", label: "Shared" },
          { value: "solo", label: "Solo" },
        ]}
      />
      {groups.length === 0 ? (
        <p className="glass card secondary center">
          {filter === "unsettled" ? "Nothing to settle. Every shared ride is paid back." : "No rides here yet."}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="stack-tight">
            <div className="section-head">
              <h2>{group.label}</h2>
              <span className="secondary small">Your share {egp(group.share)}</span>
            </div>
            <RideList trips={group.trips} members={members} currentUserId={currentUserId} onOpen={onOpenRide} />
          </section>
        ))
      )}
    </div>
  );
}
