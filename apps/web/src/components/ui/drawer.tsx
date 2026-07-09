'use client';

import { ReactNode, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMediaQuery } from '@/hooks/use-media-query';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Drawer({ isOpen, onClose, title, children, className = '' }: DrawerProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen && typeof document === 'undefined') return null;

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm"
          />

          {isMobile ? (
            /* MOBILE: Bottom Sheet */
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`fixed bottom-0 left-0 right-0 z-[201] max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-white shadow-2xl ${className}`}
            >
              <div className="sticky top-0 z-10 flex flex-col items-center justify-center bg-white pt-3 pb-2">
                <div className="h-1.5 w-12 rounded-full bg-gray-300" />
                {title && (
                  <div className="mt-4 flex w-full items-center justify-between px-6">
                    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                    <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100">
                      <X className="h-5 w-5 text-gray-500" />
                    </button>
                  </div>
                )}
              </div>
              <div className="px-6 pb-8 pt-2">{children}</div>
            </motion.div>
          ) : (
            /* DESKTOP: Centered Modal */
            <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className={`w-full max-w-lg pointer-events-auto rounded-2xl bg-white shadow-xl ${className}`}
              >
                {title && (
                  <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                    <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100">
                      <X className="h-5 w-5 text-gray-500" />
                    </button>
                  </div>
                )}
                <div className={title ? "p-6" : ""}>{children}</div>
              </motion.div>
            </div>
          )}
        </>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }

  return null;
}
