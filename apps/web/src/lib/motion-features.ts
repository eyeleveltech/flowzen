/**
 * framer-motion's animation features, loaded after the page rather than with
 * it (Perf Plan 3, decision 3).
 *
 * `motion.*` components carry every feature — animation, gestures, drag and
 * layout — in the bundle that every page loads first. With `LazyMotion` in
 * components/providers.tsx and `m.*` components everywhere, a page paints
 * with the small `m` core and these arrive a moment later.
 *
 * `domMax` rather than the smaller `domAnimation`, because the sliding
 * markers in the sidebar, the bottom tabs and the tabs (`layoutId`) and the
 * drawer (`layout`) are layout animations, which only `domMax` has. Lighter,
 * the markers would jump instead of slide.
 */
import { domMax } from 'framer-motion';

export default domMax;
