'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore, useUIStore } from '@/stores';
import { Sidebar } from '@/components/layout/sidebar';
import { TopNav } from '@/components/layout/top-nav';
import { BottomTabs } from '@/components/layout/bottom-tabs';
import { CommandPalette } from '@/components/layout/command-palette';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { X, Bell } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isAuthenticated, loadFromStorage } = useAuthStore();
  const { sidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();
  const { activeToast, clearToast } = useNotificationStore();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    loadFromStorage();
    
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [loadFromStorage]);

  useEffect(() => {
    const userStr = localStorage.getItem('flowzen-user');
    if (!userStr && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  // Close mobile sidebar when route changes
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [router, setMobileSidebarOpen]);

  return (
    <div className="flex min-h-screen bg-white">
      {/* Desktop Sidebar only — hidden on mobile */}
      {!isMobile && <Sidebar isMobile={false} />}
      
      <motion.main
        animate={{ marginLeft: isMobile ? 0 : (sidebarCollapsed ? 72 : 260) }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        className="flex-1 flex flex-col min-w-0 bg-surface w-full"
      >
        <TopNav isMobile={isMobile} />
        <div className={`px-4 sm:px-6 lg:px-8 py-8 w-full max-w-[1600px] mx-auto overflow-x-hidden ${isMobile ? 'pb-24' : ''}`}>
          {children}
        </div>
      </motion.main>

      {/* Bottom Tabs — mobile only */}
      {isMobile && <BottomTabs />}

      <CommandPalette />

      {/* Real-time Toast Notification — positioned above bottom tabs on mobile */}
      {activeToast && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className={`fixed ${isMobile ? 'bottom-20 left-4 right-4' : 'bottom-6 right-6 w-80'} z-50 flex items-start gap-3 rounded-2xl border border-border bg-white p-4 shadow-xl shadow-black/5`}
        >
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Bell className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">New Notification</p>
            <p className="mt-1 text-xs text-secondary leading-snug">{activeToast.message}</p>
          </div>
          <button
            onClick={clearToast}
            className="flex shrink-0 items-center justify-center rounded-lg p-1 text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </div>
  );
}
