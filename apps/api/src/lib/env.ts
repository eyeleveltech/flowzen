import dotenv from 'dotenv';
import path from 'path';

// Must be imported before any module that reads process.env at module scope (utils/jwt.ts,
// services/email.ts, lib/redis.ts). ES imports are hoisted and evaluated in declaration order,
// so calling dotenv.config() in index.ts's body runs too late — those modules have already
// captured undefined and fallen back to their dev defaults.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
