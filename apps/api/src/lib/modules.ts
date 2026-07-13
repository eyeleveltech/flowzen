import { prisma } from './prisma.js';

// The modules every new organization starts with (both enabled).
export const DEFAULT_MODULES = ['CRM', 'PM', 'REVENUE'] as const;

export async function getEnabledModuleKeys(organizationId: string): Promise<string[]> {
  const rows = await prisma.organizationModule.findMany({
    where: { organizationId, enabled: true },
    select: { key: true },
  });
  return rows.map((r) => r.key);
}

export async function seedDefaultModules(organizationId: string): Promise<void> {
  await prisma.organizationModule.createMany({
    data: DEFAULT_MODULES.map((key) => ({ organizationId, key })),
    skipDuplicates: true,
  });
}
