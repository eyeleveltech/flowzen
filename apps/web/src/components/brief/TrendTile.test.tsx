import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendTile } from './TrendTile';
import { minutesLabel } from './format';

/**
 * The delta chip is coloured by what the move MEANS, not which way it went:
 * more cash is good (green), a longer approval time is not (red).
 */

const points = [60, 70, 80, 90, 75, 70, 60, 120].map((value, i) => ({ weekStart: `2026-08-${String(10 + i).padStart(2, '0')}`, value }));
const tile = (props: Partial<Parameters<typeof TrendTile>[0]>) =>
  render(
    <TrendTile
      label="Approvals · All work"
      value={120}
      previous={60}
      format={minutesLabel}
      points={points}
      pointFormat={minutesLabel}
      note="Typical time"
      onOpen={vi.fn()}
      openLabel="Approvals"
      {...props}
    />,
  );
const chip = () => screen.getByText('Up').parentElement!;

describe('TrendTile', () => {
  it('shows approval time going up as a red chip', () => {
    tile({ upIsGood: false });
    expect(chip()).toHaveTextContent('100%');
    expect(chip().className).toContain('text-danger');
  });

  it('shows money going up as a green chip', () => {
    tile({ label: 'Cash collected', value: 200000, previous: 100000, format: (n) => `₹${n}`, pointFormat: (n) => `₹${n}` });
    expect(chip()).toHaveTextContent('100%');
    expect(chip().className).toContain('text-success');
  });

  it('gives no percentage when the week before had nothing', () => {
    tile({ label: 'Deals won', value: 30000, previous: 0, format: (n) => `₹${n}`, pointFormat: (n) => `₹${n}` });
    expect(chip()).toHaveTextContent('from none');
    expect(chip()).not.toHaveTextContent('%');
  });

  it('says the trend in words', () => {
    tile({ upIsGood: false });
    expect(screen.getByText('Approvals · All work over eight weeks: from 1 h to 2 h, rising.')).toBeInTheDocument();
  });
});
