/**
 * A CSV reader.
 *
 * Written rather than installed because the job is small and completely
 * specified: the file an agency imports is one somebody exported from a
 * spreadsheet, and spreadsheets write RFC 4180. What that costs a dependency is
 * not worth the supply chain.
 *
 * It handles the four things real exports actually contain and that a naive
 * `split(',')` gets wrong:
 *
 *   - quoted fields holding commas — `"Acme, Inc.",hello@acme.com`
 *   - quoted fields holding newlines — a multi-line address in one cell
 *   - escaped quotes — `"He said ""yes"""`
 *   - a UTF-8 BOM at the front, which Excel writes and which otherwise becomes
 *     part of the first header name, so `name` silently never matches
 *
 * Everything comes back as a string. Meaning is applied by the caller, because
 * the caller is the one that knows whether a column is a date or a phone number
 * that happens to look like one.
 */

/** One row of cells. Nothing is trimmed here except surrounding whitespace. */
const parseRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  // Excel's BOM. Left in place it becomes part of the first header.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // A trailing newline should not produce a row of one empty cell.
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"' && field.trim() === '') {
      // Opening quote. `field.trim()` rather than `field === ''` so a cell
      // written as ` "Acme"` still counts as quoted.
      field = '';
      quoted = true;
      i++;
      continue;
    }
    if (c === ',') {
      endField();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      endRow();
      i++;
      continue;
    }

    field += c;
    i++;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
};

/**
 * Column names, made forgiving.
 *
 * "Company Name", "company_name" and "COMPANY NAME" are the same header, and an
 * import that rejects a file over capitalisation is an import people do by hand
 * instead.
 */
export const normaliseHeader = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/[^a-z0-9]/g, '');

/**
 * Parse a CSV into objects keyed by normalised header.
 *
 * Returns `[]` for an empty file or one with only a header row — an empty import
 * is not an error, it is an import of nothing.
 */
export const parseCsv = (text: string): Record<string, string>[] => {
  const rows = parseRows(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normaliseHeader);

  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const value = (cells[index] ?? '').trim();
      if (value !== '') record[header] = value;
    });
    return record;
  });
};

/**
 * One exported column: a human header plus how to read the cell out of a row.
 *
 * Reading through `value()` rather than exporting the row object verbatim
 * means the CSV can never carry a field the caller wasn't handed in the
 * first place — it draws from the same already-permission-masked row the
 * JSON response uses, so a figure hidden from a caller in the UI stays
 * hidden in their download too.
 */
export interface CsvColumn<T> {
  label: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

/**
 * Render rows as RFC 4180 CSV: `\r\n` line endings, a field quoted whenever
 * it holds a comma, a quote, a newline or surrounding whitespace, and a
 * doubled quote to escape one inside a quoted field — the exact grammar
 * `parseCsv` above already reads. A UTF-8 BOM is prepended so Excel opens a
 * file with a name like "Zoë Traders" without mangling it, the same BOM
 * `parseCsv` strips coming in.
 */
export const toCsv = <T>(rows: T[], columns: CsvColumn<T>[]): string => {
  const escape = (v: string | number | boolean | null | undefined): string => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/["\n\r,]/.test(s) || /^\s|\s$/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.map((c) => escape(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => escape(c.value(row))).join(','));
  return '﻿' + [header, ...lines].join('\r\n');
};
