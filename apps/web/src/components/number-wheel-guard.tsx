'use client';

/**
 * Stops the mouse wheel changing a number field.
 *
 * A focused number field treats a scroll as a value change. So you
 * click into the amount on an invoice, scroll down to reach the save button,
 * and the amount goes with you — 47,500 becomes 47,497 — with no keystroke, no
 * undo prompt and nothing on screen that looks like an edit. It is the one
 * browser default in this app that can silently alter a figure somebody is
 * about to commit, and every number field here is a rupee amount, a percentage
 * or a count.
 *
 * Blurring rather than `preventDefault`: the page still scrolls, which is what
 * the gesture was for. Cancelling the event instead would trap the scroll
 * inside the field and leave the page stuck.
 *
 * Registered once on the document rather than per input, so the 32 number
 * fields already written and every one written after this are covered without
 * anybody having to remember.
 */

import { useEffect } from 'react';

export function NumberWheelGuard() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === 'number' && el === event.target) {
        el.blur();
      }
    };
    // Passive: this listener never cancels the scroll, and saying so lets the
    // browser keep scrolling on the compositor thread.
    document.addEventListener('wheel', onWheel, { passive: true });
    return () => document.removeEventListener('wheel', onWheel);
  }, []);

  return null;
}
