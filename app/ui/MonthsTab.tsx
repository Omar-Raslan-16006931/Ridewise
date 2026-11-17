"use client";

import { useMemo, useRef, useState, type TouchEvent } from "react";
import {
  BUS_BENCHMARK,
  compareWithPreviousMonth,
  compute2x2Matrix,
  personalTotal,
  projectMonthSpend,
  sharedRideSavings,
  weeklyTotal,
  type MonthDayPoint,
  type MonthSummary,
} from "../../lib/analytics";
import type { Member, Trip } from "../../lib/types";
import { DayBars, Meter, MonthStrip } from "./charts";
import { egp, formatDay, plural, whole } from "./format";
import { Icon } from "./icons";
import { Count, Money } from "./numbers";
import { RideList } from "./rides";
import { Segmented } from "./Segmented";

function Rows({ rows }: { rows: { label: string; sub?: string; value: string }[] }) {
  return (
    <div className="panel list">
      {rows.map((row) => (
        <div key={row.label} className="row row-static">
          <span className="row-text">
            <span className="row-title">{row.label}</span>
            {row.sub && <span className="row-sub">{row.sub}</span>}
          </span>
          <span className="row-value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Four figures in one panel, split by hairlines. */
function Quad({ items }: { items: { label: string; value: number; format?: (n: number) => string }[] }) {
  return (
    <div className="panel quad">
      {items.map((item) => (
        <div key={item.label} className="quad-cell">
          <span className="label">{item.label}</span>
          <span className="quad-value">
            <Count value={item.value} format={item.format} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function MonthsTab({
  months,
  trips,
  weeklyBudget,
  members,
  currentUserId,
  otherName,
  otherId,
  onOpenRide,
  onEditBudget,
}: {
  months: MonthSummary[];
  trips: Trip[];
  weeklyBudget: number;
  members: Member[];
  currentUserId: string;
  otherName: string;
  otherId: string | null;
  onOpenRide: (trip: Trip) => void;
  onEditBudget: () => void;
}) {
  const [view, setView] = useState<"month" | "all">("month");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [slide, setSlide] = useState<"next" | "prev" | null>(null);
  const [pickedDay, setPickedDay] = useState<MonthDayPoint | null>(null);
  const [showAll, setShowAll] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const found = months.findIndex((m) => m.key === selectedKey);
  const index = found >= 0 ? found : months.length - 1;
  const month = months[index];
  const previous = index > 0 ? months[index - 1] : null;

  function select(key: string) {
    const next = months.findIndex((m) => m.key === key);
    if (next < 0 || next === index) return;
    setSlide(next > index ? "next" : "prev");
    setSelectedKey(key);
    setPickedDay(null);
    setShowAll(false);
  }
  const step = (delta: number) => months[index + delta] && select(months[index + delta].key);

  const swipe = {
    onTouchStart: (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      touchStart.current = target.closest(".no-swipe") ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      step(dx < 0 ? 1 : -1);
    },
  };

  const comparison = compareWithPreviousMonth(month, previous);
  const projection = projectMonthSpend(month);
  const limit = weeklyBudget * 4;
  const overLimit = limit > 0 && month.mySpend > limit;
  const paceOver = month.isCurrent && limit > 0 && projection.projected > limit;
  const monthName = month.label.split(" ")[0];

  let trendText = "First month on record";
  let trendTone = "";
  let trendIcon: string | null = null;
  if (comparison) {
    const less = comparison.diff < 0;
    const flat = Math.abs(comparison.diff) < 0.5;
    trendTone = flat ? "" : less ? "tint-text-green" : "tint-text-red";
    trendIcon = flat ? null : less ? "downTrend" : "up";
    trendText = flat
      ? `Same as ${previous?.shortLabel}`
      : comparison.samePoint
      ? `${egp(Math.abs(comparison.diff))} ${less ? "less" : "more"} than ${previous?.shortLabel} at this point`
      : `${Math.abs(comparison.pct).toFixed(0)}% ${less ? "less" : "more"} than ${previous?.shortLabel}`;
  } else if (previous) {
    trendText = `No rides in ${previous.shortLabel} to compare`;
  }

  const allTime = useMemo(() => {
    const withRides = months.filter((m) => m.myRides > 0);
    const mySpend = personalTotal(trips, currentUserId);
    const groupSpend = weeklyTotal(trips);
    const sorted = [...withRides].sort((a, b) => b.mySpend - a.mySpend);
    return {
      mySpend,
      otherSpend: otherId ? personalTotal(trips, otherId) : 0,
      groupSpend,
      myRides: trips.filter((t) => t.trip_mode === "shared" || t.solo_by === currentUserId).length,
      monthsWithRides: withRides.length,
      avgMonth: withRides.length > 0 ? mySpend / withRides.length : 0,
      highest: sorted[0] ?? null,
      lowest: sorted.length > 1 ? sorted[sorted.length - 1] : null,
      saved: sharedRideSavings(trips),
      matrix: compute2x2Matrix(trips),
      since: withRides[0]?.label ?? null,
    };
  }, [months, trips, currentUserId, otherId]);

  const visibleRides = showAll ? month.trips : month.trips.slice(0, 5);

  return (
    <div className="stack">
      <Segmented
        label="Period"
        value={view}
        onChange={setView}
        options={[
          { value: "month", label: "By month" },
          { value: "all", label: "All time" },
        ]}
      />

      {view === "month" ? (
        <>
          <div key={month.key} className={`stack ${slide ? `slide-${slide}` : ""}`} {...swipe}>
            <section className="hero">
              <div className="hero-row">
                <p className="hero-label">{month.label}</p>
                <div className="stepper">
                  <button type="button" className="icon-btn" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous month">
                    <Icon name="left" size={20} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => step(1)} disabled={index === months.length - 1} aria-label="Next month">
                    <Icon name="right" size={20} />
                  </button>
                </div>
              </div>
              <Money value={month.mySpend} roll className="num-hero" />
              <p className={`trend ${trendTone}`}>
                {trendIcon && <Icon name={trendIcon} size={16} />}
                {trendText}
              </p>
            </section>
          </div>

          <section className="panel strip-panel">
            <MonthStrip months={months} selectedKey={month.key} onSelect={select} />
            {limit > 0 && (
              <div className="strip-foot">
                <Meter
                  value={month.mySpend}
                  max={limit}
                  marker={month.isCurrent && month.mySpend > 0 ? projection.projected : null}
                  tone={overLimit ? "bad" : paceOver ? "warn" : "accent"}
                />
                <div className="panel-foot">
                  <span className="label">
                    {month.isCurrent && month.mySpend > 0
                      ? `On pace for ${egp(projection.projected)} of ${egp(limit)}`
                      : `${Math.round((month.mySpend / limit) * 100)}% of the ${egp(limit)} budget`}
                  </span>
                  <button type="button" className="text-btn" onClick={onEditBudget}>
                    Budget
                  </button>
                </div>
              </div>
            )}
          </section>

          {month.myRides === 0 ? (
            <p className="panel pad label center">No rides in {monthName}.</p>
          ) : (
            <>
              <Quad
                items={[
                  { label: "Rides", value: month.myRides, format: whole },
                  { label: "Days ridden", value: month.activeDays, format: whole },
                  { label: "Per ride", value: month.avgPerRide },
                  { label: "Saved by sharing", value: month.sharingSaved },
                ]}
              />

              <section className="panel pad">
                <div className="panel-head">
                  <h2>Each day</h2>
                </div>
                <DayBars days={month.days} selectedIso={pickedDay?.isoDate ?? null} onSelect={setPickedDay} />
                <p className="label center" aria-live="polite">
                  {pickedDay
                    ? `${formatDay(new Date(month.year, month.month, pickedDay.day))}: ${pickedDay.rides > 0 ? `${egp(pickedDay.amount)} on ${plural(pickedDay.rides, "ride")}` : "no rides"}`
                    : "Tap a bar to see that day"}
                </p>
              </section>

              <section className="stack-tight">
                <div className="section-head">
                  <h2>Breakdown</h2>
                </div>
                <Rows
                  rows={[
                    { label: "To campus", sub: plural(month.campusRides, "ride"), value: egp(month.campusSpend) },
                    { label: "Back home", sub: plural(month.homeRides, "ride"), value: egp(month.homeSpend) },
                    { label: "Your half of shared", sub: plural(month.sharedRides, "ride"), value: egp(month.mySharedSpend) },
                    { label: "Your solo rides", sub: plural(month.soloRides, "ride"), value: egp(month.mySoloSpend) },
                    { label: "You paid Uber", sub: "full fares, up front", value: egp(month.paidByMe) },
                    { label: `${otherName} paid Uber`, sub: "full fares, up front", value: egp(month.paidByOthers) },
                  ]}
                />
              </section>

              <section className="stack-tight">
                <div className="section-head">
                  <h2>Rides</h2>
                  <span className="label">{month.trips.length}</span>
                </div>
                <RideList
                  trips={visibleRides}
                  members={members}
                  currentUserId={currentUserId}
                  onOpen={onOpenRide}
                  footer={
                    month.trips.length > 5 ? (
                      <button type="button" className="row row-more" onClick={() => setShowAll(!showAll)}>
                        {showAll ? "Show fewer" : `Show all ${month.trips.length}`}
                      </button>
                    ) : null
                  }
                />
              </section>
            </>
          )}
        </>
      ) : (
        <div className="stack">
          <section className="hero">
            <p className="hero-label">Since {allTime.since ?? "the start"}</p>
            <Money value={allTime.mySpend} roll className="num-hero" />
            <p className="trend">
              {plural(allTime.myRides, "ride")} over {plural(allTime.monthsWithRides, "month")}
            </p>
          </section>

          <Quad
            items={[
              { label: "Average month", value: allTime.avgMonth },
              { label: "Saved by sharing", value: allTime.saved },
              ...(allTime.highest ? [{ label: `Highest, ${allTime.highest.shortLabel}`, value: allTime.highest.mySpend }] : []),
              ...(allTime.lowest ? [{ label: `Lowest, ${allTime.lowest.shortLabel}`, value: allTime.lowest.mySpend }] : []),
            ]}
          />

          <section className="panel pad">
            <div className="panel-head">
              <h2>Bus pass</h2>
              <span className="label">{egp(BUS_BENCHMARK)}</span>
            </div>
            <Meter value={allTime.groupSpend} max={BUS_BENCHMARK} tone={allTime.groupSpend > BUS_BENCHMARK ? "bad" : "good"} />
            <p className="label">
              Together you have spent {egp(allTime.groupSpend)}, {((allTime.groupSpend / BUS_BENCHMARK) * 100).toFixed(0)}% of the pass.{" "}
              {allTime.groupSpend > BUS_BENCHMARK ? `${egp(allTime.groupSpend - BUS_BENCHMARK)} over.` : `${egp(BUS_BENCHMARK - allTime.groupSpend)} still under.`}
            </p>
          </section>

          <section className="stack-tight">
            <div className="section-head">
              <h2>Who spent what</h2>
            </div>
            <Rows
              rows={[
                { label: "You", sub: "your share of every ride", value: egp(allTime.mySpend) },
                { label: otherName, sub: "their share of every ride", value: egp(allTime.otherSpend) },
                { label: "To campus, shared", sub: plural(allTime.matrix.toCampus.shared.count, "ride"), value: egp(allTime.matrix.toCampus.shared.spend) },
                { label: "To campus, solo", sub: plural(allTime.matrix.toCampus.solo.count, "ride"), value: egp(allTime.matrix.toCampus.solo.spend) },
                { label: "Back home, shared", sub: plural(allTime.matrix.backHome.shared.count, "ride"), value: egp(allTime.matrix.backHome.shared.spend) },
                { label: "Back home, solo", sub: plural(allTime.matrix.backHome.solo.count, "ride"), value: egp(allTime.matrix.backHome.solo.spend) },
              ]}
            />
          </section>
        </div>
      )}
    </div>
  );
}
