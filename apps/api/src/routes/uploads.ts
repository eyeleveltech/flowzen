import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

/**
 * Authenticated, org-scoped access to generated files (quote / invoice PDFs).
 *
 * These used to be served as blanket static files (`express.static('uploads')`), so anyone —
 * with no login and from any organization — could download any quote PDF just by knowing (or
 * enumerating, since the names are sequential) the URL. Quotes carry pricing, GST numbers,
 * billing addresses and client details, so that was a straight confidential-data leak.
 *
 * Now every download requires a valid session AND that the file belongs to a quote/invoice in
 * the caller's organization. The httpOnly auth cookie rides along on the browser's top-level
 * navigation (window.open), so the frontend keeps working unchanged.
 */
export const uploadsRouter = Router();

uploadsRouter.get('/quotes/:filename', authenticate, async (req: AuthRequest, res: Response) => {
  // basename() strips any path segments — a caller can never traverse out of the quotes dir.
  const filename = path.basename(String(req.params.filename || ''));
  const orgId = req.user!.organizationId;
  const rel = `/uploads/quotes/${filename}`;

  // The file is only yours if a quote or invoice-draft in YOUR org points at it.
  const [quote, draft] = await Promise.all([
    prisma.quoteDocument.findFirst({ where: { organizationId: orgId, pdfUrl: rel }, select: { id: true } }),
    prisma.invoiceDraft.findFirst({ where: { organizationId: orgId, pdfUrl: rel }, select: { id: true } }),
  ]);
  if (!quote && !draft) {
    // 404 (not 403) so we don't confirm the file exists to someone who shouldn't see it.
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const abs = path.resolve(process.cwd(), 'uploads', 'quotes', filename);
  if (!fs.existsSync(abs)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.sendFile(abs);
});
