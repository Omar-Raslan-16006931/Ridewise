"use client";

import type { Member, Trip } from "../../lib/types";
import { egp, formatShortDate, formatTime } from "./format";
import { Icon } from "./icons";

export function rideStatus(trip: Trip, members: Member[], currentUserId: string): { text: string; tone: "" | "due" | "done" } {
  const half = trip.amount / 2;
  const debtor = members.find((m) => m.user_id !== trip.paid_by)?.display_name ?? "Your co-rider";
  if (trip.trip_mode === "solo") {
    return { text: trip.solo_by === currentUserId ? "Solo" : `${members.find((m) => m.user_id === trip.solo_by)?.display_name ?? "Someone"} solo`, tone: "" };
  }
  if (trip.settled_at) return { text: "Settled", tone: "done" };
  if (trip.paid_by === currentUserId) return { text: `${debtor} owes ${egp(half)}`, tone: "due" };
  return { text: `You owe ${egp(half)}`, tone: "due" };
}

export function RideList({
  trips,
  members,
  currentUserId,
  onOpen,
  footer,
}: {
  trips: Trip[];
  members: Member[];
  currentUserId: string;
  onOpen: (trip: Trip) => void;
  footer?: React.ReactNode;
}) {
  return (
    <div className="glass list">
      {trips.map((trip) => {
        const status = rideStatus(trip, members, currentUserId);
        return (
          <button key={trip.id} type="button" className="row" onClick={() => onOpen(trip)}>
            <Icon name={trip.direction === "campus" ? "campus" : "home"} size={22} className={`row-icon tint-text-${trip.direction}`} />
            <span className="row-text">
              <span className="row-title">{trip.direction === "campus" ? "To campus" : "Back home"}</span>
              <span className="row-sub">
                {formatShortDate(trip.ride_at)}, {formatTime(trip.ride_at)}
              </span>
            </span>
            <span className="row-end">
              <span className="row-value">{egp(trip.amount)}</span>
              <span className={`row-sub status-${status.tone || "plain"}`}>{status.text}</span>
            </span>
          </button>
        );
      })}
      {footer}
    </div>
  );
}
