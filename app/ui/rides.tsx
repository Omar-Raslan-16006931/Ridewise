"use client";

import { useState } from "react";
import type { Member, Trip } from "../../lib/types";
import { egp, formatDay, formatTime } from "./format";
import { Icon } from "./icons";

export type RideActions = {
  onEdit: (trip: Trip) => void;
  onDelete: (trip: Trip) => void;
  onSettle: (trip: Trip, paidByMemberId?: string) => void;
};

function nameOf(members: Member[], id: string | null | undefined, fallback: string) {
  return members.find((member) => member.user_id === id)?.display_name ?? fallback;
}

export function RideRow({
  trip,
  members,
  currentUserId,
  open,
  onToggle,
  actions,
}: {
  trip: Trip;
  members: Member[];
  currentUserId: string;
  open: boolean;
  onToggle: () => void;
  actions: RideActions;
}) {
  const half = trip.amount / 2;
  const solo = trip.trip_mode === "solo";
  const iPaid = trip.paid_by === currentUserId;
  const payerName = nameOf(members, trip.paid_by, "Someone");
  const debtor = members.find((member) => member.user_id !== trip.paid_by);
  const debtorName = debtor?.display_name ?? "your co-rider";
  const soloName = nameOf(members, trip.solo_by, "Someone");
  const mineSolo = trip.solo_by === currentUserId;

  let status: string;
  let tone = "";
  if (solo) {
    status = mineSolo ? "Solo, all yours" : `${soloName} rode solo`;
  } else if (trip.settled_at) {
    status = `${egp(half)} each, settled`;
    tone = "is-good";
  } else if (iPaid) {
    status = `${debtorName} owes you ${egp(half)}`;
    tone = "is-due";
  } else {
    status = `You owe ${payerName} ${egp(half)}`;
    tone = "is-due";
  }

  return (
    <article className={`ride ${open ? "is-open" : ""}`}>
      <button type="button" className="ride-main" onClick={onToggle} aria-expanded={open}>
        <Icon name={trip.direction === "campus" ? "campus" : "home"} size={22} className={`ride-icon ride-${trip.direction}`} />
        <span className="ride-text">
          <span className="ride-title">{trip.direction === "campus" ? "To campus" : "Back home"}</span>
          <span className="ride-meta">
            {formatDay(trip.ride_at)}, {formatTime(trip.ride_at)}
          </span>
        </span>
        <span className="ride-money">
          <span className="ride-amount">
            <small>EGP</small>
            {egp(trip.amount)}
          </span>
          <span className={`ride-status ${tone}`}>{status}</span>
        </span>
      </button>
      <div className="ride-more" aria-hidden={!open}>
        <div className="ride-more-inner">
          <p className="ride-note">
            {solo ? `${soloName} paid the full fare.` : `${payerName} paid Uber. Split 50/50.`}
            {trip.notes ? ` Note: ${trip.notes}` : ""}
          </p>
          <div className="ride-actions">
            {!solo && !trip.settled_at && (
              <button
                type="button"
                className="btn btn-primary btn-small"
                tabIndex={open ? 0 : -1}
                onClick={() => actions.onSettle(trip, iPaid ? debtor?.user_id : currentUserId)}
              >
                <Icon name="check" size={16} />
                {iPaid ? `${debtorName} paid me` : "I paid my half"}
              </button>
            )}
            <button type="button" className="btn btn-quiet btn-small" tabIndex={open ? 0 : -1} onClick={() => actions.onEdit(trip)}>
              <Icon name="edit" size={16} />
              Edit
            </button>
            <button type="button" className="btn btn-quiet btn-small is-danger" tabIndex={open ? 0 : -1} onClick={() => actions.onDelete(trip)}>
              <Icon name="trash" size={16} />
              Delete
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

/** A list of rides where one row at a time opens to show its actions. */
export function RideList({
  trips,
  members,
  currentUserId,
  actions,
}: {
  trips: Trip[];
  members: Member[];
  currentUserId: string;
  actions: RideActions;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="ride-list">
      {trips.map((trip) => (
        <RideRow
          key={trip.id}
          trip={trip}
          members={members}
          currentUserId={currentUserId}
          open={openId === trip.id}
          onToggle={() => setOpenId(openId === trip.id ? null : trip.id)}
          actions={actions}
        />
      ))}
    </div>
  );
}
