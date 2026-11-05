import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, statfs, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';

/**
 * Uploaded files (Subscriptions plan, decision 9).
 *
 * Flowzen kept no files at all after attachments were withdrawn on
 * 2026-08-05: a full disk stops Postgres, and the two were sharing one. So
 * files now go on their own Docker volume (`uploads_data`, mounted at
 * UPLOAD_DIR), under random names, and three things refuse an upload before
 * it is written: a file over 10 MB, an organisation past its quota (a
 * Settings value), and a server with less than 2 GB free. They are only ever
 * served through a signed-in, Management-only route — never a public URL.
 *
 * `pg_dump` does not include them, so the compose file backs the volume up
 * nightly beside the database (DEPLOY.md).
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;

/** What an invoice may be. The extension on disk comes from this, never from the upload's name. */
export const ALLOWED_MIMES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export type FileKind = 'SUBSCRIPTION_INVOICE';

/** Where the files live: UPLOAD_DIR, or ./uploads beside the API. */
export const uploadRoot = (): string => path.resolve(process.env.UPLOAD_DIR || './uploads', 'files');

/**
 * How much room the disk has. An object rather than a bare function so the
 * tests can stand in a full disk without a real one.
 */
export const disk = {
  async freeBytes(dir: string): Promise<number> {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  },
};

/** A refusal the person can act on, with a status for the route. */
export class UploadRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UploadRefused';
  }
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** What the organisation has stored, live files only. */
export async function usedBytes(organizationId: string): Promise<number> {
  const agg = await prisma.storedFile.aggregate({ where: { organizationId, deletedAt: null }, _sum: { sizeBytes: true } });
  return agg._sum.sizeBytes ?? 0;
}

/**
 * Keeps an upload, or says why not. Checks the kind, the size, the quota and
 * the disk — in that order, cheapest first — and only then writes.
 */
export async function storeFile(input: {
  organizationId: string;
  userId: string;
  kind: FileKind;
  buffer: Buffer;
  mime: string;
  originalName: string;
}): Promise<{ id: string; mime: string; sizeBytes: number; originalName: string }> {
  const ext = ALLOWED_MIMES[input.mime];
  if (!ext) throw new UploadRefused(415, 'Only PDF, PNG or JPG invoices can be uploaded.');
  if (input.buffer.length === 0) throw new UploadRefused(400, 'The file is empty.');
  if (input.buffer.length > MAX_FILE_BYTES) {
    throw new UploadRefused(413, `That file is ${mb(input.buffer.length)}; the most an invoice can be is ${mb(MAX_FILE_BYTES)}.`);
  }

  const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { uploadQuotaMb: true } });
  const quota = (org?.uploadQuotaMb ?? 2048) * 1024 * 1024;
  const used = await usedBytes(input.organizationId);
  if (used + input.buffer.length > quota) {
    throw new UploadRefused(
      507,
      `The upload space is full: ${mb(used)} of ${mb(quota)} used. Delete old invoices, or raise the space in Settings → Money.`,
    );
  }

  const root = uploadRoot();
  await mkdir(root, { recursive: true });
  const free = await disk.freeBytes(root);
  if (free < MIN_FREE_BYTES) {
    throw new UploadRefused(507, `The server has only ${mb(free)} free; uploads stop below ${mb(MIN_FREE_BYTES)} so the database never runs out of room.`);
  }

  const name = `${randomBytes(24).toString('hex')}.${ext}`;
  await writeFile(path.join(root, name), input.buffer, { flag: 'wx' });
  try {
    const row = await prisma.storedFile.create({
      data: {
        organizationId: input.organizationId,
        kind: input.kind,
        mime: input.mime,
        sizeBytes: input.buffer.length,
        path: name,
        sha256: createHash('sha256').update(input.buffer).digest('hex'),
        originalName: input.originalName.slice(0, 200),
        createdById: input.userId,
      },
      select: { id: true, mime: true, sizeBytes: true, originalName: true },
    });
    return row;
  } catch (e) {
    await unlink(path.join(root, name)).catch(() => undefined);
    throw e;
  }
}

/** The file on disk, for streaming. Null when the row is gone or not this organisation's. */
export async function openFile(organizationId: string, id: string) {
  const row = await prisma.storedFile.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: { id: true, mime: true, sizeBytes: true, path: true, originalName: true },
  });
  if (!row) return null;
  return { ...row, stream: () => createReadStream(path.join(uploadRoot(), row.path)) };
}

/** Marks a file gone. The bytes stay until a clean-up; the quota stops counting them at once. */
export const softDeleteFile = (id: string) => prisma.storedFile.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
