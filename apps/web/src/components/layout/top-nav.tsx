'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore, useAuthStore } from '@/stores';
import { api } from '@/lib/api';
import { useNotifications } from '@/hooks/useQueries';
import { useQueryClient } from '@tanstack/react-query';
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
  Menu,
  Target,
} from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import toast from 'react-hot-toast';

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

export function TopNav({ isMobile }: { isMobile?: boolean }) {
  const router = useRouter();
  const { setCommandPaletteOpen, setMobileSidebarOpen } = useUIStore();
  const { user, logout } = useAuthStore();

  const queryClient = useQueryClient();
  const { data: notifData } = useNotifications();
  const notifications = notifData?.notifications || [];
  const unreadCount = notifData?.unreadCount || 0;

  const markAsRead = async (id: string) => {
    // Optimistically flip read + decrement the badge so the UI responds instantly.
    const previous = queryClient.getQueryData(['notifications']);
    queryClient.setQueryData(['notifications'], (old: any) => {
      if (!old) return old;
      const target = old.notifications?.find((n: any) => n.id === id);
      if (!target || target.read) return old;
      return {
        ...old,
        notifications: old.notifications.map((n: any) => (n.id === id ? { ...n, read: true } : n)),
        unreadCount: Math.max(0, (old.unreadCount || 0) - 1),
      };
    });
    try {
      await api.patch(`/notifications/${id}/read`);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err: any) {
      queryClient.setQueryData(['notifications'], previous); // rollback
      toast.error('Failed to mark read');
    }
  };

  const markAllAsRead = async () => {
    const previous = queryClient.getQueryData(['notifications']);
    queryClient.setQueryData(['notifications'], (old: any) => old ? ({
      ...old,
      notifications: old.notifications?.map((n: any) => ({ ...n, read: true })) || [],
      unreadCount: 0,
    }) : old);
    try {
      await api.patch('/notifications/read-all');
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All marked as read');
    } catch (err: any) {
      queryClient.setQueryData(['notifications'], previous); // rollback
      toast.error('Failed to mark all read');
    }
  };

  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  useEffect(() => {
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
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const quickCreateItems = [
    { label: 'New Client', href: '/clients?create=true', icon: Users },
    { label: 'New Project', href: '/projects?create=true', icon: FolderKanban },
    { label: 'New Task', href: '/tasks?create=true', icon: CheckSquare },
    { label: 'New Lead', href: '/pipeline?create=true', icon: Target },
  ];

  return (
    <header className="sticky top-0 z-30 flex h-14 md:h-16 items-center justify-between border-b border-border bg-white/80 backdrop-blur-xl px-4 sm:px-6">
      <div className="flex items-center">


        {/* Search */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 sm:px-4 py-2 text-sm text-[#9CA3AF] hover:bg-white hover:border-[#D1D5DB] transition-all duration-150 w-auto sm:w-80"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">Search everything...</span>
          <span className="sm:hidden">Search...</span>
          <kbd className="ml-auto hidden sm:inline-flex items-center gap-0.5 rounded-md border border-border bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#9CA3AF]">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 dropdown-container">
        {/* Quick Create */}
        <div className="relative">
          <button
            onClick={() => { setShowQuickCreate(!showQuickCreate); setShowNotifications(false); setShowUserMenu(false); }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-secondary hover:bg-[#F9FAFB] hover:text-primary transition-all duration-150"
          >
            <Plus className="h-4 w-4" />
          </button>

          {isMobile ? (
            <Drawer isOpen={showQuickCreate} onClose={() => setShowQuickCreate(false)} title="Quick Create">
              <div className="flex flex-col gap-1 pb-4">
                {quickCreateItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => { router.push(item.href); setShowQuickCreate(false); }}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-base text-[#374151] hover:bg-[#F9FAFB] active:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6]">
                      <item.icon className="h-5 w-5 text-secondary" />
                    </div>
                    {item.label}
                  </button>
                ))}
              </div>
            </Drawer>
          ) : (
            <AnimatePresence>
              {showQuickCreate && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-48 rounded-2xl border border-border bg-white p-1.5 shadow-lg shadow-black/5"
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
          )}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => { setShowNotifications(!showNotifications); setShowQuickCreate(false); setShowUserMenu(false); }}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border text-secondary hover:bg-[#F9FAFB] hover:text-primary transition-all duration-150"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -right-1 -top-1 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </motion.span>
            )}
          </button>

          {isMobile ? (
            <Drawer isOpen={showNotifications} onClose={() => setShowNotifications(false)} title="Notifications">
              {unreadCount > 0 && (
                <div className="flex justify-end mb-2">
                  <button onClick={markAllAsRead} className="text-xs font-medium text-secondary hover:text-primary transition-colors bg-[#F9FAFB] px-3 py-1.5 rounded-lg">
                    Mark all read
                  </button>
                </div>
              )}
              <div className="max-h-[60vh] overflow-y-auto divide-y divide-[#F3F4F6] -mx-6 border-t border-[#F3F4F6]">
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
                        className={`flex gap-3 px-6 py-4 cursor-pointer hover:bg-[#F9FAFB] transition-colors ${!n.read ? 'bg-blue-50/50' : ''}`}
                      >
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6]">
                          <Icon className="h-4 w-4 text-secondary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] text-[#374151] leading-snug">{n.message}</p>
                          <p className="text-xs text-[#9CA3AF] mt-1">{formatRelativeDate(n.createdAt)}</p>
                        </div>
                        {!n.read && <div className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-[#3B82F6]" />}
                      </div>
                    );
                  })
                )}
              </div>
            </Drawer>
          ) : (
            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-96 rounded-2xl border border-border bg-white shadow-lg shadow-black/5"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6]">
                    <h3 className="text-sm font-semibold text-primary">Notifications</h3>
                    {unreadCount > 0 && (
                      <button onClick={markAllAsRead} className="text-xs text-secondary hover:text-primary transition-colors">
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
                              <Icon className="h-3.5 w-3.5 text-secondary" />
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
          )}
        </div>

        {/* User menu */}
        <div className="relative ml-1">
          <button
            onClick={() => { setShowUserMenu(!showUserMenu); setShowNotifications(false); setShowQuickCreate(false); }}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-[#F9FAFB] transition-all duration-150"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${user ? getAvatarColor(user.name) : 'bg-primary text-white'}`}>
              {user ? getInitials(user.name) : '??'}
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-[#9CA3AF]" />
          </button>

          {isMobile ? (
            <Drawer isOpen={showUserMenu} onClose={() => setShowUserMenu(false)} title="Account">
              <div className="px-4 py-3.5 mb-3 bg-[#F9FAFB] rounded-xl border border-border flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold ${user ? getAvatarColor(user.name) : 'bg-primary text-white'}`}>
                  {user ? getInitials(user.name) : '??'}
                </div>
                <div>
                  <p className="text-base font-semibold text-primary leading-snug">{user?.name}</p>
                  <p className="text-sm text-secondary">{user?.email}</p>
                </div>
              </div>
              <div className="flex flex-col gap-1 pb-4">
                <button
                  onClick={() => { router.push('/profile'); setShowUserMenu(false); }}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-base text-[#374151] hover:bg-[#F9FAFB] active:bg-[#F3F4F6] transition-colors"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6]">
                    <UserIcon className="h-5 w-5 text-secondary" />
                  </div>
                  My Profile
                </button>
                {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') && (
                  <button
                    onClick={() => { router.push('/settings'); setShowUserMenu(false); }}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-base text-[#374151] hover:bg-[#F9FAFB] active:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6]">
                      <Settings className="h-5 w-5 text-secondary" />
                    </div>
                    Settings
                  </button>
                )}
                <button
                  onClick={() => { logout(); window.location.href = '/login'; }}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-base text-danger hover:bg-red-50 active:bg-red-100 transition-colors"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-danger">
                    <LogOut className="h-5 w-5" />
                  </div>
                  Sign out
                </button>
              </div>
            </Drawer>
          ) : (
            <AnimatePresence>
              {showUserMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-56 rounded-2xl border border-border bg-white p-1.5 shadow-lg shadow-black/5"
                >
                  <div className="px-3 py-2 mb-1">
                    <p className="text-sm font-medium text-primary">{user?.name}</p>
                    <p className="text-xs text-[#9CA3AF]">{user?.email}</p>
                  </div>
                  <div className="border-t border-[#F3F4F6] pt-1">
                    <button
                      onClick={() => { router.push('/profile'); setShowUserMenu(false); }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-[#374151] hover:bg-[#F9FAFB] transition-colors"
                    >
                      <UserIcon className="h-4 w-4 text-[#9CA3AF]" />
                      My Profile
                    </button>
                    {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') && (
                      <button
                        onClick={() => { router.push('/settings'); setShowUserMenu(false); }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-[#374151] hover:bg-[#F9FAFB] transition-colors"
                      >
                        <Settings className="h-4 w-4 text-[#9CA3AF]" />
                        Settings
                      </button>
                    )}
                    <button
                      onClick={() => { logout(); window.location.href = '/login'; }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-danger hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>

    </header>
  );
}
