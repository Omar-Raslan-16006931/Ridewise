import type { ReactNode } from "react";

/* Minimal line icons: one thin stroke, as few lines as possible. Always bare, never on a tile. */
const paths: Record<string, ReactNode> = {
  today: (<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2.5" /></>),
  rides: <path d="M5 7h14M5 12h14M5 17h9" />,
  months: <path d="M6 19V11M12 19V5M18 19v-6" />,
  space: (<><circle cx="12" cy="8.5" r="3.5" /><path d="M5.5 19.5c1.2-3 3.6-4.5 6.5-4.5s5.3 1.5 6.5 4.5" /></>),
  plus: <path d="M12 5v14M5 12h14" />,
  campus: <path d="M8 16L16 8M9.5 8H16v6.5" />,
  home: <path d="M16 8L8 16M14.5 16H8V9.5" />,
  left: <path d="M14.5 6l-6 6 6 6" />,
  right: <path d="M9.5 6l6 6-6 6" />,
  down: <path d="M6 9.5l6 6 6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  bell: <path d="M7 16V11a5 5 0 0 1 10 0v5l1.5 1.5h-13L7 16zM10.5 20h3" />,
  up: <path d="M7 15l5-5 5 5" />,
  downTrend: <path d="M7 9l5 5 5-5" />,
  external: <path d="M9 7h8v8M17 7L7 17" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
