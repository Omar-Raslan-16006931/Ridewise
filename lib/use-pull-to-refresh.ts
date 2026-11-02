"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** How far (px) the content must be pulled before letting go triggers a refresh. */
export const PULL_THRESHOLD = 72;
/** Where the content rests while the refresh runs. */
const PULL_HOLD = 56;
/** Furthest the content can be dragged. */
const PULL_MAX = 130;
/** Keep the spinner up at least this long so a fast refresh still reads as one. */
const MIN_SPIN_MS = 650;
/** Release / settle animation. */
const SETTLE = "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)";
const INDICATOR_SETTLE = "transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms ease";
/** Arc length of the spinner circle (2πr, r = 9). */
const ARC = 56.5;

export type PullRefs = {
  contentRef: RefObject<HTMLDivElement | null>;
  indicatorRef: RefObject<HTMLDivElement | null>;
  arcRef: RefObject<SVGCircleElement | null>;
  /** True while onRefresh is running (the only state that re-renders the page). */
  refreshing: boolean;
};

/**
 * Pull-to-refresh for the whole page.
 *
 * Smoothness: the drag never touches React state. Each finger move only records the distance,
 * and one requestAnimationFrame per screen frame writes a GPU transform straight onto the content
 * and the spinner. React re-renders only when a refresh starts and ends.
 *
 * Starts only at the very top of the page, for a mostly vertical downward drag, while `enabled`.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>, enabled: boolean): PullRefs {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const arcRef = useRef<SVGCircleElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let distance = 0;
    let frame = 0;
    let armed = false;

    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    /** Writes the current position to the DOM. `animate` eases into it instead of following the finger. */
    const paint = (value: number, animate: boolean, spinning = false) => {
      const content = contentRef.current;
      const indicator = indicatorRef.current;
      const arc = arcRef.current;
      const progress = Math.min(1, value / PULL_THRESHOLD);
      if (content) {
        content.style.transition = animate ? SETTLE : "none";
        content.style.transform = value > 0 ? `translate3d(0, ${value}px, 0)` : "";
      }
      if (indicator) {
        indicator.style.transition = animate ? INDICATOR_SETTLE : "none";
        indicator.style.transform = `translate3d(-50%, ${value - 44}px, 0) scale(${0.6 + progress * 0.4})`;
        indicator.style.opacity = String(spinning ? 1 : progress);
        indicator.classList.toggle("armed", progress >= 1);
      }
      if (arc && !spinning) {
        arc.style.strokeDasharray = `${ARC * 0.92 * progress} ${ARC}`;
        arc.style.transform = `rotate(${progress * 270 - 90}deg)`;
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint(distance, false);
      });
    };

    const onStart = (event: TouchEvent) => {
      if (busyRef.current || event.touches.length !== 1 || !atTop()) {
        start = null;
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest("input, select, textarea, .no-pull")) {
        start = null;
        return;
      }
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      pulling = false;
      distance = 0;
      armed = false;
    };

    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (!pulling) {
        // Decide once: a downward, mostly vertical drag at the top of the page is a pull.
        if (Math.abs(dy) < 4 && Math.abs(dx) < 4) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || !atTop()) {
          start = null;
          return;
        }
        pulling = true;
        // Re-anchor so the content starts moving from where the pull was recognised (no jump).
        start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        contentRef.current?.classList.add("dragging");
        return;
      }
      if (event.cancelable) event.preventDefault();
      const pulled = Math.max(0, event.touches[0].clientY - start.y);
      // Rubber band: follows the finger closely at first, then increasingly resists.
      distance = PULL_MAX * (1 - Math.exp(-pulled / (PULL_MAX * 1.35)));
      const nowArmed = distance >= PULL_THRESHOLD;
      if (nowArmed && !armed) tick();
      armed = nowArmed;
      schedule();
    };

    const finish = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      contentRef.current?.classList.remove("dragging");
    };

    const onEnd = () => {
      if (!start || !pulling) {
        start = null;
        return;
      }
      start = null;
      pulling = false;
      finish();
      if (distance < PULL_THRESHOLD) {
        distance = 0;
        paint(0, true);
        return;
      }
      busyRef.current = true;
      setRefreshing(true);
      paint(PULL_HOLD, true, true);
      const startedAt = Date.now();
      void Promise.resolve()
        .then(() => onRefreshRef.current())
        .catch(() => undefined)
        .then(() => new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt)))))
        .then(() => {
          distance = 0;
          paint(0, true);
          setRefreshing(false);
          // Let the settle animation finish before another pull can start.
          setTimeout(() => {
            busyRef.current = false;
          }, 300);
        });
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      finish();
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  return { contentRef, indicatorRef, arcRef, refreshing };
}

/** A light tap when the pull passes the refresh point (Android; iOS web views ignore it). */
function tick() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(6);
  } catch {
    // Haptics are optional.
  }
}
