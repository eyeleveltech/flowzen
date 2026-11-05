import { Router, type NextFunction, type Response } from 'express';
import { authenticate, requireManagement, type AuthRequest } from '../middleware/auth.js';
import { openFile } from '../services/files.js';

/**
 * GET /api/files/:id — an uploaded file, streamed to Management only
 * (Subscriptions plan, decision 9). There is no public address for a file:
 * a link to one is a link to this route, which asks who you are first.
 */

export const filesRouter = Router();
filesRouter.use(authenticate, requireManagement('Uploaded invoices are Management’s to open.'));

/** A download name a browser will take: the original, with anything odd replaced. */
const safeName = (name: string) => name.replace(/[^\w. -]+/g, '_').slice(0, 120) || 'file';

filesRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const file = await openFile(req.user!.organizationId, String(req.params.id));
    if (!file) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('Content-Disposition', `inline; filename="${safeName(file.originalName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    const stream = file.stream();
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).json({ success: false, error: 'The file is missing from the uploads volume.' });
      else res.end();
    });
    stream.pipe(res);
  } catch (e) {
    next(e);
  }
});
