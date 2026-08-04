import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { emitToOrganization } from '../sse.js';
import { logger } from '../utils/logger.js';

/**
 * File attachments.
 *
 * Everything file-shaped here used to be a URL string — driveLink, folderLink, assetLinks,
 * receiptUrl — so the work an agency delivers lived in somebody's Drive and Flowzen only
 * remembered where to look. Anyone outside that Drive's sharing settings saw a dead link.
 *
 * Files land on local disk under `uploads/attachments`. That is not a compromise: docker-compose
 * already mounts `uploads_data` as a named volume at the uploads directory, so files survive
 * container rebuilds exactly the way generated quote PDFs do. No object store to configure, no
 * credentials to leak.
 *
 * SECURITY — the three things that make file upload dangerous, and what is done about each:
 *
 *  1. Path traversal. The on-disk name is generated here from random bytes and is the ONLY value
 *     ever joined to a path. A file called "../../.env" is stored as "a1b2c3….bin" and its
 *     original name is kept in the database purely for display.
 *
 *  2. Stored XSS. An uploaded .html or .svg served inline would run in the victim's session on
 *     this origin. Downloads therefore always send `Content-Disposition: attachment` and
 *     `X-Content-Type-Options: nosniff`, so the browser saves rather than renders.
 *
 *  3. Cross-tenant reads. Every download re-checks that the row belongs to the caller's
 *     organization, and answers 404 (not 403) when it does not — a 403 confirms the file exists.
 */

export const attachmentRouter = Router();

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'attachments');
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// Types an agency actually exchanges. A deny-list would be a guess at what's dangerous; this is
// an allow-list of what's useful, which fails closed on anything unforeseen.
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain',
  'application/zip', 'application/x-zip-compressed',
  'video/mp4', 'video/quicktime',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error(`Files of type ${file.mimetype} are not allowed`));
      return;
    }
    cb(null, true);
  },
});

/** The entity an attachment hangs off. Exactly one, and it must be in the caller's org. */
const OWNER_KEYS = ['taskId', 'leadId', 'clientId', 'projectId', 'expenseId'] as const;
type OwnerKey = (typeof OWNER_KEYS)[number];

async function resolveOwner(orgId: string, body: Record<string, any>) {
  const provided = OWNER_KEYS.filter((k) => body[k]);
  if (provided.length === 0) return { error: 'Attach the file to a task, lead, client, project or expense' };
  if (provided.length > 1) return { error: 'A file can only be attached to one record' };

  const key = provided[0] as OwnerKey;
  const id = String(body[key]);

  // Ownership is proved through the org, never taken on trust from the request — otherwise a
  // caller could attach a file to another tenant's record just by knowing an id.
  const found = await (async () => {
    switch (key) {
      case 'taskId': return prisma.task.findFirst({ where: { id, OR: [{ project: { client: { organizationId: orgId } } }, { client: { organizationId: orgId } }, { lead: { organizationId: orgId } }] }, select: { id: true } });
      case 'leadId': return prisma.lead.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
      case 'clientId': return prisma.client.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
      case 'projectId': return prisma.project.findFirst({ where: { id, client: { organizationId: orgId } }, select: { id: true } });
      case 'expenseId': return prisma.expense.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
    }
  })();

  if (!found) return { error: 'That record was not found in your organization' };
  return { key, id };
}

// GET /api/attachments?taskId=…  — list what is attached to one record.
attachmentRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const where: any = { organizationId: orgId };
    const provided = OWNER_KEYS.filter((k) => req.query[k]);
    if (provided.length !== 1) {
      res.status(400).json({ error: 'Specify exactly one of: taskId, leadId, clientId, projectId, expenseId' });
      return;
    }
    where[provided[0]] = String(req.query[provided[0]]);

    const attachments = await prisma.attachment.findMany({
      where,
      select: {
        id: true, filename: true, mimeType: true, size: true, createdAt: true,
        uploadedBy: { select: { id: true, name: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(attachments);
  } catch (error) { next(error); }
});

// POST /api/attachments — multipart upload of a single file.
attachmentRouter.post('/', (req: AuthRequest, res: Response, next) => {
  upload.single('file')(req as any, res as any, async (err: any) => {
    try {
      if (err) {
        // multer's own errors are user-facing input problems, not server faults.
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? `That file is larger than the ${MAX_BYTES / 1024 / 1024} MB limit`
          : (err.message || 'Upload failed');
        res.status(400).json({ error: msg });
        return;
      }
      const file = (req as any).file as { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined;
      if (!file) { res.status(400).json({ error: 'No file was uploaded' }); return; }

      const orgId = req.user!.organizationId;
      const owner = await resolveOwner(orgId, req.body || {});
      if ('error' in owner) { res.status(400).json({ error: owner.error }); return; }

      // Generated, not derived. The original name never touches the filesystem.
      const ext = path.extname(file.originalname).slice(0, 12).replace(/[^A-Za-z0-9.]/g, '');
      const storedName = `${crypto.randomBytes(16).toString('hex')}${ext}`;

      await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
      await fs.promises.writeFile(path.join(UPLOAD_DIR, storedName), file.buffer);

      const attachment = await prisma.attachment.create({
        data: {
          organizationId: orgId,
          uploadedById: req.user!.userId,
          // Trimmed to something sane; this is shown to humans, never resolved as a path.
          filename: String(file.originalname).slice(0, 255),
          storedName,
          mimeType: file.mimetype,
          size: file.size,
          [owner.key]: owner.id,
        } as any,
        select: {
          id: true, filename: true, mimeType: true, size: true, createdAt: true,
          uploadedBy: { select: { id: true, name: true, avatar: true } },
        },
      });

      emitToOrganization(req.app.get('io'), orgId, 'attachment:updated', { [owner.key]: owner.id });
      res.status(201).json(attachment);
    } catch (error) { next(error); }
  });
});

// GET /api/attachments/:id/download
attachmentRouter.get('/:id/download', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const att = await prisma.attachment.findFirst({
      where: { id: req.params.id as string, organizationId: orgId },
      select: { filename: true, storedName: true, mimeType: true },
    });
    // 404 rather than 403 — a 403 tells someone the file exists.
    if (!att) { res.status(404).json({ error: 'Not found' }); return; }

    // basename() is belt-and-braces: storedName is generated, but nothing downstream should ever
    // depend on that being true.
    const abs = path.join(UPLOAD_DIR, path.basename(att.storedName));
    if (!fs.existsSync(abs)) { res.status(404).json({ error: 'File not found' }); return; }

    // Always download, never render. An uploaded .svg or .html served inline would execute in
    // the viewer's session on this origin.
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
    res.sendFile(abs);
  } catch (error) { next(error); }
});

// DELETE /api/attachments/:id
attachmentRouter.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const att = await prisma.attachment.findFirst({
      where: { id: req.params.id as string, organizationId: orgId },
      select: { id: true, storedName: true, taskId: true, leadId: true, clientId: true, projectId: true, expenseId: true },
    });
    if (!att) { res.status(404).json({ error: 'Not found' }); return; }

    await prisma.attachment.delete({ where: { id: att.id } });
    // The row is the record; a leftover file is untidy but harmless, and failing the request
    // after the row is gone would be worse.
    try {
      await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(att.storedName)));
    } catch (e) {
      logger.warn('Attachment row deleted but its file could not be removed', { storedName: att.storedName });
    }

    emitToOrganization(req.app.get('io'), orgId, 'attachment:updated', { taskId: att.taskId, leadId: att.leadId });
    res.json({ success: true });
  } catch (error) { next(error); }
});
