"use client";

import { useState, type TouchEvent } from "react";
import type { DaySpendingItem, computeTodayBudget } from "../../lib/analytics";
import type { Member, Trip } from "../../lib/types";
import { Meter, WeekBars } from "./charts";
import { egp, plural } from "./format";
import { Icon } from "./icons";
import { Money } from "./numbers";
import { RideList } from "./rides";

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
  onOpenRide,
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
  onOpenRide: (trip: Trip) => void;
  onSettleUp: () => void;
  onSeeAll: () => void;
  onEditBudget: () => void;
}) {
  const [picked, setPicked] = useState<DaySpendingItem | null>(null);
  const pickedDay = picked && week.days.find((d) => d.isoDate === picked.isoDate);
  const over = week.remaining < 0;
  const todayOver = today.todayRemaining < 0;

  return (
    <div className="stack">
      <section className="glass card">
        <p className="card-label">
          {net === 0 ? "Balance" : net > 0 ? `${otherName} owes you` : `You owe ${otherName}`}
        </p>
        <Money value={Math.abs(net)} roll className={`num-hero ${net > 0 ? "tint-text-green" : net < 0 ? "tint-text-orange" : ""}`} />
        <div className="card-foot">
          <span className="secondary">{net === 0 ? "All square" : plural(unsettledCount, "unsettled ride")}</span>
          {unsettledCount > 0 && (
            <button type="button" className="pill" onClick={onSettleUp}>
              Settle up
            </button>
          )}
        </div>
      </section>

      <section className="glass card">
        <div className="card-head">
          <h2>Today</h2>
          {today.isCollegeDay && <span className="secondary">{egp(today.todayBudget)} allowance</span>}
        </div>
        {today.isCollegeDay ? (
          <>
            <div className="kpi">
              <Money value={Math.abs(today.todayRemaining)} className={`num-large ${todayOver ? "tint-text-red" : ""}`} />
              <span className="secondary">{todayOver ? "over" : "left"}</span>
            </div>
            <Meter
              value={today.todayActualSpend}
              max={Math.max(today.todayBudget, 1)}
              tone={todayOver ? "red" : today.todayPct >= 80 ? "orange" : "green"}
            />
            <p className="secondary">
              {today.todayRidesCount === 0 ? "No rides yet today." : `Spent ${egp(today.todayActualSpend)} on ${plural(today.todayRidesCount, "ride")}.`}
            </p>
          </>
        ) : (
          <p className="secondary">
            No college today.
            {today.todayActualSpend > 0 ? ` You spent EGP ${egp(today.todayActualSpend)}.` : today.nextCollegeDay ? ` Next is ${today.nextCollegeDay}.` : ""}
          </p>
        )}
      </section>

      <section className="glass card" {...swipeHandlers}>
        <div className="card-head">
          <div>
            <h2>{week.name}</h2>
            <p className="secondary small">{week.label}</p>
          </div>
          <div className="stepper">
            <button type="button" className="icon-btn" onClick={() => onChangeWeek(-1)} aria-label="Previous week">
              <Icon name="left" size={22} />
            </button>
            <button type="button" className="icon-btn" onClick={() => onChangeWeek(1)} aria-label="Next week">
              <Icon name="right" size={22} />
            </button>
          </div>
        </div>

        <div key={weekOffset} className={`stack-tight ${weekSlide ? `slide-${weekSlide}` : ""}`}>
          <WeekBars days={week.days} dailyAllowance={week.dailyAllowance} selectedIso={pickedDay?.isoDate ?? null} onSelect={setPicked} />
          <p className="secondary small center" aria-live="polite">
            {pickedDay
              ? `${pickedDay.dayFullName}, ${pickedDay.ridesCount > 0 ? `EGP ${egp(pickedDay.actualSpend)} on ${plural(pickedDay.ridesCount, "ride")}` : "no rides"}`
              : `Dashed line is your ${egp(week.dailyAllowance)} daily allowance`}
          </p>
          <div className="divider" />
          <div className="card-foot">
            <span>
              <b>{egp(week.spent)}</b> <span className="secondary">of {egp(week.budget)}</span>
            </span>
            <span className={over ? "tint-text-red" : "secondary"}>
              {over ? `${egp(Math.abs(week.remaining))} over` : `${egp(week.remaining)} left`}
            </span>
          </div>
          <Meter value={week.spent} max={Math.max(week.budget, 1)} tone={over ? "red" : "blue"} />
          <div className="card-foot">
            <button type="button" className="link" onClick={onEditBudget}>
              Edit budget
            </button>
            {weekOffset !== 0 ? (
              <button type="button" className="link" onClick={onThisWeek}>
                This week
              </button>
            ) : (
              week.daysLeft > 0 && !over && <span className="secondary small">{egp(week.perDayLeft)} a day for {plural(week.daysLeft, "day")}</span>
            )}
          </div>
        </div>
      </section>

      <section className="stack-tight">
        <div className="section-head">
          <h2>Recent</h2>
          {totalRides > latest.length && (
            <button type="button" className="link" onClick={onSeeAll}>
              See all
            </button>
          )}
        </div>
        {latest.length === 0 ? (
          <p className="glass card secondary center">No rides yet. Tap Log to add your first.</p>
        ) : (
          <RideList trips={latest} members={members} currentUserId={currentUserId} onOpen={onOpenRide} />
        )}
      </section>
    </div>
  );
}
