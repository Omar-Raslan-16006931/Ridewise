"use client";

import { useEffect, useRef, useState } from "react";
import { egp } from "./format";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fare-meter number: every digit is a column that rolls to its value.
 * Digits are keyed from the right so 980 rolling to 1,020 keeps its units and tens in place.
 */
export function Roll({ value, className = "" }: { value: number; className?: string }) {
  const text = egp(Math.abs(value));
  const [live, setLive] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const chars = text.split("");
  return (
    <span className={`roll ${className}`} role="img" aria-label={text}>
      {chars.map((char, index) => {
        const fromRight = chars.length - index;
        if (!/\d/.test(char)) {
          return (
            <span key={`sep-${fromRight}`} className="roll-sep" aria-hidden="true">
              {char}
            </span>
          );
        }
        return (
          <span key={`digit-${fromRight}`} className="roll-digit" aria-hidden="true">
            <span
              className="roll-strip"
              style={{
                transform: `translateY(-${(live ? Number(char) : 0) * 10}%)`,
                transitionDelay: `${Math.min(fromRight, 7) * 40}ms`,
              }}
            >
              {DIGITS.map((digit) => (
                <span key={digit}>{digit}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Counts from the previous value to the new one. For secondary figures. */
export function Count({
  value,
  format = egp,
  duration = 700,
}: {
  value: number;
  format?: (value: number) => string;
  duration?: number;
}) {
  const [shown, setShown] = useState(0);
  const [settled, setSettled] = useState(false);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (prefersReducedMotion() || from === value) {
      fromRef.current = value;
      setShown(value);
      setSettled(true);
      return;
    }
    let frame = 0;
    const started = performance.now();
    setSettled(false);
    const step = (time: number) => {
      const t = Math.min(1, (time - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (value - from) * eased;
      fromRef.current = current;
      setShown(current);
      if (t < 1) frame = requestAnimationFrame(step);
      else {
        fromRef.current = value;
        setShown(value);
        setSettled(true);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  // Whole numbers while moving, so piastres do not flicker.
  return <span className="count">{format(settled ? shown : Math.round(shown))}</span>;
}

/** Amount with a small currency code in front. */
export function Money({ value, roll = false, className = "" }: { value: number; roll?: boolean; className?: string }) {
  return (
    <span className={`money ${className}`}>
      <span className="money-code">EGP</span>
      {roll ? <Roll value={value} /> : <Count value={value} />}
    </span>
  );
}
