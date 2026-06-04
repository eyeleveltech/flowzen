import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  organizationId?: string;
}

export function setupSocketIO(io: Server) {
  // Authentication middleware
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
        userId: string;
        organizationId: string;
      };
      socket.userId = decoded.userId;
      socket.organizationId = decoded.organizationId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`  ⚡ User connected: ${socket.userId}`);

    // Join user-specific room
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

    // Join organization room
    if (socket.organizationId) {
      socket.join(`org:${socket.organizationId}`);
    }

    socket.on('disconnect', () => {
      console.log(`  ⚡ User disconnected: ${socket.userId}`);
    });
  });
}

// Helper to emit events
export function emitToUser(io: Server, userId: string, event: string, data: unknown) {
  io.to(`user:${userId}`).emit(event, data);
}

export function emitToOrganization(io: Server, orgId: string, event: string, data: unknown) {
  io.to(`org:${orgId}`).emit(event, data);
}
