import { Router } from 'express';
import { entityRegistry, type EntityKey } from '@ruben/admin-template-config/registry.js';
import { makeEntityController } from '../controllers/entityController.js';

export const router = Router();

// Mount entity routers dynamically from registry
for (const [key, entry] of Object.entries(entityRegistry) as [EntityKey, typeof entityRegistry[EntityKey]][]) {
  if (!entry.enabled) continue;

  const controller = makeEntityController(key);
  const entityRouter = Router();

  entityRouter.get('/', controller.getAll);
  entityRouter.get('/search', controller.search);
  entityRouter.get('/by-ids', controller.getByIds);
  entityRouter.get('/:id', controller.getById);
  entityRouter.post('/', controller.create);
  entityRouter.patch('/:id', controller.update);
  entityRouter.delete('/:id', controller.delete);

  router.use(entry.route, entityRouter);
}

// API info endpoint
router.get('/', (_req, res) => {
  const endpoints = Object.fromEntries(
    Object.entries(entityRegistry)
      .filter(([, entry]) => entry.enabled)
      .map(([key, entry]) => [key, entry.route])
  );
  res.json({
    name: 'Admin Template API',
    version: '2.0.0',
    endpoints,
  });
});
