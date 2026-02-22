/**
 * Server Routes Index Example
 *
 * SETUP INSTRUCTIONS:
 * 1. Copy this file to `index.ts` in the same folder
 * 2. Import your entity routers
 * 3. Mount them on the appropriate paths
 *
 * Each entity needs:
 * - A router file (e.g., `customers.ts`)
 * - A controller (e.g., `controllers/customers.ts`)
 */

import { Router } from 'express';
// Import your entity routers here:
// import { customersRouter } from './customers.js';
// import { productsRouter } from './products.js';

export const router = Router();

// Mount entity routers
// router.use('/customers', customersRouter);
// router.use('/products', productsRouter);

// API info endpoint
router.get('/', (_req, res) => {
  res.json({
    name: 'Admin Template API',
    version: '1.0.0',
    endpoints: {
      // List your endpoints here:
      // customers: '/customers',
      // products: '/products',
    },
  });
});
