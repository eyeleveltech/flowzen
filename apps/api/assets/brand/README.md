# Brand assets for PDF generation (quotations / proforma)

Drop your logo files here. The quote PDF service reads them from disk and embeds them
(base64) so the PDF always renders correctly — no network dependency.

## Files to add
- `logo.png`        — primary logo, used in the header (transparent background).
- `logo-white.png`  — OPTIONAL: white/inverted version, only needed if the header band is a dark/brand colour.
- `logo-footer.png` — OPTIONAL: a smaller mark for the footer (falls back to `logo.png` if absent).

## Specs
- PNG with transparent background, OR SVG (vector, sharpest in print).
- At least ~600px wide (or 2x the display size) so it's crisp on A4.
