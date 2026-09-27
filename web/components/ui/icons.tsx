// Inline icons. All are decorative (buttons carry their own labels) and draw in currentColor, so the
// host sets the color with a token, e.g. `.btn-icon { color: var(--ink2) }`.

export const PlusIcon = ({ color = "currentColor", size = 16 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const ChevronIcon = () => (
  <svg className="chev" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M3.5 2 6.5 5l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Points down; the host rotates it 180deg for an open menu. */
export const ChevronDownIcon = () => (
  <svg className="chev" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4.5 6.5 8 10l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ChevronLeftIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ChevronUpIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M3 7.5 6 4.5l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="4.8" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10.6 10.6 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

export const SourcesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const HistoryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 5v3l2 1.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const HelpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M6.4 6.4a1.7 1.7 0 0 1 3.3.5c0 1.1-1.7 1.4-1.7 2.4M8 11.2v.1"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

export const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5.5 3.5v9l7-4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

export const MinusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 6h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="3.5" cy="8" r="1.3" />
    <circle cx="8" cy="8" r="1.3" />
    <circle cx="12.5" cy="8" r="1.3" />
  </svg>
);

export const XIcon = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** The AI sparkle that marks Generate, monochrome in its host color. `twin` adds the small second star. */
export const SparkleIcon = ({ size = 14, twin = false }: { size?: number; twin?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M8 1.5c.4 3.3 1.9 5.1 5.5 6.5-3.6 1.4-5.1 3.2-5.5 6.5-.4-3.3-1.9-5.1-5.5-6.5 3.6-1.4 5.1-3.2 5.5-6.5Z"
      fill="currentColor"
    />
    {twin && (
      <path
        d="M13 1.2c.15 1.1.6 1.7 1.8 2.1-1.2.4-1.65 1-1.8 2.1-.15-1.1-.6-1.7-1.8-2.1 1.2-.4 1.65-1 1.8-2.1Z"
        fill="currentColor"
      />
    )}
  </svg>
);

export const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const BellIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3L4 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M6.5 14a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 6.2 5 8.6l4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ExclamationIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M6 2v4.8M6 9.6v.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** A ring with an exclamation: Mark wrong. */
export const WrongIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 5v3.4M8 10.8v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

/** The static running mark: a ring with its left half filled. Never animated. */
export const RunningIcon = () => (
  <svg className="half" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
    <circle cx="4" cy="4" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4 .75a3.25 3.25 0 0 0 0 6.5Z" fill="currentColor" />
  </svg>
);

/** Fit the view to its content (graph canvas). */
export const FitIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

/** Mark read: a ringed tick. */
export const ReadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5.6 8.1 7.3 9.8l3.1-3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Mark unread: a ringed dot. */
export const UnreadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="8" cy="8" r="2.2" fill="currentColor" />
  </svg>
);

/** A pennant: 16px for the Flag button, outlined until `filled`; 12px and filled beside a flagged row's date. */
export const FlagIcon = ({ size = 16, filled = false }: { size?: 12 | 16; filled?: boolean }) =>
  size === 12 ? (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 11V2.2M3 2.5h6l-1.3 2.2L9 6.9H3Z" fill="currentColor" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 14V2.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M4 3.2h7.6l-1.7 2.9 1.7 2.9H4Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );

/** Dismiss: an archive box. */
export const DismissIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2.5" y="3" width="11" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3.5 6v6a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V6M6.5 9h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The tick on a Following button. */
export const TickIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.4 6.6 11.4 12.5 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
