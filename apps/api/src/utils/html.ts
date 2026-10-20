/**
 * Text going into HTML — an email, a PDF, a preview.
 *
 * Everything a person wrote is escaped before it is put into markup: a task
 * title, an event's place, a name, an alert's message. Without it a calendar
 * event titled `<img src=…>` arrived in sixty colleagues' inboxes as an image
 * fetched from wherever the title said, sent from the studio's own mail
 * account (security fixes plan, H3 and H4).
 *
 * One helper, so a template cannot have a weaker copy of it. Null and
 * undefined read as empty.
 */
export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * A link somebody typed, safe to put in an `href`: http or https only, and
 * escaped. Anything else (`javascript:`, `data:`) comes back null, so the
 * template leaves the link out rather than printing it.
 */
export const safeHref = (url: string | null | undefined): string | null => {
  const s = String(url ?? '').trim();
  return /^https?:\/\//i.test(s) ? escapeHtml(s) : null;
};
