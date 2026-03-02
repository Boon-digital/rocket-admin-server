import { Router, type Request, type Response } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import type { VerifyCallback } from 'passport-oauth2';
import { upsertUser, findUserById } from '../services/userService.js';
import { isAllowedDomain } from '../middleware/auth.js';

export const authRouter = Router();

// ─── Passport configuration ────────────────────────────────────────────────

passport.serializeUser((user: any, done) => {
  done(null, user._id?.toString() ?? user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await findUserById(id);
    done(null, user ?? false);
  } catch (err) {
    done(err, false);
  }
});

export function configurePassport(): void {
  const baseUrl = process.env.AUTH_CALLBACK_BASE_URL || 'http://localhost:3001';

  // Google OAuth
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${baseUrl}/auth/google/callback`,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value ?? '';
            if (!isAllowedDomain(email)) {
              return done(null, false);
            }
            const user = await upsertUser(
              'google',
              profile.id,
              email,
              profile.displayName
            );
            done(null, user);
          } catch (err) {
            done(err as Error, undefined);
          }
        }
      )
    );
  }

  // Microsoft OAuth
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    passport.use(
      new MicrosoftStrategy(
        {
          clientID: process.env.MICROSOFT_CLIENT_ID,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
          callbackURL: `${baseUrl}/auth/microsoft/callback`,
          tenant: process.env.MICROSOFT_TENANT_ID || 'common',
          scope: ['user.read'],
        },
        async (_accessToken: string, _refreshToken: string, profile: any, done: VerifyCallback) => {
          try {
            const email =
              profile.emails?.[0]?.value ?? profile._json?.mail ?? profile._json?.userPrincipalName ?? '';
            console.log('[Microsoft OAuth] profile id:', profile.id, '| email:', email, '| _json.mail:', profile._json?.mail, '| _json.userPrincipalName:', profile._json?.userPrincipalName);
            if (!isAllowedDomain(email)) {
              console.log('[Microsoft OAuth] Domain not allowed for email:', email, '| Allowed:', process.env.ALLOWED_EMAIL_DOMAINS);
              return done(null, false);
            }
            const user = await upsertUser(
              'microsoft',
              profile.id,
              email,
              profile.displayName
            );
            done(null, user);
          } catch (err) {
            done(err as Error, undefined);
          }
        }
      )
    );
  }
}

// ─── Auth routes ────────────────────────────────────────────────────────────

const successRedirect = () =>
  process.env.AUTH_SUCCESS_REDIRECT || 'http://localhost:5173';

const failureRedirect = () =>
  process.env.AUTH_FAILURE_REDIRECT || 'http://localhost:5173/login';

// Google
authRouter.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

authRouter.get('/google/callback', (req: Request, res: Response, next) => {
  passport.authenticate('google', { failureRedirect: failureRedirect() })(req, res, next);
}, (req: Request, res: Response) => {
  const user = req.user as any;
  req.session.userId = user._id?.toString();
  req.session.userEmail = user.email;
  req.session.userName = user.name;
  req.session.save(() => res.redirect(successRedirect()));
});

// Microsoft
authRouter.get(
  '/microsoft',
  passport.authenticate('microsoft', { prompt: 'select_account' } as any)
);

authRouter.get('/microsoft/callback', (req: Request, res: Response, next) => {
  passport.authenticate('microsoft', { failureRedirect: failureRedirect() })(req, res, next);
}, (req: Request, res: Response) => {
  const user = req.user as any;
  req.session.userId = user._id?.toString();
  req.session.userEmail = user.email;
  req.session.userName = user.name;
  req.session.save(() => res.redirect(successRedirect()));
});

// Current user
authRouter.get('/me', (req: Request, res: Response) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({
    id: req.session.userId,
    email: req.session.userEmail,
    name: req.session.userName,
  });
});

// Logout — supports both GET (browser navigation) and POST (programmatic)
function destroySession(req: Request, res: Response, redirect: boolean) {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: 'Failed to logout' });
      return;
    }
    res.clearCookie('connect.sid');
    if (redirect) {
      res.redirect(failureRedirect());
    } else {
      res.json({ success: true });
    }
  });
}

authRouter.get('/logout', (req: Request, res: Response) => destroySession(req, res, true));
authRouter.post('/logout', (req: Request, res: Response) => destroySession(req, res, false));
