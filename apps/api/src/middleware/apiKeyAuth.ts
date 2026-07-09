import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const apiKeyAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    let token = '';

    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.substring(7).trim(); // Extract token, case-insensitive 'Bearer '
    } else if (req.query.apiKey) {
      token = req.query.apiKey as string;
    }

    if (!token) {
      res.status(401).json({ success: false, error: 'Missing or invalid API key', code: 401 });
      return;
    }

    const apiKey = await prisma.apiKey.findUnique({
      where: { key: token },
    });

    if (!apiKey) {
      res.status(401).json({ success: false, error: 'Invalid API key', code: 401 });
      return;
    }

    // Update last used timestamp in the background
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(console.error);

    // Mock req.user so that existing scoped logic works flawlessly
    (req as any).user = {
      userId: apiKey.userId,
      organizationId: apiKey.organizationId,
      role: 'ADMIN', // Elevated role to allow API actions, scoped by organization
      email: 'api@flowzen.in',
    } as any;

    next();
  } catch (error) {
    console.error('[API Key Auth Error]:', error);
    res.status(500).json({ success: false, error: 'Internal server error during authentication', code: 500 });
  }
};
