import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sparkline } from './Sparkline';
import { compactMoney } from './format';

/**
 * The sparkline: eight weeks, each one a target that says itself, a gap where
 * a week has no value, and the latest week marked.
 */

const WEEKS = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
const points = (values: (number | null)[]) => WEEKS.map((weekStart, i) => ({ weekStart, value: values[i] }));
const money = (n: number) => compactMoney(n, 'INR');

describe('Sparkline', () => {
  it('draws one point per week and says each week in words', () => {
    render(<Sparkline points={points([0, 50000, 120000, 90000, 180000, 160000, 175000, 220000])} format={money} label="Cash collected, rising" />);
    const weeks = screen.getAllByRole('button');
    expect(weeks).toHaveLength(8);
    expect(weeks[5]).toHaveAccessibleName('Week of 14 Sep: ₹1.6L');
    expect(weeks[7]).toHaveAccessibleName('Week of 28 Sep: ₹2.2L');
    expect(screen.getByText('Cash collected, rising')).toBeInTheDocument();

    const line = screen.getByTestId('sparkline').querySelectorAll('path')[1].getAttribute('d')!;
    // One move, then seven lines: a single unbroken run.
    expect(line.match(/M/g)).toHaveLength(1);
    expect(line.match(/L/g)).toHaveLength(7);
  });

  it('shows the week under the pointer', () => {
    render(<Sparkline points={points([0, 0, 0, 0, 0, 0, 10000, 50000])} format={money} label="Cash" />);
    fireEvent.mouseEnter(screen.getAllByRole('button')[6]);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Week of 21 Sep: ₹10K');
    fireEvent.mouseLeave(screen.getAllByRole('button')[6]);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('leaves a gap for a week with no value instead of drawing a zero', () => {
    render(<Sparkline points={points([90, 95, null, null, 120, 100, 95, 80])} format={(n) => `${n} min`} label="Approval time" />);
    const line = screen.getByTestId('sparkline').querySelectorAll('path')[1].getAttribute('d')!;
    expect(line.match(/M/g)).toHaveLength(2);
    expect(screen.getAllByRole('button')[2]).toHaveAccessibleName('Week of 24 Aug: none');
  });

  it('draws a flat line for a figure that was nothing every week', () => {
    render(<Sparkline points={points([0, 0, 0, 0, 0, 0, 0, 0])} format={money} label="Deals" />);
    const line = screen.getByTestId('sparkline').querySelectorAll('path')[1].getAttribute('d')!;
    const ys = [...line.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => m[1]);
    expect(new Set(ys).size).toBe(1);
  });
});
