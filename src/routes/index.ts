import { Router } from 'express';
import { getRegistry } from '../lib/registry.js';
import { makeEntityController } from '../controllers/entityController.js';
import { credentialsRouter } from './credentials.js';
import { uploadRouter } from './upload.js';
import { emailRouter } from './email.js';
import { emailLogRouter } from './emailLog.js';

export const router = Router();

// Mount entity routers dynamically from registry
for (const [key, entry] of Object.entries(getRegistry())) {
  if (!entry.enabled || (entry as any).isCustomRoute) continue;

  const controller = makeEntityController(key);
  const entityRouter = Router();

  entityRouter.get('/', controller.getAll);
  entityRouter.get('/search', controller.search);
  entityRouter.get('/by-ids', controller.getByIds);
  entityRouter.get('/by-field/:field/:value', controller.getByField);
  entityRouter.get('/:id', controller.getById);
  entityRouter.post('/', controller.create);
  entityRouter.patch('/:id', controller.update);
  entityRouter.delete('/:id', controller.delete);

  router.use(entry.route, entityRouter);
}

// Credentials (encrypt/decrypt)
router.use('/credentials', credentialsRouter);

// File uploads (Vercel Blob proxy)
router.use('/upload', uploadRouter);

// Email send + log
router.use('/email', emailRouter);
router.use('/email', emailLogRouter);

// API info endpoint
router.get('/', (_req, res) => {
  const registry = getRegistry();
  const endpoints = Object.fromEntries(
    Object.entries(registry)
      .filter(([, entry]) => entry.enabled)
      .map(([key, entry]) => [key, entry.route])
  );
  res.json({
    name: 'Admin Template API',
    version: '2.0.0',
    endpoints,
  });
});
