/**
 * Converts headers and rows into an RFC 4180-style CSV string.
 *
 * - The first line contains the header row, using the given `headers` order.
 * - Each subsequent line is built by reading the corresponding value from each
 *   row for every header, in header order. Missing keys become an empty string.
 * - `undefined`/`null` values are rendered as an empty string; all other values
 *   are converted with `String(v)`.
 * - Fields are quoted only when they contain a comma, newline (`\n`), carriage
 *   return (`\r`), or double quote (`"`). Embedded double quotes are escaped by
 *   doubling them (`"` -> `""`).
 * - Records are joined with LF (`\n`), not CRLF, with no trailing newline.
 *   This is deliberate: the output is consumed by an LLM over MCP rather
 *   than written to a .csv file, and it matches the upstream Go server
 *   (`encoding/csv` with `UseCRLF=false`). Field escaping still follows
 *   RFC 4180 (quoting, `""`, embedded newlines preserved).
 */
export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines: string[] = [];

  lines.push(headers.map((header) => formatField(header)).join(','));

  for (const row of rows) {
    const line = headers.map((header) => formatField(normalizeValue(row[header]))).join(',');
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Converts a raw cell value into its string representation prior to escaping.
 * `undefined`/`null` become an empty string; everything else is stringified.
 */
function normalizeValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

/**
 * Applies RFC 4180 escaping rules to a single field's string value.
 * Quoting decisions are based on the original (unescaped) string.
 */
function formatField(value: string): string {
  const needsQuoting = /[",\n\r]/.test(value);
  if (!needsQuoting) {
    return value;
  }
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
