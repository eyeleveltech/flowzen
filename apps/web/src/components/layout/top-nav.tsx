'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore, useAuthStore } from '@/stores';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { getInitials, formatRelativeDate, getAvatarColor } from '@/lib/utils';
import {
  Search,
  Bell,
  Plus,
  ChevronDown,
  LogOut,
  Settings,
  User as UserIcon,
  X,
  Check,
  CheckSquare,
  FolderKanban,
  Users,
  MessageSquare,
  Clock,
  AlertCircle,
} from 'lucide-react';

interface Notification {
  id: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
}

const notificationIcons: Record<string, typeof CheckSquare> = {
  TASK_ASSIGNED: CheckSquare,
  TASK_COMPLETED: Check,
  DEADLINE_APPROACHING: Clock,
  COMMENT_ADDED: MessageSquare,
  PROJECT_STATUS_CHANGED: FolderKanban,
  CLIENT_ADDED: Users,
};

export function TopNav() {
  const router = useRouter();
  const { setCommandPaletteOpen } = useUIStore();
  const { user, logout } = useAuthStore();
  
  const { notifications, unreadCount, fetchNotifications, markAllAsRead, markAsRead, initializeSocketListeners } = useNotificationStore();

  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  useEffect(() => {
    fetchNotifications();
    initializeSocketListeners();

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.dropdown-container')) {
        setShowNotifications(false);
        setShowUserMenu(false);
        setShowQuickCreate(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      const s = getSocket();
      if (s) s.off('notification:new');
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const quickCreateItems = [
    { label: 'New Client', href: '/clients?create=true', icon: Users },
    { label: 'New Project', href: '/projects?create=true', icon: FolderKanban },
    { label: 'New Task', href: '/tasks?create=true', icon: CheckSquare },
  ];

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#E5E7EB] bg-white/80 backdrop-blur-xl px-6">
      {/* Search */}
      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="flex items-center gap-2.5 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] px-4 py-2 text-sm text-[#9CA3AF] hover:bg-white hover:border-[#D1D5DB] transition-all duration-150 w-80"
      >
        <Search className="h-4 w-4" />
        <span>Search everything...</span>
        <kbd className="ml-auto hidden sm:inline-flex items-center gap-0.5 rounded-md border border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#9CA3AF]">
          ⌘K
        </kbd>
      </button>

      {/* Right side */}
      <div className="flex items-center gap-2 dropdown-container">
        {/* Quick Create */}
        <div className="relative">
          <button
            onClick={() => { setShowQuickCreate(!showQuickCreate); setShowNotifications(false); setShowUserMenu(false); }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827] transition-all duration-150"
          >
            <Plus className="h-4 w-4" />
          </button>

          <AnimatePresence>
            {showQuickCreate && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-48 rounded-2xl border border-[#E5E7EB] bg-white p-1.5 shadow-lg shadow-black/5"
              >
                {quickCreateItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => { router.push(item.href); setShowQuickCreate(false); }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-[#374151] hover:bg-[#F9FAFB] transition-colors"
                  >
                    <item.icon className="h-4 w-4 text-[#9CA3AF]" />
                    {item.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => { setShowNotifications(!showNotifications); setShowQuickCreate(false); setShowUserMenu(false); }}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827] transition-all duration-150"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -right-1 -top-1 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-[#EF4444] px-1 text-[10px] font-semibold text-white"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </motion.span>
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-96 rounded-2xl border border-[#E5E7EB] bg-white shadow-lg shadow-black/5"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6]">
                  <h3 className="text-sm font-semibold text-[#111827]">Notifications</h3>
                  {unreadCount > 0 && (
                    <button onClick={markAllAsRead} className="text-xs text-[#6B7280] hover:text-[#111827] transition-colors">
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-[#F3F4F6]">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-sm text-[#9CA3AF]">No notifications yet</div>
                  ) : (
                    notifications.slice(0, 10).map((n) => {
                      const Icon = notificationIcons[n.type] || AlertCircle;
                      
                      const handleNotificationClick = async () => {
                        if (!n.read) markAsRead(n.id);
                        setShowNotifications(false);
                        if (n.metadata?.taskId) router.push(`/tasks?taskId=${n.metadata.taskId}`);
                        else if (n.metadata?.projectId) router.push(`/projects/${n.metadata.projectId}`);
                      };

                      return (
                        <div 
                          key={n.id} 
                          onClick={handleNotificationClick}
                          className={`flex gap-3 px-4 py-3 cursor-pointer hover:bg-[#F9FAFB] transition-colors ${!n.read ? 'bg-blue-50/50' : ''}`}
                        >
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6]">
                            <Icon className="h-3.5 w-3.5 text-[#6B7280]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-[#374151] leading-snug">{n.message}</p>
                            <p className="text-xs text-[#9CA3AF] mt-0.5">{formatRelativeDate(n.createdAt)}</p>
                          </div>
                          {!n.read && <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#3B82F6]" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User menu */}
        <div className="relative ml-1">
          <button
            onClick={() => { setShowUserMenu(!showUserMenu); setShowNotifications(false); setShowQuickCreate(false); }}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-[#F9FAFB] transition-all duration-150"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-white text-xs font-semibold ${user ? getAvatarColor(user.name) : 'bg-[#111827]'}`}>
              {user ? getInitials(user.name) : '??'}
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-[#9CA3AF]" />
          </button>

          <AnimatePresence>
            {showUserMenu && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-56 rounded-2xl border border-[#E5E7EB] bg-white p-1.5 shadow-lg shadow-black/5"
              >
                <div className="px-3 py-2 mb-1">
                  <p className="text-sm font-medium text-[#111827]">{user?.name}</p>
                  <p className="text-xs text-[#9CA3AF]">{user?.email}</p>
                </div>
                <div className="border-t border-[#F3F4F6] pt-1">
                  <button
                    onClick={() => { router.push('/settings'); setShowUserMenu(false); }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-[#374151] hover:bg-[#F9FAFB] transition-colors"
                  >
                    <Settings className="h-4 w-4 text-[#9CA3AF]" />
                    Settings
                  </button>
                  <button
                    onClick={() => { logout(); window.location.href = '/login'; }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-[#EF4444] hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

    </header>
  );
}
