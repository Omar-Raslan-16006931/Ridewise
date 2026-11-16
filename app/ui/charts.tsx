"use client";

import { useEffect, useRef } from "react";
import type { DaySpendingItem, MonthDayPoint, MonthSummary } from "../../lib/analytics";
import { egp } from "./format";

function compact(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}

/** Saturday to Friday. The dashed line is the daily allowance. */
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
  const max = Math.max(dailyAllowance * 1.08, ...days.map((d) => d.actualSpend), 1);
  return (
    <div className="chart">
      <div className="chart-plot" style={{ ["--mark" as string]: dailyAllowance > 0 ? dailyAllowance / max : 0 }}>
        {dailyAllowance > 0 && <span className="chart-mark" aria-hidden="true" />}
        {days.map((day, index) => (
          <button
            key={day.isoDate}
            type="button"
            className={`chart-col ${selectedIso === day.isoDate ? "is-selected" : ""}`}
            style={{ ["--h" as string]: day.actualSpend / max, ["--i" as string]: index }}
            onClick={() => onSelect(selectedIso === day.isoDate ? null : day)}
            aria-label={`${day.dayFullName} ${day.dateStr}: EGP ${egp(day.actualSpend)}`}
            aria-pressed={selectedIso === day.isoDate}
          >
            <span className="chart-value">{day.actualSpend > 0 ? compact(day.actualSpend) : ""}</span>
            <span className={`chart-bar ${day.actualSpend === 0 ? "is-empty" : ""} ${dailyAllowance > 0 && day.actualSpend > dailyAllowance ? "is-over" : ""}`} />
          </button>
        ))}
      </div>
      <div className="chart-axis" aria-hidden="true">
        {days.map((day) => (
          <span key={day.isoDate} className={day.isToday ? "is-today" : ""}>
            {day.dayName.slice(0, 1)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Every day of a month. */
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
    <div className="chart chart-month">
      <div className="chart-plot">
        {days.map((day, index) => (
          <button
            key={day.isoDate}
            type="button"
            className={`chart-col ${selectedIso === day.isoDate ? "is-selected" : ""}`}
            style={{ ["--h" as string]: day.amount / max, ["--i" as string]: index * 0.35 }}
            onClick={() => onSelect(selectedIso === day.isoDate ? null : day)}
            aria-label={`Day ${day.day}: EGP ${egp(day.amount)}`}
            aria-pressed={selectedIso === day.isoDate}
          >
            <span className={`chart-bar ${day.amount === 0 ? "is-empty" : ""}`} />
          </button>
        ))}
      </div>
      <div className="chart-axis" aria-hidden="true">
        {days.map((day) => (
          <span key={day.isoDate}>{day.day === 1 || day.day % 7 === 1 ? day.day : ""}</span>
        ))}
      </div>
    </div>
  );
}

/** One bar per month, newest on the right. Scrolls inside its card. */
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
    box.scrollTo({ left: Math.max(0, active.offsetLeft - (box.clientWidth - active.offsetWidth) / 2), behavior: "smooth" });
  }, [selectedKey, months.length]);

  return (
    <div className="strip no-swipe no-pull" ref={scroller}>
      {months.map((month, index) => (
        <button
          key={month.key}
          type="button"
          className={`strip-col ${month.key === selectedKey ? "is-selected" : ""}`}
          style={{ ["--h" as string]: month.mySpend / max, ["--i" as string]: Math.max(0, index - (months.length - 7)) }}
          onClick={() => onSelect(month.key)}
          aria-label={`${month.label}: EGP ${egp(month.mySpend)}`}
          aria-pressed={month.key === selectedKey}
        >
          <span className="chart-value">{month.mySpend > 0 ? compact(month.mySpend) : "0"}</span>
          <span className="chart-bar" />
          <span className="strip-name">{month.shortLabel}</span>
        </button>
      ))}
    </div>
  );
}

/** A thin progress track with an optional dashed marker. */
export function Meter({ value, max, marker, tone = "blue" }: { value: number; max: number; marker?: number | null; tone?: "blue" | "green" | "orange" | "red" }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const markerPct = marker != null && max > 0 ? Math.min(100, Math.max(0, (marker / max) * 100)) : null;
  return (
    <div className="meter" role="img" aria-label={`${Math.round(pct)}% used`}>
      <span className={`meter-fill tint-${tone}`} style={{ width: `${pct}%` }} />
      {markerPct != null && <span className="meter-marker" style={{ left: `${markerPct}%` }} />}
    </div>
  );
}
