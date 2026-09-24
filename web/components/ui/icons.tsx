// Inline icons. All are decorative (buttons carry their own labels) and draw in currentColor, so the
// host sets the color with a token, e.g. `.btn-icon { color: var(--ink2) }`.

export const BrandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 4.5V8l2.4 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const PlusIcon = ({ color = "currentColor", size = 16 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const DashboardIcon = ({ active }: { active: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    style={{ color: active ? "var(--accent)" : "var(--ink3)" }}
  >
    <rect x="2" y="2" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="9" y="2" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="2" y="9" width="12" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const ChevronIcon = () => (
  <svg className="chev" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M3.5 2 6.5 5l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

export const KeyboardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.8" y="4" width="12.4" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4.5 10h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const MinusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 6h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
