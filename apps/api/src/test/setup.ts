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
