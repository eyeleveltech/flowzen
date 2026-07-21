'use client';

import { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useRouter } from 'next/navigation';
import { formatCurrency, formatShortDate } from '@/lib/utils';
import { ChevronDown, ChevronsLeft, ChevronsRight, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';

const PROJECT_STAGES = [
  'PLANNING', 'IN_PROGRESS', 'REVIEW', 'ON_HOLD', 'CANCELLED', 'COMPLETED',
];

const GROUPS = [
  { id: 'Planning', title: 'Planning', color: '#8b5cf6', stages: ['PLANNING'] },
  { id: 'InProgress', title: 'In Progress', color: '#3b82f6', stages: ['IN_PROGRESS'] },
  { id: 'Review', title: 'Review', color: '#f59e0b', stages: ['REVIEW'] },
  { id: 'OnHold', title: 'On Hold', color: '#f97316', stages: ['ON_HOLD'] },
  { id: 'Cancelled', title: 'Cancelled', color: '#ef4444', stages: ['CANCELLED'] },
  { id: 'Completed', title: 'Completed', color: '#10b981', stages: ['COMPLETED'] },
];

const STAGE_BADGES: Record<string, { label: string, bg: string, text: string }> = {
  'PLANNING': { label: 'PLANNING', bg: '#8b5cf6', text: '#ffffff' },
  'IN_PROGRESS': { label: 'IN PROGRESS', bg: '#3b82f6', text: '#ffffff' },
  'REVIEW': { label: 'REVIEW', bg: '#f59e0b', text: '#ffffff' },
  'ON_HOLD': { label: 'ON HOLD', bg: '#ffedd5', text: '#c2410c' },
  'CANCELLED': { label: 'CANCELLED', bg: '#ef4444', text: '#ffffff' },
  'COMPLETED': { label: 'COMPLETED', bg: '#10b981', text: '#ffffff' },
};

export function ProjectBoardView({ projects, onUpdateProject, userRole }: { projects: any[]; onUpdateProject?: () => void; userRole?: string }) {
  const canDrag = ['SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'].includes(userRole || '');
  const router = useRouter();
  const [localProjects, setLocalProjects] = useState<any[]>(projects);
  const [collapsedColumns, setCollapsedColumns] = useState<string[]>([]);
  const [stageMenu, setStageMenu] = useState<{ project: any; x: number; y: number; up: boolean } | null>(null);

  useEffect(() => {
    setLocalProjects(projects);
  }, [projects]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('flowzen:projects:collapsed-columns');
      if (saved) setCollapsedColumns(JSON.parse(saved));
    } catch (e) {}
  }, []);

  const toggleCollapse = (columnId: string) => {
    setCollapsedColumns(prev => {
      const next = prev.includes(columnId) ? prev.filter(c => c !== columnId) : [...prev, columnId];
      sessionStorage.setItem('flowzen:projects:collapsed-columns', JSON.stringify(next));
      return next;
    });
  };

  const columns = useMemo(() => {
    const cols: Record<string, any[]> = {};
    GROUPS.forEach(g => cols[g.id] = []);
    localProjects.forEach(proj => {
      const group = GROUPS.find(g => g.stages.includes(proj.status));
      if (group) cols[group.id].push(proj);
    });
    return cols;
  }, [localProjects]);

  const updateStatus = async (project: any, newStatus: string) => {
    if (project.status === newStatus) return;
    const prev = [...localProjects];
    setLocalProjects(localProjects.map(p => p.id === project.id ? { ...p, status: newStatus } : p));
    
    try {
      await api.put(`/projects/${project.id}`, { status: newStatus });
      toast.success('Project status updated');
      if (onUpdateProject) onUpdateProject();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update project status');
      setLocalProjects(prev);
    }
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const { source, destination, draggableId } = result;
    if (source.droppableId === destination.droppableId) return;

    const project = localProjects.find(p => p.id === draggableId);
    if (!project) return;

    const destGroup = GROUPS.find(g => g.id === destination.droppableId);
    if (!destGroup) return;

    const newStatus = destGroup.stages[0];
    updateStatus(project, newStatus);
  };

  return (
    <div className="w-full flex flex-col h-[calc(100vh-210px)] min-h-137.5 overflow-hidden">
      <div className="flex flex-1 w-full overflow-x-auto overflow-y-hidden gap-4 pb-2 px-1 custom-scrollbar min-h-0">
        <DragDropContext onDragEnd={handleDragEnd}>
          {GROUPS.map((group) => {
            const columnProjects = columns[group.id] || [];
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
                    {columnProjects.length}
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
                    {columnProjects.length}
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
                      {columnProjects.map((project, index) => {
                        const badgeInfo = STAGE_BADGES[project.status];
                        
                        // Calculate progress based on tasks
                        const totalTasks = project._count?.tasks || 0;
                        // Let's assume progress is a visual aid based on tasks. We might not have completed tasks count handy in project listing unless we query it. 
                        // The existing list view usually uses a calculated progress. Let's just mock or omit progress bar if not available.

                        return (
                          <Draggable key={project.id} draggableId={project.id} index={index} isDragDisabled={!canDrag}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                onClick={() => router.push(`/projects/${project.id}`)}
                                className={`bg-white rounded-xl p-4 border border-border ${!canDrag ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} group ${
                                  snapshot.isDragging ? 'shadow-2xl scale-105 z-50 ring-2 ring-primary' : 'shadow-sm hover:shadow-md hover:border-gray-300'
                                } transition-all relative`}
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <div className="pr-4">
                                    <h4 className="text-sm font-bold text-primary truncate" title={project.name}>{project.name}</h4>
                                    <p className="text-xs text-secondary truncate mt-0.5">{project.client?.name}</p>
                                  </div>
                                </div>

                                {project.endDate && (
                                  <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-3">
                                    <Clock className="w-3.5 h-3.5" />
                                    <span>Due {formatShortDate(project.endDate)}</span>
                                  </div>
                                )}

                                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                                  {project.owner && (
                                    <div className="flex items-center gap-2">
                                      {project.owner.avatar ? (
                                        <img src={project.owner.avatar} alt="" className="w-6 h-6 rounded-full" />
                                      ) : (
                                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                                          {project.owner.name.charAt(0)}
                                        </div>
                                      )}
                                      <span className="text-xs font-medium text-secondary truncate max-w-25">{project.owner.name}</span>
                                    </div>
                                  )}
                                  
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                      const up = rect.bottom + 200 > window.innerHeight;
                                      setStageMenu({ project, x: rect.right, y: up ? rect.top : rect.bottom, up });
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-secondary bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-primary transition-colors"
                                  >
                                    Stage <ChevronDown className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
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
            {PROJECT_STAGES.map((stage) => {
              const isCurrent = stage === stageMenu.project.status;
              const groupInfo = GROUPS.find(g => g.stages.includes(stage));
              return (
                <button
                  key={stage}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => {
                    setStageMenu(null);
                    updateStatus(stageMenu.project, stage);
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
