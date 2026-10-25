import type { SVGProps } from 'react'

/** Small stroke icons (24px grid, currentColor). Decorative by default. */
type IconProps = SVGProps<SVGSVGElement> & { title?: string }

function Svg({ title, children, ...props }: IconProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative icons are aria-hidden; labelled ones render a <title>
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.2 4.2L19 7" />
  </Svg>
)
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Svg>
)
export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5v.01" />
  </Svg>
)
export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
)
export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </Svg>
)
export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
)
export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </Svg>
)
export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)
export const IconBorrow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h16" />
    <path d="M4 15h5l3-4h8" />
    <path d="M17 8l3 3-3 3" />
  </Svg>
)
/** A piggy bank: a padlock here would read as "locked", the same glyph as the next-release items. */
export const IconSave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 11.5c0-3.6-3.4-6.5-7.5-6.5S4 7.9 4 11.5c0 2 1 3.7 2.6 4.9V19h2.6v-1.4c.7.2 1.5.3 2.3.3s1.6-.1 2.3-.3V19h2.6v-2.6c.9-.7 1.6-1.5 2-2.4H20v-3h-1.2" />
    <path d="M9.5 8.5h4" />
    <path d="M15.5 10.5v.01" />
  </Svg>
)
export const IconEvidence = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v5h5M9.5 14l2 2 3.5-4" />
  </Svg>
)
export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </Svg>
)
export const IconDrop = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5c3.5 4.2 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 2.5-6.3 6-10.5z" />
  </Svg>
)
export const IconWallet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7a2 2 0 0 1 2-2h11v4" />
    <path d="M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z" />
    <path d="M16 14h.01" />
  </Svg>
)
export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10" width="14" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Svg>
)
