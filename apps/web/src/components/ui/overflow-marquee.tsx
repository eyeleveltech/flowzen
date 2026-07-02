'use client';

import React, { useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface OverflowMarqueeProps {
  children: React.ReactNode;
  className?: string;
}

export function OverflowMarquee({ children, className }: OverflowMarqueeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    setIsMobile(mediaQuery.matches);
    const handleResize = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mediaQuery.addEventListener('change', handleResize);
    return () => mediaQuery.removeEventListener('change', handleResize);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setIsOverflowing(false);
      return;
    }
    const checkOverflow = () => {
      if (containerRef.current && textRef.current) {
        setIsOverflowing(textRef.current.scrollWidth > containerRef.current.clientWidth);
      }
    };
    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    if (containerRef.current) observer.observe(containerRef.current);
    if (textRef.current) observer.observe(textRef.current);
    return () => observer.disconnect();
  }, [isMobile, children]);

  if (!isOverflowing) {
    return (
      <div ref={containerRef} className={cn('min-w-0', className)}>
        <span ref={textRef} className="block break-normal">
          {children}
        </span>
      </div>
    );
  }

  // Seamless marquee: two copies side-by-side, both animated so that when
  // the first scrolls off-screen to the left the second takes its place.
  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden min-w-0', className)}
    >
      {/* Hidden measuring span — stays in DOM to drive ResizeObserver */}
      <span ref={textRef} className="invisible absolute whitespace-nowrap pointer-events-none">
        {children}
      </span>

      {/* Scrolling track — two copies, gap between them */}
      <div className="flex whitespace-nowrap animate-marquee-track hover:[animation-play-state:paused] active:[animation-play-state:paused] motion-reduce:animate-none">
        <span className="inline-block pr-16">{children}</span>
        <span className="inline-block pr-16" aria-hidden="true">{children}</span>
      </div>

      {/* Fade edges */}
      <div className="absolute top-0 left-0 bottom-0 w-6 bg-linear-to-r from-white to-transparent pointer-events-none z-10" />
      <div className="absolute top-0 right-0 bottom-0 w-6 bg-linear-to-l from-white to-transparent pointer-events-none z-10" />
    </div>
  );
}
