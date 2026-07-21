'use client';

import { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { formatShortDate } from '@/lib/utils';
import { ChevronsLeft, ChevronsRight, Clock, MessageSquare, Paperclip, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';

const TASK_STAGES = [
  'BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'BLOCKED', 'ON_HOLD', 'COMPLETED'
];

const GROUPS = [
  { id: 'Backlog', title: 'Backlog', color: '#6b7280', stages: ['BACKLOG'] },
  { id: 'Todo', title: 'To Do', color: '#8b5cf6', stages: ['TODO'] },
  { id: 'InProgress', title: 'In Progress', color: '#3b82f6', stages: ['IN_PROGRESS'] },
  { id: 'Review', title: 'Review', color: '#f59e0b', stages: ['REVIEW', 'APPROVED'] },
  { id: 'Blocked', title: 'Blocked', color: '#ef4444', stages: ['BLOCKED'] },
  { id: 'OnHold', title: 'On Hold', color: '#a855f7', stages: ['ON_HOLD'] },
  { id: 'Completed', title: 'Completed', color: '#10b981', stages: ['COMPLETED'] },
];

import { getPriorityBadge } from '@/lib/priority';

export function TaskBoardView({ tasks, onUpdateTask, onTaskClick }: { tasks: any[]; onUpdateTask?: () => void; onTaskClick?: (task: any) => void }) {
  const [localTasks, setLocalTasks] = useState<any[]>(tasks);
  const [collapsedColumns, setCollapsedColumns] = useState<string[]>([]);
  const [stageMenu, setStageMenu] = useState<{ task: any; x: number; y: number; up: boolean } | null>(null);

  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('flowzen:tasks:collapsed-columns');
      if (saved) setCollapsedColumns(JSON.parse(saved));
    } catch (e) {}
  }, []);

  const toggleCollapse = (columnId: string) => {
    setCollapsedColumns(prev => {
      const next = prev.includes(columnId) ? prev.filter(c => c !== columnId) : [...prev, columnId];
      sessionStorage.setItem('flowzen:tasks:collapsed-columns', JSON.stringify(next));
      return next;
    });
  };

  const columns = useMemo(() => {
    const cols: Record<string, any[]> = {};
    GROUPS.forEach(g => cols[g.id] = []);
    localTasks.forEach(task => {
      const group = GROUPS.find(g => g.stages.includes(task.status));
      if (group) cols[group.id].push(task);
    });
    return cols;
  }, [localTasks]);

  const updateStatus = async (task: any, newStatus: string) => {
    if (task.status === newStatus) return;
    const prev = [...localTasks];
    setLocalTasks(localTasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    
    try {
      await api.put(`/tasks/${task.id}`, { status: newStatus });
      toast.success('Task status updated');
      if (onUpdateTask) onUpdateTask();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update task status');
      setLocalTasks(prev);
    }
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const { source, destination, draggableId } = result;
    if (source.droppableId === destination.droppableId) return;

    const task = localTasks.find(t => t.id === draggableId);
    if (!task) return;

    const destGroup = GROUPS.find(g => g.id === destination.droppableId);
    if (!destGroup) return;

    const newStatus = destGroup.stages[0];
    updateStatus(task, newStatus);
  };

  return (
    <div className="w-full flex flex-col h-[calc(100vh-250px)] min-h-125 overflow-hidden">
      <div className="flex flex-1 w-full overflow-x-auto overflow-y-hidden gap-4 pb-2 px-1 custom-scrollbar min-h-0">
        <DragDropContext onDragEnd={handleDragEnd}>
          {GROUPS.map((group) => {
            const columnTasks = columns[group.id] || [];
            const isCollapsed = collapsedColumns.includes(group.id);

            if (isCollapsed) {
              return (
                <div
                  key={group.id}
                  onClick={() => toggleCollapse(group.id)}
                  className="flex flex-col w-12 h-full shrink-0 border border-border rounded-xl cursor-pointer py-4 justify-between items-center transition-all select-none bg-white/50 hover:bg-white shadow-sm"
                  style={{ borderTop: `4px solid ${group.color}` }}
                >
                  <button type="button" className="p-1 rounded-lg transition-colors text-secondary hover:text-primary">
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                  <div className="flex flex-col items-center justify-center flex-1">
                    <span className="rotate-90 origin-center whitespace-nowrap text-xs font-bold uppercase tracking-wider select-none text-secondary">
                      {group.title}
                    </span>
                  </div>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm" style={{ backgroundColor: group.color }}>
                    {columnTasks.length}
                  </div>
                </div>
              );
            }

            return (
              <div key={group.id} className="flex flex-col flex-1 min-w-70 max-w-85 h-full shrink-0 border border-border bg-[#F9FAFB] rounded-xl overflow-hidden shadow-sm">
                {/* Column Header */}
                <div className="px-4 py-3 flex items-center justify-between shrink-0 bg-white border-b border-border" style={{ borderTop: `3px solid ${group.color}` }}>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(group.id)}
                      className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                    >
                      <ChevronsLeft className="w-4 h-4" />
                    </button>
                    <h3 className="text-sm font-semibold text-primary">{group.title}</h3>
                  </div>
                  <div className="bg-gray-100 px-2.5 py-0.5 rounded-full text-xs font-semibold text-secondary">
                    {columnTasks.length}
                  </div>
                </div>

                {/* Droppable Area */}
                <Droppable droppableId={group.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 p-3 overflow-y-auto space-y-3 transition-colors custom-scrollbar min-h-0 ${
                        snapshot.isDraggingOver ? 'bg-gray-100/50' : ''
                      }`}
                    >
                      {columnTasks.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              onClick={() => {
                                if (onTaskClick) onTaskClick(task);
                              }}
                              className={`bg-white rounded-xl p-3 border border-border cursor-pointer group ${
                                snapshot.isDragging ? 'shadow-2xl scale-105 z-50 ring-2 ring-primary' : 'shadow-sm hover:shadow-md hover:border-gray-300'
                              } transition-all relative`}
                            >
                              <div className="flex justify-between items-start mb-2 gap-2">
                                <h4 className="text-sm font-medium text-primary leading-tight line-clamp-2">{task.title}</h4>
                                <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${getPriorityBadge(task.priority)}`}>
                                  {task.priority}
                               </span>
                              </div>
                              
                              <div className="flex items-center gap-3 mt-3">
                                {task.dueDate && (
                                  <div className={`flex items-center gap-1 text-[11px] font-medium ${new Date(task.dueDate) < new Date() && task.status !== 'COMPLETED' ? 'text-red-500' : 'text-gray-500'}`}>
                                    <Clock className="w-3 h-3" />
                                    <span>{formatShortDate(task.dueDate)}</span>
                                  </div>
                                )}
                                {(task._count?.comments > 0 || task._count?.attachments > 0) && (
                                  <div className="flex items-center gap-2 text-gray-400">
                                    {task._count?.comments > 0 && (
                                      <div className="flex items-center gap-0.5">
                                        <MessageSquare className="w-3 h-3" />
                                        <span className="text-[10px]">{task._count.comments}</span>
                                      </div>
                                    )}
                                    {task._count?.attachments > 0 && (
                                      <div className="flex items-center gap-0.5">
                                        <Paperclip className="w-3 h-3" />
                                        <span className="text-[10px]">{task._count.attachments}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  {task.assignees?.map((assignee: any) => (
                                    <div key={assignee.id} className="relative group/avatar">
                                      {assignee.avatar ? (
                                        <img src={assignee.avatar} alt={assignee.name} className="w-6 h-6 rounded-full border border-white" />
                                      ) : (
                                        <div className="w-6 h-6 rounded-full border border-white bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary" title={assignee.name}>
                                          {assignee.name.charAt(0)}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {(!task.assignees || task.assignees.length === 0) && (
                                    <div className="w-6 h-6 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-gray-400 bg-gray-50 text-[10px]">
                                      ?
                                    </div>
                                  )}
                                </div>
                                
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    const up = rect.bottom + 200 > window.innerHeight;
                                    setStageMenu({ task, x: rect.right, y: up ? rect.top : rect.bottom, up });
                                  }}
                                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-secondary bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-primary transition-colors"
                                >
                                  {task.status.replace('_', ' ')} <ChevronDown className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </DragDropContext>
      </div>

      {stageMenu && (
        <>
          <div className="fixed inset-0 z-60" onClick={() => setStageMenu(null)} />
          <div
            className="fixed z-61 w-48 max-h-80 overflow-y-auto bg-white rounded-xl shadow-2xl border border-border py-1"
            style={{
              top: stageMenu.up ? stageMenu.y - 6 : stageMenu.y + 6,
              left: stageMenu.x,
              transform: stageMenu.up ? 'translate(-100%, -100%)' : 'translateX(-100%)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-3 py-2 text-[11px] font-semibold text-secondary uppercase tracking-wider">Change Status</p>
            {TASK_STAGES.map((stage) => {
              const isCurrent = stage === stageMenu.task.status;
              const groupInfo = GROUPS.find(g => g.stages.includes(stage));
              return (
                <button
                  key={stage}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => {
                    setStageMenu(null);
                    updateStatus(stageMenu.task, stage);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${
                    isCurrent ? 'text-gray-300 cursor-default bg-gray-50/50' : 'text-primary hover:bg-gray-50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: groupInfo?.color }} />
                    {stage.replace('_', ' ')}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(156, 163, 175, 0.3); border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: rgba(156, 163, 175, 0.5); }
      `}</style>
    </div>
  );
}
