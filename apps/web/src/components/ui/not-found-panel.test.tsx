import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NotFoundPanel } from './not-found-panel';
import { ApiError } from '@/lib/api-v2';

const back = { href: '/assets', label: 'Back to Assets' };

describe('NotFoundPanel', () => {
  it('says "isn\'t here" only when the server answered 404', () => {
    render(<NotFoundPanel thing="asset" error={new ApiError('Not found', 404)} back={back} onRetry={vi.fn()} />);

    expect(screen.getByRole('heading', { name: "This asset isn't here" })).toBeInTheDocument();
    expect(screen.getByText('It may have been removed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Assets' })).toHaveAttribute('href', '/assets');
    // Nothing to try again: it is gone, not failing.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says "couldn\'t load" for any other failure, with Try again — never "isn\'t here"', () => {
    const onRetry = vi.fn();
    // What fetch throws when the API is down or the device is offline.
    render(<NotFoundPanel thing="asset" error={new TypeError('Failed to fetch')} back={back} onRetry={onRetry} />);

    expect(screen.getByRole('heading', { name: "Couldn't load this asset" })).toBeInTheDocument();
    expect(screen.queryByText(/isn't here/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Assets' })).toHaveAttribute('href', '/assets');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
