"use client";

import { useState, type TouchEvent } from "react";
import type { DaySpendingItem, computeTodayBudget } from "../../lib/analytics";
import type { Member, Trip } from "../../lib/types";
import { Meter, WeekBars } from "./charts";
import { egp, plural } from "./format";
import { Icon } from "./icons";
import { Count, Money } from "./numbers";
import { RideList, type RideActions } from "./rides";

export type WeekView = {
  label: string;
  name: string;
  spent: number;
  budget: number;
  remaining: number;
  daysLeft: number;
  perDayLeft: number;
  dailyAllowance: number;
  rides: number;
  days: DaySpendingItem[];
};

export function TodayTab({
  net,
  unsettledCount,
  otherName,
  today,
  week,
  weekOffset,
  weekSlide,
  onChangeWeek,
  onThisWeek,
  swipeHandlers,
  latest,
  totalRides,
  members,
  currentUserId,
  rideActions,
  onLog,
  onSettleUp,
  onSeeAll,
  onEditBudget,
}: {
  net: number;
  unsettledCount: number;
  otherName: string;
  today: ReturnType<typeof computeTodayBudget>;
  week: WeekView;
  weekOffset: number;
  weekSlide: "next" | "prev" | null;
  onChangeWeek: (step: number) => void;
  onThisWeek: () => void;
  swipeHandlers: { onTouchStart: (e: TouchEvent) => void; onTouchEnd: (e: TouchEvent) => void };
  latest: Trip[];
  totalRides: number;
  members: Member[];
  currentUserId: string;
  rideActions: RideActions;
  onLog: () => void;
  onSettleUp: () => void;
  onSeeAll: () => void;
  onEditBudget: () => void;
}) {
  const [pickedDay, setPickedDay] = useState<DaySpendingItem | null>(null);
  const picked = pickedDay && week.days.find((day) => day.isoDate === pickedDay.isoDate);
  const todayLabel = new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const over = week.remaining < 0;
  const todayTone = today.todayActualSpend > today.todayBudget ? "bad" : today.todayPct >= 80 ? "warn" : "good";

  return (
    <main className="tab">
      <section className="hero">
        <p className="hero-label">
          {net === 0 ? "You two are all square" : net > 0 ? `${otherName} owes you` : `You owe ${otherName}`}
        </p>
        <Money value={Math.abs(net)} roll className="hero-amount" />
        <p className="hero-sub">
          {net === 0 ? "No halves waiting to be paid back." : `Across ${plural(unsettledCount, "unsettled shared ride")}.`}
        </p>
        <div className="hero-actions">
          <button type="button" className="btn btn-amber" onClick={onLog}>
            <Icon name="plus" size={18} />
            Log ride
          </button>
          {unsettledCount > 0 && (
            <button type="button" className="btn btn-on-dark" onClick={onSettleUp}>
              Settle up
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>Today</h2>
          <span className="card-aside">{todayLabel}</span>
        </header>
        {!today.isCollegeDay ? (
          <p className="lead">
            No college today.
            <span>
              {today.todayActualSpend > 0
                ? ` You still spent EGP ${egp(today.todayActualSpend)}.`
                : today.nextCollegeDay
                ? ` Next ride day is ${today.nextCollegeDay}.`
                : ""}
            </span>
          </p>
        ) : (
          <>
            <p className="figure">
              <Money value={Math.abs(today.todayRemaining)} className={today.todayRemaining < 0 ? "is-bad" : ""} />
              <span className="figure-unit">{today.todayRemaining < 0 ? "over today's allowance" : "left today"}</span>
            </p>
            <Meter value={today.todayActualSpend} max={Math.max(today.todayBudget, 1)} tone={todayTone} />
            <dl className="facts">
              <div>
                <dt>Allowance</dt>
                <dd><Count value={today.todayBudget} /></dd>
              </div>
              <div>
                <dt>Spent</dt>
                <dd><Count value={today.todayActualSpend} /></dd>
              </div>
              <div>
                <dt>Rides</dt>
                <dd>{today.todayRidesCount}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section className="card" {...swipeHandlers}>
        <header className="card-head">
          <h2>{week.name}</h2>
          <div className="stepper">
            <button type="button" className="icon-btn" onClick={() => onChangeWeek(-1)} aria-label="Previous week">
              <Icon name="left" />
            </button>
            <span className="stepper-label">{week.label}</span>
            <button type="button" className="icon-btn" onClick={() => onChangeWeek(1)} aria-label="Next week">
              <Icon name="right" />
            </button>
          </div>
        </header>

        <div key={weekOffset} className={weekSlide ? `slide-${weekSlide}` : ""}>
          <WeekBars days={week.days} dailyAllowance={week.dailyAllowance} selectedIso={picked?.isoDate ?? null} onSelect={setPickedDay} />
          <p className="chart-note" aria-live="polite">
            {picked ? (
              <>
                <b>{picked.dayFullName} {picked.dateStr}</b>
                {picked.ridesCount > 0
                  ? ` EGP ${egp(picked.actualSpend)} over ${plural(picked.ridesCount, "ride")}`
                  : " No rides"}
              </>
            ) : (
              <>
                <i className="dot tone-campus" aria-hidden="true" /> To campus
                <i className="dot tone-home" aria-hidden="true" /> Back home
              </>
            )}
          </p>

          <div className="between">
            <span className="figure figure-small">
              <Money value={week.spent} />
              <span className="figure-unit">of {egp(week.budget)}</span>
            </span>
            <button type="button" className="link" onClick={onEditBudget}>
              Change budget
            </button>
          </div>
          <Meter value={week.spent} max={Math.max(week.budget, 1)} tone={over ? "bad" : "ink"} />
          <p className="note">
            {weekOffset < 0
              ? over
                ? `Finished EGP ${egp(Math.abs(week.remaining))} over budget, ${plural(week.rides, "ride")}.`
                : `Finished EGP ${egp(week.remaining)} under budget, ${plural(week.rides, "ride")}.`
              : over
              ? `EGP ${egp(Math.abs(week.remaining))} over this week's budget.`
              : week.daysLeft > 0
              ? `EGP ${egp(week.remaining)} left, about ${egp(week.perDayLeft)} a day for the ${plural(week.daysLeft, "college day")} still to come.`
              : `EGP ${egp(week.remaining)} left and no college days remaining.`}
          </p>
          {weekOffset !== 0 && (
            <button type="button" className="link" onClick={onThisWeek}>
              Back to this week
            </button>
          )}
        </div>
      </section>

      <section className="plain">
        <header className="card-head">
          <h2>Latest rides</h2>
          {totalRides > latest.length && (
            <button type="button" className="link" onClick={onSeeAll}>
              All {totalRides} rides
            </button>
          )}
        </header>
        {latest.length === 0 ? (
          <p className="empty">No rides yet. Log your first ride to start the ledger.</p>
        ) : (
          <RideList trips={latest} members={members} currentUserId={currentUserId} actions={rideActions} />
        )}
      </section>
    </main>
  );
}
