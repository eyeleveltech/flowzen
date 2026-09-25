'use client';

/**
 * A titled section with a line saying what it is for.
 *
 * Every settings card was built by hand as `Card` + `CardHeader` + `CardTitle`,
 * and then the sentence explaining the section was written as the first child of
 * the body — sometimes `text-xs text-secondary`, sometimes `text-micro`,
 * sometimes above the first field and sometimes below the last one, and on four
 * cards not at all. So a page of nine sections had nine slightly different
 * headers, and the reader had to work out each time whether the small grey line
 * described the section or the field under it.
 *
 * One shape: the title, the sentence directly beneath it, both above the rule.
 */

import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';

export function SectionCard({
  title,
  description,
  aside,
  children,
  bodyClassName = 'space-y-4',
}: {
  title: string;
  /** What this section decides. One sentence, in the header, not the body. */
  description?: React.ReactNode;
  /** A control that belongs to the whole section — a link away, usually. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <Card padding="none">
      <CardHeader className={description ? 'items-start' : undefined}>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <p className="mt-1 text-xs text-secondary">{description}</p>}
        </div>
        {aside && <div className="ml-4 shrink-0">{aside}</div>}
      </CardHeader>
      <CardBody className={bodyClassName}>{children}</CardBody>
    </Card>
  );
}
