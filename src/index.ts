import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import session from 'express-session';
import passport from 'passport';
import ConnectMongoDBSession from 'connect-mongodb-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { router } from './routes/index.js';
import { authRouter, configurePassport } from './routes/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireAuth } from './middleware/auth.js';
import { connectMongo, getMongoClient } from './services/mongoService.js';
import { initUserService } from './services/userService.js';
import { initEntityHooks } from './config/entityHooks.js';
import { initStayStatusCron } from './jobs/stayStatusCron.js';

// Load environment variables (.env.local takes precedence over .env)
dotenv.config({ path: '../.env.local' });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_PREFIX = process.env.API_PREFIX || '/api/v1';
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Local dev: serve uploaded files from disk
const uploadsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
app.use('/uploads', express.static(uploadsDir));

// Health check (public)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─── Auth setup (only when AUTH_ENABLED=true) ────────────────────────────────
async function setupAuth(): Promise<void> {
  if (!AUTH_ENABLED) return;

  const mongoClient = getMongoClient();
  const dbName = process.env.MONGOCOLLECTION!;

  // Initialize user service with the existing MongoDB connection
  initUserService(mongoClient, dbName);

  // MongoDB-backed session store
  const MongoDBStore = ConnectMongoDBSession(session);
  const store = new MongoDBStore({
    uri: process.env.MONGOCONNECTIONSTRING!,
    databaseName: dbName,
    collection: 'sessions',
  });

  store.on('error', (err) => console.error('Session store error:', err));

  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'change-me-in-production',
      resave: false,
      saveUninitialized: false,
      store,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  configurePassport();

  // Auth routes mounted outside the API prefix (public — handles OAuth redirects)
  app.use('/auth', authRouter);

  console.log('🔐 Auth enabled (Google + Microsoft OAuth)');
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
connectMongo()
  .then(async () => {
    await setupAuth();
    initEntityHooks();
    initStayStatusCron();

    // API routes (protected when AUTH_ENABLED)
    app.use(API_PREFIX, requireAuth, router);

    // Error handling (must be last)
    app.use(errorHandler);

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📝 API available at http://localhost:${PORT}${API_PREFIX}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
