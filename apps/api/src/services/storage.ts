/**
 * Object storage abstraction.
 *
 * For now, this writes to a local `storage` directory. In production, this
 * swaps out for S3, GCS, or R2 without changing the signature.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const STORAGE_DIR = path.join(process.cwd(), 'storage');

// Ensure the directory exists on boot
fs.mkdir(STORAGE_DIR, { recursive: true }).catch(() => {});

export const storage = {
  /** Upload a buffer and return the generated key. */
  async upload(prefix: string, buffer: Buffer, extension: string = 'pdf'): Promise<string> {
    const key = `${prefix}-${randomBytes(8).toString('hex')}.${extension}`;
    const filePath = path.join(STORAGE_DIR, key);
    await fs.writeFile(filePath, buffer);
    return key;
  },

  /** Get the local file path (or a signed URL in the future) for a key. */
  async getUrl(key: string): Promise<string> {
    // For local storage, we just return the key and let a `/storage/:key` route serve it,
    // or we can return the absolute path. Let's return the absolute path for now so
    // endpoints can do `res.sendFile(await storage.getUrl(key))`.
    return path.join(STORAGE_DIR, key);
  },

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(path.join(STORAGE_DIR, key));
    } catch (e) {
      // Ignore if not found
    }
  },
};
