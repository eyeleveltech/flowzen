'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore, useUIStore } from '@/stores';
import { Sidebar } from '@/components/layout/sidebar';
import { TopNav } from '@/components/layout/top-nav';
import { CommandPalette } from '@/components/layout/command-palette';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { X, Bell } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isAuthenticated, loadFromStorage } = useAuthStore();
  const { sidebarCollapsed } = useUIStore();
  const { activeToast, clearToast, addToast } = useNotificationStore();
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    const userStr = localStorage.getItem('flowzen-user');
    if (!userStr && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar />
      <motion.main
        animate={{ marginLeft: sidebarCollapsed ? 72 : 260 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        className="flex-1 min-w-0"
      >
        <TopNav />
        {user && user.isEmailVerified === false && (
          <div className="bg-[#FEF2F2] border-b border-[#FEE2E2] px-8 py-3 flex items-center justify-between">
            <p className="text-sm text-[#991B1B]">
              <strong>Please verify your email.</strong> We sent a verification link to {user.email}.
            </p>
            <button
              onClick={async () => {
                try {
                  setIsResending(true);
                  await api.post('/auth/resend-verification');
                  addToast({ id: Date.now().toString(), type: 'SUCCESS', message: 'Verification email sent!', read: false, createdAt: new Date().toISOString() });
                } catch (err: any) {
                  addToast({ id: Date.now().toString(), type: 'ERROR', message: err.message || 'Failed to send email', read: false, createdAt: new Date().toISOString() });
                } finally {
                  setIsResending(false);
                }
              }}
              disabled={isResending}
              className="text-xs font-medium px-3 py-1.5 bg-white text-[#991B1B] border border-[#FCA5A5] rounded-md hover:bg-[#FEF2F2] disabled:opacity-50 transition-colors"
            >
              {isResending ? 'Sending...' : 'Resend Email'}
            </button>
          </div>
        )}
        <div className="px-8 py-6">
          {children}
        </div>
      </motion.main>
      <CommandPalette />

      {/* Real-time Toast Notification */}
      {activeToast && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className="fixed bottom-6 right-6 z-50 flex w-80 items-start gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-xl shadow-black/5"
        >
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Bell className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-[#111827]">New Notification</p>
            <p className="mt-1 text-xs text-[#6B7280] leading-snug">{activeToast.message}</p>
          </div>
          <button
            onClick={clearToast}
            className="flex shrink-0 items-center justify-center rounded-lg p-1 text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#111827] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </div>
  );
}
