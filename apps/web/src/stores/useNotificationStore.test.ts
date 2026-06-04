import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotificationStore } from './useNotificationStore';

// Mock the API client
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

// Mock Socket.io
vi.mock('@/lib/socket', () => ({
  getSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
  })),
}));

describe('useNotificationStore', () => {
  beforeEach(() => {
    // Reset Zustand state before each test
    useNotificationStore.setState({
      notifications: [],
      unreadCount: 0,
      isLoading: false,
    });
    vi.clearAllMocks();
  });

  it('should initialize with empty state', () => {
    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([]);
    expect(state.unreadCount).toBe(0);
  });

  it('should add a real-time notification and increment unread count', () => {
    const mockNotification = {
      id: '1',
      type: 'TASK_ASSIGNED',
      message: 'New Task',
      read: false,
      createdAt: new Date().toISOString(),
    };

    useNotificationStore.getState().addRealTimeNotification(mockNotification);

    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toEqual(mockNotification);
    expect(state.unreadCount).toBe(1);
  });

  it('should optimally mark a notification as read and decrement count', () => {
    const mockNotification = {
      id: '1',
      type: 'TASK_ASSIGNED',
      message: 'New Task',
      read: false,
      createdAt: new Date().toISOString(),
    };

    useNotificationStore.setState({
      notifications: [mockNotification],
      unreadCount: 1,
    });

    useNotificationStore.getState().markAsRead('1');

    const state = useNotificationStore.getState();
    expect(state.notifications[0].read).toBe(true);
    expect(state.unreadCount).toBe(0);
  });

  it('should not decrement unreadCount below 0', () => {
    useNotificationStore.setState({
      notifications: [
        { id: '1', read: false } as any
      ],
      unreadCount: 0, // Force invalid state to test bounds
    });

    useNotificationStore.getState().markAsRead('1');
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });
});
