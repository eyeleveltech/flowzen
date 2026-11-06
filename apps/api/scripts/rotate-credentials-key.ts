/**
 * Re-encrypts every saved login under a new CREDENTIALS_KEY (Credentials
 * plan, decision 3). Rarely needed — only if the key leaks.
 *
 *   CREDENTIALS_KEY_OLD=<the key in use now> CREDENTIALS_KEY=<the new key> npm run credentials:rotate-key
 *
 * Every row and the key check move together in one transaction, so a failure
 * part-way leaves everything readable under the old key. Afterwards put the
 * new key in .env and restart; the old one can be destroyed.
 */
import '../src/lib/env.js';
import { PrismaClient } from '@prisma/client';
import { decryptWith, encryptWith, keyMatchesCheck, makeKeyCheck, parseKey } from '../src/utils/credentialCrypto.js';

const prisma = new PrismaClient();

async function main() {
  const oldKey = parseKey(process.env.CREDENTIALS_KEY_OLD);
  const newKey = parseKey(process.env.CREDENTIALS_KEY);
  if (!oldKey || !newKey) throw new Error('Set CREDENTIALS_KEY_OLD (the current key) and CREDENTIALS_KEY (the new one), each 32 base64 bytes.');
  if (oldKey.equals(newKey)) throw new Error('The two keys are the same; nothing to do.');

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, credentialsKeyCheck: true } });
  const rows = await prisma.credential.findMany({ select: { id: true, organizationId: true, passwordEnc: true, notesEnc: true } });

  for (const org of orgs) {
    if (org.credentialsKeyCheck && !keyMatchesCheck(oldKey, org.credentialsKeyCheck)) {
      throw new Error(`${org.name}: CREDENTIALS_KEY_OLD is not the key its logins were saved with. Nothing changed.`);
    }
  }

  // Decrypt everything first: a row that cannot be read stops the whole run before anything is written.
  const updates = rows.map((r) => ({
    id: r.id,
    passwordEnc: encryptWith(newKey, decryptWith(oldKey, r.passwordEnc, r.id), r.id),
    notesEnc: r.notesEnc ? encryptWith(newKey, decryptWith(oldKey, r.notesEnc, r.id), r.id) : null,
  }));

  await prisma.$transaction([
    ...updates.map((u) => prisma.credential.update({ where: { id: u.id }, data: { passwordEnc: u.passwordEnc, notesEnc: u.notesEnc } })),
    ...orgs
      .filter((o) => o.credentialsKeyCheck)
      .map((o) => prisma.organization.update({ where: { id: o.id }, data: { credentialsKeyCheck: makeKeyCheck(newKey) } })),
  ]);

  console.log(`Re-encrypted ${updates.length} login${updates.length === 1 ? '' : 's'} across ${orgs.length} organisation${orgs.length === 1 ? '' : 's'}.`);
  console.log('Now put the new key in .env as CREDENTIALS_KEY, restart the API, and destroy the old key.');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
