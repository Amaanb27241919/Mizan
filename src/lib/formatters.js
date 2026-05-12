// MIZAN — number and percentage formatters.
//
// Mirrors the inline helpers in src/components/MizanApp.jsx (search for
// `const f$=`, `const fp=`, `const kf=`). Extracted here so:
//   • Vitest can unit-test them without rendering React
//   • Future modules can import without depending on the giant component
//
// IMPORTANT: when changing formatting here, mirror the change in
// MizanApp.jsx until that file is split (#15) into smaller modules
// that import from this file.

/**
 * Format a number as USD with absolute value (no sign).
 * Returns "-" when the input is null / undefined / NaN.
 * @param {number} v
 * @param {number} [d=2]  decimals
 * @returns {string}
 */
export function f$(v, d = 2) {
  if (v == null || isNaN(v)) return "-";
  return `$${Math.abs(+v).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;
}

/**
 * Format a number as a signed percentage with 2 decimals.
 * "+1.23%" for positives, "-3.14%" for negatives, "0.00%" for zero.
 * @param {number} v
 * @returns {string}
 */
export function fp(v) {
  if (v == null || isNaN(v)) return "-";
  const n = +v;
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/**
 * "kilo-format" — compact USD for big numbers.
 * 1.2B / 3.4M / $1,234. Used in stat tiles where vertical space is tight.
 * @param {number} v
 * @returns {string}
 */
export function kf(v) {
  if (v == null || isNaN(v)) return "-";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${(+v).toLocaleString()}`;
}
