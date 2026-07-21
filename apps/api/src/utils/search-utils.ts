export type SearchField = string | Record<string, unknown>;

export function buildSearchFilter(fields: SearchField[], query: string) {
  if (!query || !query.trim()) return {};
  const q = query.trim();
  return {
    OR: fields.map((field) => {
      if (typeof field === 'string') {
        return { [field]: { contains: q, mode: 'insensitive' as const } };
      }
      return field;
    }),
  };
}
