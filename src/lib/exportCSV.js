/* ─── CSV EXPORT ─────────────────────────────────────────
 * Generic, dependency-free CSV exporter. Quotes strings the way
 * RFC 4180 expects (wrap in `"`, double any embedded `"`), but
 * leaves numbers UNQUOTED so spreadsheets recognise them as
 * numerics rather than text. Dates serialise to YYYY-MM-DD,
 * booleans render as quoted "true"/"false", null/undefined →
 * empty cell.
 * ──────────────────────────────────────────────────────── */

const CRLF = "\r\n";

// Serialise a single value to its CSV cell representation.
// Numbers stay UNQUOTED on purpose so Excel/Sheets parse them as
// numbers; strings, booleans, and dates are always quoted to make
// embedded commas / quotes / newlines safe.
function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") {
    return `"${value ? "true" : "false"}"`;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `"${value.toISOString().slice(0, 10)}"`;
  }
  const str = String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

// Quote a header cell. Headers are always treated as strings.
function formatHeader(name) {
  const str = String(name ?? "");
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Convert an array of row objects to a CSV string.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {Array<string>} [headers] - column keys; defaults to keys of rows[0]
 * @returns {string}
 */
export function toCSV(rows, headers) {
  const safeRows = Array.isArray(rows) ? rows : [];
  let cols = headers;
  if (!cols || !cols.length) {
    if (!safeRows.length) return "";
    cols = Object.keys(safeRows[0] || {});
  }
  const headerLine = cols.map(formatHeader).join(",");
  if (!safeRows.length) return headerLine;
  const bodyLines = safeRows.map((row) =>
    cols.map((col) => formatCell(row ? row[col] : undefined)).join(",")
  );
  return [headerLine, ...bodyLines].join(CRLF);
}

/**
 * Build a CSV file from `rows` and trigger a browser download.
 * No-op when `rows` is empty — we never push an empty file.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} filename
 * @param {Array<string>} [headers]
 */
export function downloadCSV(rows, filename, headers) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const csv = toCSV(rows, headers);
  if (!csv) return;
  const safeName = filename || "export.csv";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke a tick so Safari finishes the download dialog.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
