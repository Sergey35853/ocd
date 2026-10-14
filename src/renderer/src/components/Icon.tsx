import type { JSX } from "react"

type Props = { size?: number; className?: string }

function svg(path: JSX.Element, { size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

export const IconPlus = (p: Props) =>
  svg(
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>,
    p,
  )

export const IconSearch = (p: Props) =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>,
    p,
  )

export const IconChat = (p: Props) =>
  svg(
    <>
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
    </>,
    p,
  )

export const IconSpark = (p: Props) =>
  svg(
    <>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="M5.6 5.6 8.4 8.4" />
      <path d="m15.6 15.6 2.8 2.8" />
      <path d="m18.4 5.6-2.8 2.8" />
      <path d="m8.4 15.6-2.8 2.8" />
    </>,
    p,
  )

export const IconPuzzle = (p: Props) =>
  svg(
    <>
      <path d="M9 4h2.2a1.8 1.8 0 1 1 3.6 0H17a1 1 0 0 1 1 1v2.2a1.8 1.8 0 1 0 0 3.6V13a1 1 0 0 1-1 1h-2.2a1.8 1.8 0 1 0-3.6 0H9a1 1 0 0 1-1-1v-2.2a1.8 1.8 0 1 1 0-3.6V5a1 1 0 0 1 1-1z" />
    </>,
    p,
  )

export const IconChip = (p: Props) =>
  svg(
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3" />
    </>,
    p,
  )

export const IconGear = (p: Props) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15a1.6 1.6 0 0 0-1.5-1H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 3.4V3a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15 4.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.6 1z" />
    </>,
    p,
  )

export const IconCube = (p: Props) =>
  svg(
    <>
      <path d="M12 2.8 20 7v10l-8 4.2L4 17V7z" />
      <path d="M4 7l8 4.2L20 7" />
      <path d="M12 11.2V21" />
    </>,
    p,
  )

export const IconSend = (p: Props) =>
  svg(
    <>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </>,
    p,
  )

export const IconStop = (p: Props) => svg(<rect x="7" y="7" width="10" height="10" rx="2" />, p)

export const IconPin = (p: Props) =>
  svg(
    <>
      <path d="M9 3h6l-1 6 3.5 3.5H6.5L10 9z" />
      <path d="M12 12.5V21" />
    </>,
    p,
  )

export const IconTrash = (p: Props) =>
  svg(
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
    </>,
    p,
  )

export const IconRefresh = (p: Props) =>
  svg(
    <>
      <path d="M20 11a8 8 0 1 0-1.6 5.5" />
      <path d="M20 5v6h-6" />
    </>,
    p,
  )

export const IconMinimize = (p: Props) => svg(<path d="M6 12h12" />, p)
export const IconMaximize = (p: Props) =>
  svg(<rect x="6" y="6" width="12" height="12" rx="1.5" />, p)
export const IconClose = (p: Props) =>
  svg(
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>,
    p,
  )

export const IconChevron = (p: Props) => svg(<path d="m9 6 6 6-6 6" />, p)

/** Hamburger: opens the packed navigation menu. */
export const IconMenu = (p: Props) =>
  svg(
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>,
    p,
  )

/** Focus mode: chat fills the window. */
export const IconExpand = (p: Props) =>
  svg(
    <>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </>,
    p,
  )

/** Leave focus mode. */
export const IconCollapse = (p: Props) =>
  svg(
    <>
      <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />
    </>,
    p,
  )

/** Toggle the sessions sidebar. */
export const IconPanel = (p: Props) =>
  svg(
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M10 4.5v15" />
    </>,
    p,
  )

export const IconFolder = (p: Props) =>
  svg(
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z" />,
    p,
  )

export const IconDownload = (p: Props) =>
  svg(
    <>
      <path d="M12 4v10" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19h14" />
    </>,
    p,
  )

export const IconCheck = (p: Props) => svg(<path d="m5 12.5 4.5 4.5L19 7" />, p)

export const IconLayers = (p: Props) =>
  svg(
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>,
    p,
  )

export const IconClip = (p: Props) =>
  svg(
    <path d="M20 11.5 12.2 19.3a4.6 4.6 0 0 1-6.5-6.5l8-8a3 3 0 0 1 4.3 4.3l-8 8a1.5 1.5 0 0 1-2.1-2.1l7.4-7.4" />,
    p,
  )

export const IconClipboard = (p: Props) =>
  svg(
    <>
      <rect x="7" y="4" width="10" height="4" rx="1.2" />
      <path d="M8.5 6H6.5A1.5 1.5 0 0 0 5 7.5v11A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 17.5 6h-2" />
      <path d="M9 13.5h6" />
    </>,
    p,
  )

export const IconImage = (p: Props) =>
  svg(
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m4 17 4.5-4.5 3.5 3.5 3-3L20 17" />
    </>,
    p,
  )

export const IconAlert = (p: Props) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16h.01" />
    </>,
    p,
  )

export const IconMic = (p: Props) =>
  svg(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </>,
    p,
  )

export const IconSpeaker = (p: Props) =>
  svg(
    <>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a9 9 0 0 1 0 12" />
    </>,
    p,
  )

export const IconTerminal = (p: Props) =>
  svg(
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="m7.5 10 2.5 2.5-2.5 2.5" />
      <path d="M13 15h4" />
    </>,
    p,
  )

/** Pencil: edit an earlier prompt. */
export const IconEdit = (p: Props) =>
  svg(
    <>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="m14.5 5.5 4 4" />
    </>,
    p,
  )

/** A second OS window for the current conversation. */
export const IconWindow = (p: Props) =>
  svg(
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 9h18" />
      <path d="M14.5 14.5h4" />
    </>,
    p,
  )

/** Down-arrow into a tray: export the conversation to a file. */
export const IconExport = (p: Props) =>
  svg(
    <>
      <path d="M12 3.5v10" />
      <path d="m8.5 10 3.5 3.5L15.5 10" />
      <path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
    </>,
    p,
  )

/** Sign in through a link: OAuth, or any flow that opens a browser. */
export const IconLink = (p: Props) =>
  svg(
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11.6 6.7" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </>,
    p,
  )

/** Checklist: the session's task board. */
export const IconTasks = (p: Props) =>
  svg(
    <>
      <path d="m4 6.5 1.8 1.8L9 5" />
      <path d="M4 13.5l1.8 1.8L9 12" />
      <path d="M4 20.5h5" />
      <path d="M12 6.5h8" />
      <path d="M12 13.5h8" />
      <path d="M12 20.5h8" />
    </>,
    p,
  )

/** Dial with a needle: the request-limit meter. */export const IconGauge = (p: Props) =>
  svg(
    <>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="m12 17 4-5" />
      <circle cx="12" cy="17" r="1.2" />
    </>,
    p,
  )

/** Pencil: edit the limit for one window. */
export const IconPencil = (p: Props) =>
  svg(
    <>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 6.5l3 3" />
    </>,
    p,
  )