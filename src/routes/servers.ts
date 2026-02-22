import { Router } from 'express';
import { serversController } from '../controllers/servers.js';

export const serversRouter = Router();

serversRouter.get('/', serversController.getServers);
serversRouter.get('/search', serversController.searchServers);
serversRouter.get('/:id', serversController.getServerById);
serversRouter.post('/', serversController.createServer);
serversRouter.patch('/:id', serversController.updateServer);
serversRouter.delete('/:id', serversController.deleteServer);
