import { notFound } from 'next/navigation';

/**
 * Any address that matches no screen.
 *
 * Next.js answers an unmatched URL with the ROOT not-found, outside every
 * layout — so a typo or an old link dropped somebody out of the app entirely,
 * sidebar and all. Catching it here instead and calling notFound() renders this
 * group's not-found.tsx, inside the dashboard layout. Every real screen is a
 * more specific route and wins over this one.
 */
export default function Missing() {
  notFound();
}
