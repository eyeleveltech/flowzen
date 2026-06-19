'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { formatRelativeDate, getInitials } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { Zap, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';

export function ActivityFeedWidget({ itemVariants }: { itemVariants?: any }) {
  const router = useRouter();
  const { user, setAuth } = useAuthStore();
  const [filter, setFilter] = useState('ALL');
  const [markingRead, setMarkingRead] = useState(false);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status
  } = useActivityFeed(filter);

  const activities = data?.pages.flat() || [];
  const lastReadAt = user?.lastActivityReadAt ? new Date(user.lastActivityReadAt).getTime() : 0;

  const handleMarkAsRead = async () => {
    if (markingRead) return;
    try {
      setMarkingRead(true);
      const res = await api.post<{ lastActivityReadAt: string }>('/dashboard/activity/read', {});
      if (user) {
        setAuth({ ...user, lastActivityReadAt: res.lastActivityReadAt });
      }
      toast.success('Marked all as read');
    } catch (e: any) {
      toast.error('Failed to mark as read');
    } finally {
      setMarkingRead(false);
    }
  };

  const getReadableMessage = (item: any) => {
    const actor = item.user?.name || 'Someone';
    
    // Fallbacks
    let target = '';
    let inProject = item.project?.name ? ` in the ${item.project.name} project` : '';

    if (item.entityType === 'TASK') {
      target = item.task?.title ? `'${item.task.title}'` : 'a task';
    } else if (item.entityType === 'PROJECT') {
      target = item.project?.name ? `'${item.project.name}'` : 'a project';
      inProject = ''; // avoid redundancy
    } else if (item.entityType === 'CLIENT') {
      target = item.client?.name ? `'${item.client.name}'` : 'a client';
      inProject = '';
    }

    if (item.type === 'TASK_STATUS_CHANGED') {
      const match = item.message.match(/changed task status to (.+)/);
      const newStatus = match ? match[1].replace('_', ' ') : 'a new status';
      return <><span className="font-semibold text-primary">{actor}</span> moved {target} to <span className="font-medium text-[#374151]">{newStatus}</span>{inProject}</>;
    }
    
    if (item.type === 'TASK_CREATED') {
      return <><span className="font-semibold text-primary">{actor}</span> created task {target}{inProject}</>;
    }

    if (item.type === 'PROJECT_CREATED') {
      return <><span className="font-semibold text-primary">{actor}</span> created project {target}</>;
    }

    // Default fallback if we can't parse it
    return <><span className="font-semibold text-primary">{actor}</span> {item.message}</>;
  };

  const handleClick = (item: any) => {
    if (item.entityType === 'TASK' && item.entityId) {
      router.push(`/tasks?taskId=${item.entityId}`);
    } else if (item.entityType === 'PROJECT' && item.entityId) {
      router.push(`/projects/${item.entityId}`);
    } else if (item.entityType === 'CLIENT' && item.entityId) {
      router.push(`/clients/${item.entityId}`);
    }
  };

  return (
    <motion.div variants={itemVariants} className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5 flex flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-primary shrink-0">
          <Zap className="w-4 h-4 text-secondary"/> Activity Feed
        </h2>
        <button 
          onClick={handleMarkAsRead}
          disabled={markingRead}
          className="text-[11px] font-medium text-secondary hover:text-primary transition-colors flex items-center gap-1 shrink-0"
        >
          <Check className="w-3 h-3" /> Mark read
        </button>
      </div>
      
      <div className="mb-4">
        <Select
          value={filter}
          onChange={setFilter}
          options={[
            { label: 'All Activity', value: 'ALL' },
            { label: 'Tasks only', value: 'TASKS' },
            { label: 'Projects only', value: 'PROJECTS' },
            { label: 'My Activity', value: 'ME' },
          ]}
          className="w-full !py-1.5 !text-xs !rounded-lg"
        />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto custom-scrollbar pr-2 relative max-h-75">
        {status === 'pending' ? (
          <p className="text-sm text-secondary text-center py-8">Loading activity...</p>
        ) : activities.length === 0 ? (
          <p className="text-sm text-secondary text-center py-8">No recent activity.</p>
        ) : (
          <div className="absolute left-2.5 top-2 bottom-2 w-px bg-border -z-10" />
        )}
        
        {activities.map((item: any) => {
          const isUnread = new Date(item.createdAt).getTime() > lastReadAt;
          
          return (
            <div 
              key={item.id} 
              onClick={() => handleClick(item)}
              className="flex gap-3 relative z-0 p-2 -mx-2 rounded-xl hover:bg-surface cursor-pointer transition-colors group"
            >
              <div className="relative">
                <div className="h-5 w-5 rounded-full bg-white border border-border text-primary text-[8px] font-bold flex items-center justify-center shrink-0 shadow-sm mt-0.5 group-hover:border-[#D1D5DB] transition-colors">
                  {getInitials(item.user?.name || '?')}
                </div>
                {isUnread && (
                  <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500 border-2 border-white"></span>
                  </span>
                )}
              </div>
              <div className="pt-0.5 flex-1">
                <p className={`text-xs leading-snug ${isUnread ? 'text-[#111827]' : 'text-[#4B5563]'}`}>
                  {getReadableMessage(item)}
                </p>
                <p className="text-[10px] text-[#9CA3AF] mt-1 font-medium">{formatRelativeDate(item.createdAt)}</p>
              </div>
            </div>
          );
        })}

        {hasNextPage && (
          <div className="pt-2 pb-1 flex justify-center">
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="text-xs font-semibold text-secondary hover:text-primary transition-colors bg-surface px-4 py-1.5 rounded-full border border-border"
            >
              {isFetchingNextPage ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
