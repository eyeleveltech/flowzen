import type { Response } from 'express';

/**
 * Send a CSV file as a browser download.
 *
 * A plain `res.send(csv)` would render inline in some clients instead of
 * downloading — `Content-Disposition: attachment` is what makes clicking
 * Export actually save a file. `filename` should not include the extension.
 */
export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(csv);
}
