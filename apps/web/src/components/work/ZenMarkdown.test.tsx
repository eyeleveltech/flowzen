import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ZenMarkdown } from './ZenMarkdown';

/**
 * Zen's answers as Markdown (Zen Plan 2): links that go somewhere, tables that
 * are tables, and a model's writing that can never become markup.
 */
describe('ZenMarkdown', () => {
  it('links inside the app stay in the app, and outside links open a new tab', () => {
    render(<ZenMarkdown text="See [Acme](/companies/c1) or [their site](https://acme.example)." />);

    const inside = screen.getByRole('link', { name: 'Acme' });
    expect(inside).toHaveAttribute('href', '/companies/c1');
    expect(inside).not.toHaveAttribute('target');

    const outside = screen.getByRole('link', { name: 'their site' });
    expect(outside).toHaveAttribute('href', 'https://acme.example');
    expect(outside).toHaveAttribute('target', '_blank');
    expect(outside).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('draws a table and a bold figure', () => {
    render(<ZenMarkdown text={'Profit is **₹1,20,000**.\n\n| Client | Fee |\n| --- | --- |\n| Acme | ₹50,000 |'} />);

    expect(screen.getByText('₹1,20,000').tagName).toBe('STRONG');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Client' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '₹50,000' })).toBeInTheDocument();
  });

  it('never renders HTML from an answer', () => {
    const { container } = render(
      <ZenMarkdown text={'Before <script>alert(1)</script> <img src=x onerror="alert(2)"> after'} />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Before');
    expect(container.textContent).toContain('after');
  });

  it('drops a javascript: link rather than making it clickable', () => {
    render(<ZenMarkdown text="[click me](javascript:alert(1))" />);
    const link = screen.queryByRole('link', { name: 'click me' });
    expect(link?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });
});
