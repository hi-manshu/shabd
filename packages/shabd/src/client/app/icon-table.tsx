/** The drawings of the icon set, by name. The component that shows one is in icons.tsx. */
import type { ReactNode } from 'react'

const stroke = (children: ReactNode) => (
  <g fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </g>
)

export const ICONS = {
  menu: stroke(<path d="M4 7h16M4 12h16M4 17h16" />),
  close: stroke(<path d="M6 6l12 12M18 6L6 18" />),
  search: stroke(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>,
  ),
  sun: stroke(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>,
  ),
  moon: stroke(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5z" />),
  chevron: stroke(<path d="M9 6l6 6-6 6" />),
  palette: stroke(
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 2-1.8 0-1.6-1.2-1.7-1.2-3 0-1 .8-1.7 1.9-1.7h1.8a4 4 0 0 0 4-4c0-3.6-3.8-6.5-8.5-6.5z" />
      <path d="M7.6 12.2h.01M9.4 8.3h.01M13.6 7.4h.01" strokeWidth="2.6" />
    </>,
  ),
  copy: stroke(
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </>,
  ),
  check: stroke(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  external: stroke(<path d="M14 5h5v5M19 5l-8 8M11 7H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5" />),
  edit: stroke(<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />),
  hash: stroke(<path d="M9.5 4L7.5 20M16.5 4l-2 16M4.5 9h15.5M4 15h15.5" />),
  globe: stroke(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>,
  ),
  rss: stroke(
    <>
      <path d="M5 5a14 14 0 0 1 14 14M5 11.5a7.5 7.5 0 0 1 7.5 7.5" />
      <circle cx="6" cy="18" r="1" />
    </>,
  ),
  'arrow-left': stroke(<path d="M19 12H5M11 6l-6 6 6 6" />),
  'arrow-right': stroke(<path d="M5 12h14M13 6l6 6-6 6" />),
  sparkle: stroke(<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />),
  page: stroke(<path d="M7 3.5h7l4.5 4.5V20.5H7zM14 3.5V8h4.5" />),
  folder: stroke(<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" />),
  github: (
    <path
      fill="currentColor"
      d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3"
    />
  ),
  x: (
    <path
      fill="currentColor"
      d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z"
    />
  ),
} as const

export type IconName = keyof typeof ICONS

export function hasIcon(name: string): name is IconName {
  return name in ICONS
}
