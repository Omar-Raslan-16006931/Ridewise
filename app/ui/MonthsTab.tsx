"use client";

import { useMemo, useRef, useState, type TouchEvent } from "react";
import {
  BUS_BENCHMARK,
  compareWithPreviousMonth,
  compute2x2Matrix,
  memberTripSpend,
  personalTotal,
  projectMonthSpend,
  sharedRideSavings,
  weeklyTotal,
  type MonthDayPoint,
  type MonthSummary,
} from "../../lib/analytics";
import type { Member, Trip } from "../../lib/types";
import { DayBars, Meter, MonthStrip, SplitBar } from "./charts";
import { egp, formatDay, plural, whole } from "./format";
import { Icon } from "./icons";
import { Count, Money } from "./numbers";
import { RideList, type RideActions } from "./rides";

export function MonthsTab({
  months,
  trips,
  weeklyBudget,
  members,
  currentUserId,
  otherName,
  otherId,
  rideActions,
  onEditBudget,
}: {
  /** Oldest first, always ends with the current month. */
  months: MonthSummary[];
  trips: Trip[];
  weeklyBudget: number;
  members: Member[];
  currentUserId: string;
  otherName: string;
  otherId: string | null;
  rideActions: RideActions;
  onEditBudget: () => void;
}) {
  const [view, setView] = useState<"month" | "all">("month");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [slide, setSlide] = useState<"next" | "prev" | null>(null);
  const [pickedDay, setPickedDay] = useState<MonthDayPoint | null>(null);
  const [showRides, setShowRides] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const foundIndex = months.findIndex((m) => m.key === selectedKey);
  const index = foundIndex >= 0 ? foundIndex : months.length - 1;
  const month = months[index];
  const previous = index > 0 ? months[index - 1] : null;

  function select(key: string) {
    const nextIndex = months.findIndex((m) => m.key === key);
    if (nextIndex < 0 || nextIndex === index) return;
    setSlide(nextIndex > index ? "next" : "prev");
    setSelectedKey(key);
    setPickedDay(null);
    setShowRides(false);
  }
  function step(delta: number) {
    const target = months[index + delta];
    if (target) select(target.key);
  }

  const swipe = {
    onTouchStart: (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      touchStart.current = target.closest(".no-swipe, input, select, textarea") ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
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
  const paceOver = limit > 0 && projection.projected > limit;
  const today = new Date().getDate();
  const monthName = month.label.split(" ")[0];

  let comparisonText = "First month on record.";
  let comparisonTone = "";
  if (comparison) {
    const less = comparison.diff < 0;
    comparisonTone = Math.abs(comparison.diff) < 0.5 ? "" : less ? "is-good" : "is-bad";
    comparisonText =
      Math.abs(comparison.diff) < 0.5
        ? `Same as ${previous?.shortLabel}.`
        : comparison.samePoint
        ? `EGP ${egp(Math.abs(comparison.diff))} ${less ? "less" : "more"} than by ${today} ${previous?.shortLabel}`
        : `${Math.abs(comparison.pct).toFixed(0)}% ${less ? "less" : "more"} than ${previous?.label.split(" ")[0]}`;
  } else if (previous) {
    comparisonText = `No rides in ${previous.label.split(" ")[0]} to compare with.`;
  }

  const allTime = useMemo(() => {
    const withRides = months.filter((m) => m.myRides > 0);
    const mySpend = personalTotal(trips, currentUserId);
    const groupSpend = weeklyTotal(trips);
    const sharedSpend = weeklyTotal(trips.filter((t) => t.trip_mode === "shared"));
    const byHigh = [...withRides].sort((a, b) => b.mySpend - a.mySpend);
    return {
      mySpend,
      otherSpend: otherId ? personalTotal(trips, otherId) : 0,
      groupSpend,
      sharedSpend,
      soloSpend: groupSpend - sharedSpend,
      myRides: trips.filter((t) => t.trip_mode === "shared" || t.solo_by === currentUserId).length,
      monthsWithRides: withRides.length,
      avgMonth: withRides.length > 0 ? mySpend / withRides.length : 0,
      highest: byHigh[0] ?? null,
      lowest: byHigh.length > 1 ? byHigh[byHigh.length - 1] : null,
      saved: sharedRideSavings(trips),
      matrix: compute2x2Matrix(trips),
      since: withRides[0]?.label ?? null,
    };
  }, [months, trips, currentUserId, otherId]);

  return (
    <main className="tab">
      <h1 className="page-title">Months</h1>
      <div className="segmented no-swipe" role="tablist" aria-label="Period">
        <button type="button" role="tab" aria-selected={view === "month"} className={view === "month" ? "is-on" : ""} onClick={() => setView("month")}>
          Month by month
        </button>
        <button type="button" role="tab" aria-selected={view === "all"} className={view === "all" ? "is-on" : ""} onClick={() => setView("all")}>
          All time
        </button>
      </div>

      {view === "month" ? (
        <>
          <section className="card card-flush">
            <MonthStrip months={months} selectedKey={month.key} onSelect={select} />
          </section>

          <div key={month.key} className={`stack ${slide ? `slide-${slide}` : ""}`} {...swipe}>
            <section className="card">
              <header className="card-head">
                <h2>{month.label}</h2>
                <div className="stepper">
                  <button type="button" className="icon-btn" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous month">
                    <Icon name="left" />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => step(1)} disabled={index === months.length - 1} aria-label="Next month">
                    <Icon name="right" />
                  </button>
                </div>
              </header>

              <p className="figure figure-big">
                <Money value={month.mySpend} roll />
                <span className="figure-unit">your share{month.isCurrent ? " so far" : ""}</span>
              </p>
              <p className={`trend ${comparisonTone}`}>
                {comparison && Math.abs(comparison.diff) >= 0.5 && <Icon name={comparison.diff < 0 ? "downTrend" : "up"} size={16} />}
                {comparisonText}
              </p>

              {limit > 0 && (
                <div className="budget-block">
                  <Meter
                    value={month.mySpend}
                    max={limit}
                    marker={month.isCurrent && month.mySpend > 0 ? projection.projected : null}
                    tone={overLimit ? "bad" : paceOver && month.isCurrent ? "warn" : "ink"}
                  />
                  <div className="between">
                    <span className="note">
                      {Math.round((month.mySpend / limit) * 100)}% of the EGP {egp(limit)} monthly budget
                    </span>
                    <button type="button" className="link" onClick={onEditBudget}>
                      Change
                    </button>
                  </div>
                  {month.isCurrent && month.mySpend > 0 ? (
                    <p className={`note ${paceOver ? "is-bad" : ""}`}>
                      On pace to finish {monthName} at <b>EGP {egp(projection.projected)}</b>
                      {paceOver
                        ? `, EGP ${egp(projection.projected - limit)} over budget.`
                        : `, EGP ${egp(limit - projection.projected)} under budget.`}{" "}
                      {projection.elapsedCollegeDays} of {projection.totalCollegeDays} college days gone.
                    </p>
                  ) : !month.isCurrent && month.myRides > 0 ? (
                    <p className={`note ${overLimit ? "is-bad" : ""}`}>
                      {overLimit
                        ? `Finished EGP ${egp(month.mySpend - limit)} over budget.`
                        : `Finished EGP ${egp(limit - month.mySpend)} under budget.`}
                    </p>
                  ) : null}
                </div>
              )}
            </section>

            {month.myRides === 0 ? (
              <p className="empty">No rides in {monthName}.</p>
            ) : (
              <>
                <dl className="stats">
                  <div>
                    <dt>Rides</dt>
                    <dd><Count value={month.myRides} format={whole} /></dd>
                  </div>
                  <div>
                    <dt>Days ridden</dt>
                    <dd><Count value={month.activeDays} format={whole} /></dd>
                  </div>
                  <div>
                    <dt>Per ride</dt>
                    <dd><Count value={month.avgPerRide} /></dd>
                  </div>
                  <div>
                    <dt>Per day</dt>
                    <dd><Count value={month.avgPerActiveDay} /></dd>
                  </div>
                </dl>

                <section className="card">
                  <header className="card-head">
                    <h2>Day by day</h2>
                    <span className="card-aside legend">
                      <i className="dot tone-campus" aria-hidden="true" /> Campus
                      <i className="dot tone-home" aria-hidden="true" /> Home
                    </span>
                  </header>
                  <DayBars days={month.days} selectedIso={pickedDay?.isoDate ?? null} onSelect={setPickedDay} />
                  <p className="chart-note" aria-live="polite">
                    {pickedDay ? (
                      <>
                        <b>{formatDay(new Date(month.year, month.month, pickedDay.day))}</b>
                        {pickedDay.rides > 0 ? ` EGP ${egp(pickedDay.amount)} over ${plural(pickedDay.rides, "ride")}` : " No rides"}
                      </>
                    ) : (
                      "Tap a bar to see that day."
                    )}
                  </p>
                </section>

                <section className="card">
                  <header className="card-head">
                    <h2>Where it went</h2>
                  </header>
                  <SplitBar
                    parts={[
                      { label: "To campus", value: month.campusSpend, detail: plural(month.campusRides, "ride"), tone: "campus" },
                      { label: "Back home", value: month.homeSpend, detail: plural(month.homeRides, "ride"), tone: "home" },
                    ]}
                  />
                  <hr />
                  <SplitBar
                    parts={[
                      { label: "Your half of shared", value: month.mySharedSpend, detail: plural(month.sharedRides, "ride"), tone: "ink" },
                      { label: "Your solo rides", value: month.mySoloSpend, detail: plural(month.soloRides, "ride"), tone: "soft" },
                    ]}
                  />
                </section>

                <section className="card">
                  <header className="card-head">
                    <h2>Who paid Uber</h2>
                    <span className="card-aside">EGP {egp(month.groupSpend)} in total</span>
                  </header>
                  <SplitBar
                    parts={[
                      { label: "You", value: month.paidByMe, detail: "paid up front", tone: "ink" },
                      { label: otherName, value: month.paidByOthers, detail: "paid up front", tone: "soft" },
                    ]}
                  />
                </section>

                <section className="card">
                  <header className="card-head">
                    <h2>Worth knowing</h2>
                  </header>
                  <dl className="rows">
                    {month.biggestRide && (
                      <div>
                        <dt>Priciest ride</dt>
                        <dd>
                          EGP {egp(memberTripSpend(month.biggestRide, currentUserId))}
                          <small>
                            {month.biggestRide.direction === "campus" ? "To campus" : "Back home"}, {formatDay(month.biggestRide.ride_at)}
                          </small>
                        </dd>
                      </div>
                    )}
                    {month.busiestDay && (
                      <div>
                        <dt>Costliest day</dt>
                        <dd>
                          EGP {egp(month.busiestDay.amount)}
                          <small>{formatDay(new Date(month.year, month.month, month.busiestDay.day))}</small>
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Saved by sharing</dt>
                      <dd>
                        EGP {egp(month.sharingSaved)}
                        <small>compared with riding alone</small>
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="plain">
                  <button type="button" className="btn btn-quiet btn-wide" onClick={() => setShowRides(!showRides)} aria-expanded={showRides}>
                    {showRides ? "Hide rides" : `Show all ${plural(month.trips.length, "ride")} in ${monthName}`}
                    <Icon name="down" size={18} className={showRides ? "is-flipped" : ""} />
                  </button>
                  {showRides && <RideList trips={month.trips} members={members} currentUserId={currentUserId} actions={rideActions} />}
                </section>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="stack">
          <section className="card">
            <header className="card-head">
              <h2>Since {allTime.since ?? "the start"}</h2>
            </header>
            <p className="figure figure-big">
              <Money value={allTime.mySpend} roll />
              <span className="figure-unit">your share</span>
            </p>
            <p className="note">
              {plural(allTime.myRides, "ride")} over {plural(allTime.monthsWithRides, "month")}. Together you spent EGP {egp(allTime.groupSpend)}.
            </p>
          </section>

          <dl className="stats">
            <div>
              <dt>Average month</dt>
              <dd><Count value={allTime.avgMonth} /></dd>
            </div>
            <div>
              <dt>Saved by sharing</dt>
              <dd><Count value={allTime.saved} /></dd>
            </div>
            {allTime.highest && (
              <div>
                <dt>Highest, {allTime.highest.shortLabel} {allTime.highest.year}</dt>
                <dd><Count value={allTime.highest.mySpend} /></dd>
              </div>
            )}
            {allTime.lowest && (
              <div>
                <dt>Lowest, {allTime.lowest.shortLabel} {allTime.lowest.year}</dt>
                <dd><Count value={allTime.lowest.mySpend} /></dd>
              </div>
            )}
          </dl>

          <section className="card">
            <header className="card-head">
              <h2>Against the bus pass</h2>
              <span className="card-aside">EGP {egp(BUS_BENCHMARK)}</span>
            </header>
            <p className="figure">
              <Money value={Math.abs(BUS_BENCHMARK - allTime.groupSpend)} className={allTime.groupSpend > BUS_BENCHMARK ? "is-bad" : ""} />
              <span className="figure-unit">{allTime.groupSpend > BUS_BENCHMARK ? "over the bus pass" : "still under the bus pass"}</span>
            </p>
            <Meter value={allTime.groupSpend} max={BUS_BENCHMARK} tone={allTime.groupSpend > BUS_BENCHMARK ? "bad" : "ink"} />
            <p className="note">
              You two have spent {((allTime.groupSpend / BUS_BENCHMARK) * 100).toFixed(1)}% of what the university bus would cost.
            </p>
            <hr />
            <SplitBar
              parts={[
                { label: "You", value: allTime.mySpend, detail: `${((allTime.mySpend / BUS_BENCHMARK) * 100).toFixed(1)}% of the pass`, tone: "ink" },
                { label: otherName, value: allTime.otherSpend, detail: `${((allTime.otherSpend / BUS_BENCHMARK) * 100).toFixed(1)}% of the pass`, tone: "soft" },
              ]}
            />
          </section>

          <section className="card">
            <header className="card-head">
              <h2>Every ride, by kind</h2>
              <span className="card-aside">full fares</span>
            </header>
            <table className="grid-table">
              <thead>
                <tr>
                  <td />
                  <th scope="col">Shared</th>
                  <th scope="col">Solo</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">To campus</th>
                  <td>
                    {egp(allTime.matrix.toCampus.shared.spend)}
                    <small>{plural(allTime.matrix.toCampus.shared.count, "ride")}</small>
                  </td>
                  <td>
                    {egp(allTime.matrix.toCampus.solo.spend)}
                    <small>{plural(allTime.matrix.toCampus.solo.count, "ride")}</small>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Back home</th>
                  <td>
                    {egp(allTime.matrix.backHome.shared.spend)}
                    <small>{plural(allTime.matrix.backHome.shared.count, "ride")}</small>
                  </td>
                  <td>
                    {egp(allTime.matrix.backHome.solo.spend)}
                    <small>{plural(allTime.matrix.backHome.solo.count, "ride")}</small>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      )}
    </main>
  );
}
