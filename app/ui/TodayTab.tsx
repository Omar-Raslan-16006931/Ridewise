"use client";

import { useState, type TouchEvent } from "react";
import type { DaySpendingItem, computeTodayBudget } from "../../lib/analytics";
import type { Member, Trip } from "../../lib/types";
import { Meter, WeekBars } from "./charts";
import { egp, plural } from "./format";
import { Icon } from "./icons";
import { Count, Money } from "./numbers";
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
      <section className="hero">
        <p className="hero-label">{net === 0 ? "You are all square" : net > 0 ? `${otherName} owes you` : `You owe ${otherName}`}</p>
        <Money value={Math.abs(net)} roll className="num-hero" />
        {unsettledCount > 0 && (
          <button type="button" className="text-btn" onClick={onSettleUp}>
            {plural(unsettledCount, "ride")} to settle
            <Icon name="right" size={16} />
          </button>
        )}
      </section>

      <section className="panel duo">
        <div className="duo-cell">
          <span className="label">Today</span>
          {today.isCollegeDay ? (
            <>
              <span className={`duo-value ${todayOver ? "is-bad" : ""}`}>
                <Count value={Math.abs(today.todayRemaining)} />
              </span>
              <span className="label">{todayOver ? "over allowance" : `left of ${egp(today.todayBudget)}`}</span>
            </>
          ) : (
            <>
              <span className="duo-value is-quiet">Off</span>
              <span className="label">{today.nextCollegeDay ? `next ride ${today.nextCollegeDay}` : "no college"}</span>
            </>
          )}
        </div>
        <div className="duo-cell">
          <span className="label">This week</span>
          <span className={`duo-value ${week.remaining < 0 && weekOffset === 0 ? "is-bad" : ""}`}>
            <Count value={Math.abs(weekOffset === 0 ? week.remaining : week.remaining)} />
          </span>
          <span className="label">{week.remaining < 0 ? "over budget" : `left of ${egp(week.budget)}`}</span>
        </div>
      </section>

      <section className="panel pad" {...swipeHandlers}>
        <div className="panel-head">
          <div>
            <h2>{week.name}</h2>
            <p className="label">{week.label}</p>
          </div>
          <div className="stepper">
            <button type="button" className="icon-btn" onClick={() => onChangeWeek(-1)} aria-label="Previous week">
              <Icon name="left" size={20} />
            </button>
            <button type="button" className="icon-btn" onClick={() => onChangeWeek(1)} aria-label="Next week">
              <Icon name="right" size={20} />
            </button>
          </div>
        </div>
        <div key={weekOffset} className={`stack-tight ${weekSlide ? `slide-${weekSlide}` : ""}`}>
          <WeekBars days={week.days} dailyAllowance={week.dailyAllowance} selectedIso={pickedDay?.isoDate ?? null} onSelect={setPicked} />
          <Meter value={week.spent} max={Math.max(week.budget, 1)} tone={over ? "bad" : "accent"} />
          <div className="panel-foot">
            <span className="label" aria-live="polite">
              {pickedDay
                ? `${pickedDay.dayFullName}: ${pickedDay.ridesCount > 0 ? `${egp(pickedDay.actualSpend)} on ${plural(pickedDay.ridesCount, "ride")}` : "no rides"}`
                : `${egp(week.spent)} spent, ${egp(week.dailyAllowance)} a day`}
            </span>
            {weekOffset !== 0 ? (
              <button type="button" className="text-btn" onClick={onThisWeek}>
                This week
              </button>
            ) : (
              <button type="button" className="text-btn" onClick={onEditBudget}>
                Budget
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="stack-tight">
        <div className="section-head">
          <h2>Recent</h2>
          {totalRides > latest.length && (
            <button type="button" className="text-btn" onClick={onSeeAll}>
              All rides
            </button>
          )}
        </div>
        {latest.length === 0 ? (
          <p className="panel pad label center">No rides yet. Tap Log to add one.</p>
        ) : (
          <RideList trips={latest} members={members} currentUserId={currentUserId} onOpen={onOpenRide} />
        )}
      </section>
    </div>
  );
}
