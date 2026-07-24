'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, List, LayoutGrid, Link2, Download, Save, RefreshCw, Trash, Copy } from 'lucide-react';
import toast from 'react-hot-toast';

interface ColumnOption {
  id: string;
  label: string;
}

interface ViewSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  viewName: string;
  onViewNameChange: (name: string) => void;
  viewType: 'list' | 'board';
  onViewTypeChange: (type: 'list' | 'board') => void;
  columns: ColumnOption[];
  visibleColumns: string[];
  onVisibleColumnsChange: (cols: string[]) => void;
  onSave: () => void;
  onReset: () => void;
  onClone?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
}

export function ViewSettingsPanel({
  isOpen,
  onClose,
  viewName,
  onViewNameChange,
  viewType,
  onViewTypeChange,
  columns,
  visibleColumns,
  onVisibleColumnsChange,
  onSave,
  onReset,
  onClone,
  onDelete,
  onExport,
}: ViewSettingsPanelProps) {
  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied to clipboard!');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-white border-l border-border shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-secondary" />
                <h2 className="text-base font-bold text-primary">View Settings</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-secondary hover:text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Section 1: View Name */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-secondary uppercase tracking-wider">
                  View Name
                </label>
                <input
                  type="text"
                  value={viewName}
                  onChange={(e) => onViewNameChange(e.target.value)}
                  className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  placeholder="e.g. All Companies"
                />
              </div>

              {/* Section 2: View Type */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-secondary uppercase tracking-wider">
                  Layout View Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onViewTypeChange('list')}
                    className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-sm font-medium transition-all ${
                      viewType === 'list'
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border text-secondary hover:bg-gray-50'
                    }`}
                  >
                    <List className="w-4 h-4" />
                    List (Table)
                  </button>
                  <button
                    onClick={() => onViewTypeChange('board')}
                    className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-sm font-medium transition-all ${
                      viewType === 'board'
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border text-secondary hover:bg-gray-50'
                    }`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                    Board (Cards)
                  </button>
                </div>
              </div>

              {/* Section 3: Visible Columns */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-secondary uppercase tracking-wider">
                  Table Columns
                </label>
                <div className="border border-border rounded-xl divide-y divide-border overflow-hidden bg-white max-h-48 overflow-y-auto">
                  {columns.map((col) => {
                    const isVisible = visibleColumns.includes(col.id);
                    return (
                      <button
                        key={col.id}
                        type="button"
                        onClick={() => {
                          if (isVisible) {
                            onVisibleColumnsChange(visibleColumns.filter((id) => id !== col.id));
                          } else {
                            onVisibleColumnsChange([...visibleColumns, col.id]);
                          }
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-[#F9FAFB] transition-colors"
                      >
                        <span className="text-[#374151]">{col.label}</span>
                        <div className={`w-4.5 h-4.5 rounded border flex items-center justify-center transition-colors ${isVisible ? 'bg-primary border-primary' : 'border-border'}`}>
                          {isVisible && <CheckIcon className="w-3 h-3 text-white" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 4: Sharing & Utilities */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-secondary uppercase tracking-wider">
                  Sharing & Export
                </label>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl border border-border text-sm text-secondary hover:text-primary hover:bg-gray-50 transition-all font-medium text-left"
                  >
                    <span className="flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-muted" />
                      Copy Link to View
                    </span>
                  </button>
                  {onExport && (
                    <button
                      type="button"
                      onClick={onExport}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl border border-border text-sm text-secondary hover:text-primary hover:bg-gray-50 transition-all font-medium text-left"
                    >
                      <span className="flex items-center gap-2">
                        <Download className="w-4 h-4 text-muted" />
                        Export Data (⌘Shift X)
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-border bg-gray-50 flex flex-col gap-2 shrink-0">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onReset}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 border border-border rounded-xl text-sm font-medium text-[#374151] bg-white hover:bg-gray-50 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reset View
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-[#1F2937] transition-colors shadow-sm"
                >
                  <Save className="w-4 h-4" />
                  Save (⌘S)
                </button>
              </div>
              {onClone && (
                <button
                  type="button"
                  onClick={onClone}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 border border-border rounded-xl text-sm font-medium text-secondary bg-white hover:bg-gray-50 transition-colors"
                >
                  <Copy className="w-4 h-4" />
                  Clone to New View
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 border border-red-200 rounded-xl text-sm font-medium text-red-600 bg-white hover:bg-red-50 transition-colors"
                >
                  <Trash className="w-4 h-4" />
                  Delete View
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
