// ── Shared icon set ──────────────────────────────────────────────────────────
// Professional inline SVG line-icons (24×24, stroke = currentColor) used across
// the app in place of emoji. Color is driven by the T.* palette via the `color`
// prop; default inherits currentColor. No raster, no emoji. Shared by MizanApp,
// Goals, and any other surface that needs an icon.
import React from "react";

export const ICONS = {
  target:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></>,
  cpu:<><rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v2.5M15 3v2.5M9 18.5V21M15 18.5V21M3 9h2.5M3 15h2.5M18.5 9H21M18.5 15H21"/></>,
  bolt:<path d="M13 2 4.5 13.5H10l-1 8.5L19.5 10H14l1-8Z"/>,
  moon:<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z"/>,
  sun:<><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.6M12 19.4V22M3.5 3.5 5.3 5.3M18.7 18.7l1.8 1.8M2 12h2.6M19.4 12H22M3.5 20.5 5.3 18.7M18.7 5.3l1.8-1.8"/></>,
  leaf:<><path d="M5 19c0-8 6-13.5 14.5-13.5C19.5 14 14 19.5 5.5 19.5c-.5 0-.5-.5-.5-.5Z"/><path d="M6 18c3-4.5 6.5-7 11-8"/></>,
  kaaba:<><path d="M12 3 4 7.2v9.6L12 21l8-4.2V7.2L12 3Z"/><path d="M4 7.2 12 11.4l8-4.2M12 11.4V21"/><path d="M7.5 9.2v3.4"/></>,
  home:<><path d="M4 11 12 4l8 7"/><path d="M6 9.8V19h12V9.8"/><path d="M10 19v-5h4v5"/></>,
  shield:<path d="M12 3 5 6v6c0 4.2 3 7.4 7 9 4-1.6 7-4.8 7-9V6l-7-3Z"/>,
  book:<><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v14H6.5A1.5 1.5 0 0 0 5 18.5V4.5Z"/><path d="M5 18.5A1.5 1.5 0 0 1 6.5 17H19v4H6.5A1.5 1.5 0 0 1 5 19.5"/></>,
  calendar:<><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9.5h16M9 3v4M15 3v4"/></>,
  scale:<><path d="M12 4v16M7.5 20.5h9"/><path d="M5 7.5 12 6l7 1.5"/><path d="M5 7.5 2.5 13h5L5 7.5ZM19 7.5 16.5 13h5L19 7.5Z"/></>,
  chart:<><path d="M4 4v16h16"/><path d="M7.5 16v-3.5M12 16V9M16.5 16V6.5"/></>,
  bank:<><path d="M3 9 12 4l9 5"/><path d="M5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8M3.5 20.5h17"/></>,
  mosque:<><path d="M12 3c1.8 2.2 3.2 3.4 3.2 5.4 0 .9-.5 1.6-1.2 2.1"/><path d="M5 21v-7.5a7 7 0 0 1 14 0V21"/><path d="M3 21h18M9.5 21v-2.5a2.5 2.5 0 0 1 5 0V21"/></>,
  spark:<><path d="M12 3v18M3 12h18"/><path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8"/></>,
  gear:<><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19"/></>,
  hexagon:<path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z"/>,
  keyboard:<><rect x="3" y="7" width="18" height="11" rx="2"/><path d="M7 11h.01M11 11h.01M15 11h.01M17.2 11h.01M7 14.2h10"/></>,
  pause:<><rect x="7" y="6" width="3.2" height="12" rx="1"/><rect x="13.8" y="6" width="3.2" height="12" rx="1"/></>,
  play:<path d="M8 5.5v13l11-6.5L8 5.5Z"/>,
  chevron:<path d="M9 5l7 7-7 7"/>,
  stop:<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>,
  download:<path d="M12 3v12M7.5 11l4.5 4.5L16.5 11M5 20h14"/>,
  arrowUp:<path d="M12 20V5M6.5 10.5 12 5l5.5 5.5"/>,
  pencil:<><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M14 6l4 4"/></>,
  warning:<><path d="M12 4 2.8 20h18.4L12 4Z"/><path d="M12 10v4.5M12 17.4h.01"/></>,
  info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6h.01"/></>,
  check:<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>,
  close:<path d="M6 6l12 12M18 6 6 18"/>,
};

export function Icon({ name, size = 16, color, stroke = 1.75, style, ...rest }) {
  const g = ICONS[name];
  if (!g) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"}
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block", ...style }} {...rest}>{g}</svg>
  );
}
