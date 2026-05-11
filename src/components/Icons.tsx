// Inline SVG иконки в стиле Lucide. Без внешних зависимостей.
import type { SVGProps } from 'react';

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconDashboard = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
);

export const IconOpiu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 3v18h18" />
    <path d="M7 16l4-4 3 3 5-7" />
    <path d="M19 8v0" />
  </svg>
);

export const IconDds = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M5 7h14l-1 11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7z" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M12 11v6" />
    <path d="M9 14h6" />
  </svg>
);

export const IconRnp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18" />
    <path d="M9 16h2" />
    <path d="M15 16h2" />
  </svg>
);

export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const IconChart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 3v18h18" />
    <path d="M7 14l3-3 4 4 5-6" />
  </svg>
);

export const IconBars = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="4" y="10" width="3" height="10" rx="0.5" />
    <rect x="10.5" y="6" width="3" height="14" rx="0.5" />
    <rect x="17" y="13" width="3" height="7" rx="0.5" />
  </svg>
);

export const IconPie = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M21 12a9 9 0 1 1-9-9v9z" />
    <path d="M21 12a9 9 0 0 0-9-9" />
  </svg>
);

export const IconTable = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </svg>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);

export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

export const IconFilter = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 4h18l-7 9v6l-4-2v-4z" />
  </svg>
);

export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export const IconInfo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h0" />
  </svg>
);

export const IconUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M5 12l7-7 7 7" />
    <path d="M12 5v14" />
  </svg>
);

export const IconDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M19 12l-7 7-7-7" />
    <path d="M12 5v14" />
  </svg>
);

export const IconArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M5 12h14" />
    <path d="M13 5l7 7-7 7" />
  </svg>
);

export const IconSync = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
);

export const IconList = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <circle cx="3.5" cy="6" r="0.5" fill="currentColor" />
    <circle cx="3.5" cy="12" r="0.5" fill="currentColor" />
    <circle cx="3.5" cy="18" r="0.5" fill="currentColor" />
  </svg>
);

export const IconBuilding = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M9 6h.01" />
    <path d="M15 6h.01" />
    <path d="M9 10h.01" />
    <path d="M15 10h.01" />
    <path d="M9 14h.01" />
    <path d="M15 14h.01" />
    <path d="M10 22v-4h4v4" />
  </svg>
);

export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

export const IconLink = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export const IconWarning = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h0" />
  </svg>
);
