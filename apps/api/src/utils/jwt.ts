import jwt from 'jsonwebtoken';

const PLACEHOLDERS = [
  'generate_a_very_long_secure_random_string',
  'flowzen-dev-jwt-secret',
];

const JWT_SECRET = process.env.JWT_SECRET || (
  process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('JWT_SECRET must be set in production'); })()
    : 'flowzen-dev-jwt-secret'
);

if (PLACEHOLDERS.includes(JWT_SECRET)) {
  throw new Error(
    `JWT_SECRET is set to a well-known placeholder ("${JWT_SECRET}"). ` +
    'Generate a real secret (openssl rand -base64 32) and update .env'
  );
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  organizationId: string;
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as any });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
