import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useNotificationStore } from './useNotificationStore';

describe('useNotificationStore', () => {
  beforeEach(() => {
    // Reset Zustand state before each test
    useNotificationStore.setState({
      activeToast: null,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with empty toast state', () => {
    const state = useNotificationStore.getState();
    expect(state.activeToast).toBeNull();
  });

  it('should show a toast notification', () => {
    const mockNotification = {
      id: '1',
      type: 'TASK_ASSIGNED',
      message: 'New Task',
      read: false,
      createdAt: new Date().toISOString(),
    };

    useNotificationStore.getState().showToast(mockNotification);

    const state = useNotificationStore.getState();
    expect(state.activeToast).toEqual(mockNotification);
  });

  it('should clear the toast notification manually', () => {
    const mockNotification = {
      id: '1',
      type: 'TASK_ASSIGNED',
      message: 'New Task',
      read: false,
      createdAt: new Date().toISOString(),
    };

    useNotificationStore.setState({ activeToast: mockNotification });
    useNotificationStore.getState().clearToast();

    const state = useNotificationStore.getState();
    expect(state.activeToast).toBeNull();
  });

  it('should auto-clear the toast notification after 5 seconds', () => {
    const mockNotification = {
      id: '1',
      type: 'TASK_ASSIGNED',
      message: 'New Task',
      read: false,
      createdAt: new Date().toISOString(),
    };

    useNotificationStore.getState().showToast(mockNotification);
    
    // Advance time by 5 seconds
    vi.advanceTimersByTime(5000);

    const state = useNotificationStore.getState();
    expect(state.activeToast).toBeNull();
  });
});
