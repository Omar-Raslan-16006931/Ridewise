"use client";

import { useMemo } from "react";
import { monthKeyOf, personalTotal, toLocalDateKey } from "../../lib/analytics";
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
  const months = useMemo(() => {
    const visible = trips.filter((trip) => {
      if (filter === "unsettled") return trip.trip_mode === "shared" && !trip.settled_at;
      if (filter === "shared") return trip.trip_mode === "shared";
      if (filter === "solo") return trip.trip_mode === "solo";
      return true;
    });
    const byMonth = new Map<string, Map<string, Trip[]>>();
    for (const trip of visible) {
      const m = monthKeyOf(trip.ride_at);
      const d = toLocalDateKey(trip.ride_at);
      if (!byMonth.has(m)) byMonth.set(m, new Map());
      const days = byMonth.get(m)!;
      days.set(d, [...(days.get(d) ?? []), trip]);
    }
    return [...byMonth.entries()].map(([key, days]) => {
      const all = [...days.values()].flat();
      return {
        key,
        label: new Date(all[0].ride_at).toLocaleDateString("en", { month: "long", year: "numeric" }),
        share: personalTotal(all, currentUserId),
        days: [...days.entries()].map(([dayKey, list]) => ({
          key: dayKey,
          label: new Date(list[0].ride_at).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" }),
          share: personalTotal(list, currentUserId),
          trips: list,
        })),
      };
    });
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
      {months.length === 0 ? (
        <p className="panel pad label center">
          {filter === "unsettled" ? "Nothing to settle. Every shared ride is paid back." : "No rides here yet."}
        </p>
      ) : (
        months.map((month) => (
          <section key={month.key} className="stack-tight">
            <div className="month-title">
              <h2>{month.label}</h2>
              <span className="label">Your share {egp(month.share)}</span>
            </div>
            {month.days.map((day) => (
              <div key={day.key} className="day-group">
                <div className="day-head">
                  <span>{day.label}</span>
                  <span>{egp(day.share)}</span>
                </div>
                <RideList trips={day.trips} members={members} currentUserId={currentUserId} onOpen={onOpenRide} timeOnly />
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
