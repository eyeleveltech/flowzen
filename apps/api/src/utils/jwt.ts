import jwt from 'jsonwebtoken';
import { requireSecret } from '../lib/env.js';

// Importing env.js is also what guarantees dotenv has run: this module reads its
// secret at module scope, and ES imports evaluate in declaration order.
const JWT_SECRET = requireSecret('JWT_SECRET');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface JwtPayload {
  userId: string;
  email: string;
  preset: string;
  organizationId: string;
  role?: string;
  permissions?: string[];
  /** Registered claims jwt.verify returns. `iat` is what retires a session
   *  after a password change — see middleware/auth.ts. */
  iat?: number;
  exp?: number;
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as any,
    algorithm: 'HS256',
  });
}

export function verifyToken(token: string): JwtPayload {
  // Pinned, not inferred. Letting the token nominate its own algorithm is the
  // shape of every JWT confusion attack; this library defends against the worst
  // of them by default, and naming the one algorithm we sign with costs nothing.
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
}

export const verifyJwt = verifyToken;
export const signJwt = generateToken;
