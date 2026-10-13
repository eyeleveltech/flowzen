/**
 * Salaries are counted once, and only as people cost (Money Plan 2, decision 3).
 *
 * People cost is each person's monthly cost (Team) shared out by the time
 * split. A cost row called "Salaries" is the same money a second time, so a
 * new one is refused — and the clean-up report finds the ones already there,
 * by their category or vendor, for a person to decide about.
 */
export const looksLikeSalary = (text: string | null | undefined): boolean =>
  /salar|payroll|stipend|\bwages?\b|\bctc\b/i.test(text ?? '');

export const SALARY_NOT_A_COST =
  "Salaries aren't entered as costs. They come from each person's monthly cost on Team and the time split, so a cost would count them twice.";
