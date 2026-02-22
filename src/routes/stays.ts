import { Router } from 'express';
import { staysController } from '../controllers/stays.js';

export const staysRouter = Router();

staysRouter.get('/', staysController.getStays);
staysRouter.get('/search', staysController.searchStays);
staysRouter.get('/:id', staysController.getStayById);
staysRouter.post('/', staysController.createStay);
staysRouter.patch('/:id', staysController.updateStay);
staysRouter.delete('/:id', staysController.deleteStay);
