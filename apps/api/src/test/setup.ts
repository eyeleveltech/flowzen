/**
 * A secret for the tests, set before anything imports the auth middleware.
 *
 * `utils/jwt.ts` refuses to load with a well-known placeholder — deliberately —
 * and nothing in a unit test loads `.env`. Whether a test file passed therefore
 * depended on whether something earlier in ITS import chain happened to pull in
 * a module that loaded the environment first, which is not a property a test
 * suite should have.
 */
process.env.JWT_SECRET ||= 'unit-tests-do-not-sign-anything-real';

import { vi, beforeEach } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

// Mock the Prisma Client instance
vi.mock('../lib/prisma.js', () => ({
  prisma: mockDeep<PrismaClient>(),
}));

beforeEach(() => {
  // Reset the mock before every test to ensure isolated state
  mockReset(prisma);
});
