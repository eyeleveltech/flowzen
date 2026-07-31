import { redirect } from 'next/navigation';

// "/invoices" and "/invoice-drafts" used to be two nav pages over the SAME endpoint — this
// read-only twin confused the money flow (the Quotations CTA even landed here, where Edit
// doesn't exist). There is one invoice screen now; old links and bookmarks land there too.
export default function InvoicesRedirect() {
  redirect('/invoice-drafts');
}
