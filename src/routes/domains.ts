import { Router } from 'express';
import { domainsController } from '../controllers/domains.js';

export const domainsRouter = Router();

domainsRouter.get('/', domainsController.getDomains);
domainsRouter.get('/search', domainsController.searchDomains);
domainsRouter.get('/by-server/:serverId', domainsController.getDomainsByServerId);
domainsRouter.get('/:id', domainsController.getDomainById);
domainsRouter.post('/', domainsController.createDomain);
domainsRouter.patch('/:id', domainsController.updateDomain);
domainsRouter.delete('/:id', domainsController.deleteDomain);
