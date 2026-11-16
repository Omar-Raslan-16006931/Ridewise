"use client";

import { useEffect, useRef } from "react";
import type { DaySpendingItem, MonthDayPoint, MonthSummary } from "../../lib/analytics";
import { egp } from "./format";

function compact(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}

/** Saturday to Friday, one bar per day, with the daily allowance drawn across. */
export function WeekBars({
  days,
  dailyAllowance,
  selectedIso,
  onSelect,
}: {
  days: DaySpendingItem[];
  dailyAllowance: number;
  selectedIso: string | null;
  onSelect: (day: DaySpendingItem | null) => void;
}) {
  const max = Math.max(dailyAllowance * 1.15, ...days.map((d) => d.actualSpend), 1);
  return (
    <div className="bars bars-week no-swipe-y">
      <div className="bars-plot" style={{ ["--mark" as string]: dailyAllowance > 0 ? dailyAllowance / max : 0 }}>
        {dailyAllowance > 0 && (
          <span className="bars-mark">
            <em>{egp(dailyAllowance)} a day</em>
          </span>
        )}
        {days.map((day, index) => (
          <button
            key={day.isoDate}
            type="button"
            className={`bar-col ${day.isToday ? "is-today" : ""} ${selectedIso === day.isoDate ? "is-selected" : ""}`}
            style={{ ["--h" as string]: day.actualSpend / max, ["--i" as string]: index }}
            onClick={() => onSelect(selectedIso === day.isoDate ? null : day)}
            aria-label={`${day.dayFullName} ${day.dateStr}: EGP ${egp(day.actualSpend)}, ${day.ridesCount} rides`}
            aria-pressed={selectedIso === day.isoDate}
          >
            <span className="bar-value">{day.actualSpend > 0 ? compact(day.actualSpend) : ""}</span>
            <span className={`bar ${day.actualSpend > dailyAllowance && dailyAllowance > 0 ? "is-over" : ""}`}>
              {day.homeSpend > 0 && <i className="seg seg-home" style={{ flexGrow: day.homeSpend }} />}
              {day.campusSpend > 0 && <i className="seg seg-campus" style={{ flexGrow: day.campusSpend }} />}
            </span>
          </button>
        ))}
      </div>
      <div className="bars-axis" aria-hidden="true">
        {days.map((day) => (
          <span key={day.isoDate} className={`axis-day ${day.isToday ? "is-today" : ""}`}>
            <b>{day.dayName}</b>
            {day.dayNum}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Every day of a month as a thin bar. */
export function DayBars({
  days,
  selectedIso,
  onSelect,
}: {
  days: MonthDayPoint[];
  selectedIso: string | null;
  onSelect: (day: MonthDayPoint | null) => void;
}) {
  const max = Math.max(...days.map((d) => d.amount), 1);
  return (
    <div className="bars bars-month no-swipe">
      <div className="bars-plot">
        {days.map((day, index) => (
          <button
            key={day.isoDate}
            type="button"
            className={`bar-col ${day.isToday ? "is-today" : ""} ${day.isFuture ? "is-future" : ""} ${selectedIso === day.isoDate ? "is-selected" : ""}`}
            style={{ ["--h" as string]: day.amount / max, ["--i" as string]: index * 0.4 }}
            onClick={() => onSelect(selectedIso === day.isoDate ? null : day)}
            aria-label={`Day ${day.day}: EGP ${egp(day.amount)}, ${day.rides} rides`}
            aria-pressed={selectedIso === day.isoDate}
          >
            <span className="bar">
              {day.homeAmount > 0 && <i className="seg seg-home" style={{ flexGrow: day.homeAmount }} />}
              {day.campusAmount > 0 && <i className="seg seg-campus" style={{ flexGrow: day.campusAmount }} />}
            </span>
          </button>
        ))}
      </div>
      <div className="bars-axis" aria-hidden="true">
        {days.map((day) => (
          <span key={day.isoDate} className="axis-tick">
            {day.day === 1 || day.day % 7 === 1 ? day.day : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The month timeline: one bar per month, newest on the right, tap to open a month. */
export function MonthStrip({
  months,
  selectedKey,
  onSelect,
}: {
  months: MonthSummary[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const max = Math.max(...months.map((m) => m.mySpend), 1);

  useEffect(() => {
    const box = scroller.current;
    const active = box?.querySelector<HTMLElement>(".is-selected");
    if (!box || !active) return;
    const target = active.offsetLeft - (box.clientWidth - active.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [selectedKey, months.length]);

  return (
    <div className="month-strip no-swipe no-pull" ref={scroller}>
      {months.map((month, index) => (
        <button
          key={month.key}
          type="button"
          className={`month-col ${month.key === selectedKey ? "is-selected" : ""}`}
          style={{ ["--h" as string]: month.mySpend / max, ["--i" as string]: Math.max(0, index - (months.length - 8)) }}
          onClick={() => onSelect(month.key)}
          aria-label={`${month.label}: EGP ${egp(month.mySpend)}`}
          aria-pressed={month.key === selectedKey}
        >
          <span className="bar-value">{month.mySpend > 0 ? compact(month.mySpend) : "0"}</span>
          <span className="bar" />
          <span className="month-name">
            {month.shortLabel}
            {(month.month === 0 || index === 0) && <small>{String(month.year).slice(2)}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

export type SplitPart = { label: string; value: number; detail: string; tone: "campus" | "home" | "ink" | "soft" };

/** Two or more parts of one total, as a single bar with a labelled row per part. */
export function SplitBar({ parts }: { parts: SplitPart[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="split">
      <div className="split-bar" aria-hidden="true">
        {total > 0 ? (
          parts.filter((part) => part.value > 0).map((part) => (
            <i key={part.label} className={`tone-${part.tone}`} style={{ flexGrow: part.value }} />
          ))
        ) : (
          <i className="tone-empty" style={{ flexGrow: 1 }} />
        )}
      </div>
      <ul className="split-rows">
        {parts.map((part) => (
          <li key={part.label}>
            <i className={`dot tone-${part.tone}`} aria-hidden="true" />
            <span className="split-label">{part.label}</span>
            <span className="split-detail">{part.detail}</span>
            <span className="split-value">
              {egp(part.value)}
              <small>{total > 0 ? `${Math.round((part.value / total) * 100)}%` : "0%"}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A filled track with an optional marker (for a pace or an estimate). */
export function Meter({
  value,
  max,
  marker,
  tone = "ink",
}: {
  value: number;
  max: number;
  marker?: number | null;
  tone?: "ink" | "good" | "warn" | "bad";
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const markerPct = marker != null && max > 0 ? Math.min(100, Math.max(0, (marker / max) * 100)) : null;
  return (
    <div className="meter" role="img" aria-label={`${Math.round(pct)}% used`}>
      <span className={`meter-fill tone-${tone}`} style={{ width: `${pct}%` }} />
      {markerPct != null && <span className="meter-marker" style={{ left: `${markerPct}%` }} />}
    </div>
  );
}
