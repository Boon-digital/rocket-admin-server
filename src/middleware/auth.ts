import type { Request, Response, NextFunction } from 'express';

// Extend Express session to include our user
declare module 'express-session' {
  interface SessionData {
    userId: string;
    userEmail: string;
    userName: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!process.env.AUTH_ENABLED || process.env.AUTH_ENABLED !== 'true') {
    return next();
  }

  if (req.session?.userId) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
}

export function isAllowedDomain(email: string): boolean {
  const allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS;
  if (!allowedDomains) return true; // No restriction configured

  const domains = allowedDomains.split(',').map((d) => d.trim().toLowerCase());
  const emailDomain = email.split('@')[1]?.toLowerCase();
  return domains.includes(emailDomain);
}
