'use client';

import DOMPurify from 'isomorphic-dompurify';
import type { HTMLAttributes } from 'react';

/**
 * Renders trusted-looking HTML SAFELY.
 *
 * Rich-text fields (project/client scope, description, internal notes, task description) are
 * authored in the TipTap editor and stored as HTML. The editor only cleans what a user types
 * through the UI — the API accepts any string, so an attacker can PUT a payload like
 * `<img src=x onerror=...>` straight past the editor. Rendering that raw with
 * dangerouslySetInnerHTML is a stored-XSS hole: the script runs in whoever opens the record,
 * including a SUPER_ADMIN opening a note a TEAM_MEMBER planted.
 *
 * Every place that used to do `dangerouslySetInnerHTML={{ __html: value }}` must use this
 * instead. DOMPurify allows only formatting markup and strips every script, event handler,
 * and dangerous URL. It also protects the data already sitting poisoned in the database,
 * which server-side write sanitization alone cannot do.
 */

// The formatting the TipTap StarterKit can produce — nothing that can execute or exfiltrate.
const ALLOWED_TAGS = [
  'p', 'br', 'span', 'div',
  'strong', 'b', 'em', 'i', 's', 'strike', 'del', 'u', 'mark',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre', 'hr',
  'a',
];
// href is allowed but DOMPurify still blocks javascript:/data: URLs; on* handlers are never allowed.
const ALLOWED_ATTR = ['href', 'target', 'rel', 'class'];

interface SafeHtmlProps extends Omit<HTMLAttributes<HTMLDivElement>, 'dangerouslySetInnerHTML' | 'children'> {
  html: string | null | undefined;
}

export function SafeHtml({ html, ...divProps }: SafeHtmlProps) {
  const clean = DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Force any surviving link to open safely and never leak the opener.
    ADD_ATTR: ['target', 'rel'],
  });
  return <div {...divProps} dangerouslySetInnerHTML={{ __html: clean }} />;
}
