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
      include: { user: { select: { id: true, role: true, email: true, status: true } } },
    });

    if (!apiKey) {
      res.status(401).json({ success: false, error: 'Invalid API key', code: 401 });
      return;
    }

    if (!apiKey.user || apiKey.user.status === 'INACTIVE') {
      res.status(401).json({ success: false, error: 'API key owner is inactive', code: 401 });
      return;
    }

    // Update last used timestamp in the background
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(console.error);

    // Mock req.user so that existing scoped logic works flawlessly.
    // Authorization uses the KEY OWNER's real role — never a blanket ADMIN.
    (req as any).user = {
      userId: apiKey.userId,
      organizationId: apiKey.organizationId,
      role: apiKey.user.role,
      email: apiKey.user.email,
    } as any;

    next();
  } catch (error) {
    console.error('[API Key Auth Error]:', error);
    res.status(500).json({ success: false, error: 'Internal server error during authentication', code: 500 });
  }
};
