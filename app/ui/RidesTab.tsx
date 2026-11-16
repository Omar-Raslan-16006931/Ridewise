"use client";

import { useMemo } from "react";
import { monthKeyOf, personalTotal } from "../../lib/analytics";
import type { Member, Trip } from "../../lib/types";
import { egp, plural } from "./format";
import { RideList, type RideActions } from "./rides";

export type RidesFilter = "all" | "unsettled" | "shared" | "solo";

const FILTERS: { id: RidesFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unsettled", label: "Unsettled" },
  { id: "shared", label: "Shared" },
  { id: "solo", label: "Solo" },
];

export function RidesTab({
  trips,
  filter,
  onFilter,
  members,
  currentUserId,
  rideActions,
  onLog,
}: {
  /** Newest first. */
  trips: Trip[];
  filter: RidesFilter;
  onFilter: (filter: RidesFilter) => void;
  members: Member[];
  currentUserId: string;
  rideActions: RideActions;
  onLog: () => void;
}) {
  const counts = useMemo(
    () => ({
      all: trips.length,
      unsettled: trips.filter((t) => t.trip_mode === "shared" && !t.settled_at).length,
      shared: trips.filter((t) => t.trip_mode === "shared").length,
      solo: trips.filter((t) => t.trip_mode === "solo").length,
    }),
    [trips]
  );

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
    return [...byMonth.entries()].map(([key, monthTrips]) => ({
      key,
      label: new Date(monthTrips[0].ride_at).toLocaleDateString("en", { month: "long", year: "numeric" }),
      trips: monthTrips,
      share: personalTotal(monthTrips, currentUserId),
    }));
  }, [trips, filter, currentUserId]);

  return (
    <main className="tab">
      <h1 className="page-title">Rides</h1>
      <div className="chips no-swipe" role="tablist" aria-label="Filter rides">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={`chip ${filter === item.id ? "is-on" : ""}`}
            onClick={() => onFilter(item.id)}
          >
            {item.label}
            <span>{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          <p>{filter === "unsettled" ? "Nothing to settle. Every shared ride is paid back." : "No rides here yet."}</p>
          <button type="button" className="btn btn-primary" onClick={onLog}>
            Log ride
          </button>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="plain">
            <header className="month-head">
              <h2>{group.label}</h2>
              <span>
                {plural(group.trips.length, "ride")}, your share EGP {egp(group.share)}
              </span>
            </header>
            <RideList trips={group.trips} members={members} currentUserId={currentUserId} actions={rideActions} />
          </section>
        ))
      )}
    </main>
  );
}
