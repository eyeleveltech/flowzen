'use client';

import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { Check, Trash2 } from 'lucide-react';
import { triggerHaptic } from '@/lib/utils';

interface SwipeableCardProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftThreshold?: number;
  rightThreshold?: number;
}

export function SwipeableCard({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftThreshold = -100,
  rightThreshold = 100,
}: SwipeableCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [isRemoved, setIsRemoved] = useState(false);

  // Background colors based on swipe distance
  const background = useTransform(
    x,
    [-150, -50, 0, 50, 150],
    ['#EF4444', '#FEE2E2', '#F9FAFB', '#D1FAE5', '#10B981'] // Red for left, Green for right
  );

  // Icon opacities
  const leftIconOpacity = useTransform(x, [0, 50, 100], [0, 0.5, 1]); // Swiping right (shows left icon)
  const rightIconOpacity = useTransform(x, [0, -50, -100], [0, 0.5, 1]); // Swiping left (shows right icon)

  // Icon scaling for a "pop" effect
  const leftIconScale = useTransform(x, [50, 100], [0.5, 1]);
  const rightIconScale = useTransform(x, [-50, -100], [0.5, 1]);

  const handleDragEnd = (event: any, info: any) => {
    const offset = info.offset.x;

    if (offset < leftThreshold && onSwipeLeft) {
      triggerHaptic('medium');
      setIsRemoved(true); // Trigger exit animation locally if needed, but parent usually handles unmount
      onSwipeLeft();
    } else if (offset > rightThreshold && onSwipeRight) {
      triggerHaptic('medium');
      onSwipeRight();
    }
  };

  if (isRemoved) return null; // Simple immediate unmount fallback; parent should ideally handle AnimatePresence

  return (
    <div className="relative w-full rounded-xl overflow-hidden mb-3" ref={containerRef}>
      {/* Background Layer */}
      <motion.div
        className="absolute inset-0 flex items-center justify-between px-6 rounded-xl"
        style={{ background }}
      >
        {/* Left Icon (Swiping Right) */}
        <motion.div
          className="flex items-center text-white"
          style={{ opacity: leftIconOpacity, scale: leftIconScale }}
        >
          <Check className="w-6 h-6" />
        </motion.div>

        {/* Right Icon (Swiping Left) */}
        <motion.div
          className="flex items-center text-white"
          style={{ opacity: rightIconOpacity, scale: rightIconScale }}
        >
          <Trash2 className="w-6 h-6" />
        </motion.div>
      </motion.div>

      {/* Foreground Draggable Card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.6}
        onDragEnd={handleDragEnd}
        style={{ x }}
        className="relative z-10 w-full rounded-xl bg-white border border-border shadow-sm touch-pan-y"
      >
        {children}
      </motion.div>
    </div>
  );
}
