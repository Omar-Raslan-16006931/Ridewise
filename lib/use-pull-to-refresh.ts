"use client";

import { useEffect, useRef, useState } from "react";

/** How far (px) the content must be pulled before letting go triggers a refresh. */
export const PULL_THRESHOLD = 72;
/** Where the content rests while the refresh runs. */
const PULL_HOLD = 56;
/** Furthest the content can be dragged. */
const PULL_MAX = 120;
/** Keep the spinner up at least this long so a fast refresh still reads as one. */
const MIN_SPIN_MS = 600;

export type PullState = {
  /** Current pull distance in px (0 when idle). */
  distance: number;
  /** True while the finger is down and dragging. */
  dragging: boolean;
  /** True while onRefresh is running. */
  refreshing: boolean;
};

/**
 * Pull-to-refresh for the whole page. Starts only when the page is scrolled to the very top,
 * the drag is mostly vertical and downward, and `enabled` is true (pass false while a sheet is open).
 * Uses a rubber-band curve so the pull feels native, and blocks the browser's own overscroll
 * bounce only while a pull is in progress.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>, enabled: boolean): PullState {
  const [state, setState] = useState<PullState>({ distance: 0, dragging: false, refreshing: false });
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let distance = 0;

    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    const onStart = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1 || !atTop()) {
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
    };

    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (!pulling) {
        // Decide once: a downward, mostly vertical drag at the top of the page is a pull.
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || !atTop()) {
          start = null;
          return;
        }
        pulling = true;
      }
      if (event.cancelable) event.preventDefault();
      // Rubber band: easy at first, then increasingly resistant.
      distance = Math.min(PULL_MAX, PULL_MAX * (1 - Math.exp(-Math.max(0, dy) / (PULL_MAX * 1.6))));
      setState({ distance, dragging: true, refreshing: false });
    };

    const onEnd = () => {
      if (!start || !pulling) {
        start = null;
        return;
      }
      start = null;
      pulling = false;
      if (distance < PULL_THRESHOLD) {
        setState({ distance: 0, dragging: false, refreshing: false });
        return;
      }
      refreshingRef.current = true;
      setState({ distance: PULL_HOLD, dragging: false, refreshing: true });
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(8);
        } catch {
          // Haptics are optional.
        }
      }
      const startedAt = Date.now();
      void Promise.resolve()
        .then(() => onRefreshRef.current())
        .catch(() => undefined)
        .then(() => new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt)))))
        .then(() => {
          refreshingRef.current = false;
          setState({ distance: 0, dragging: false, refreshing: false });
        });
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  return state;
}
