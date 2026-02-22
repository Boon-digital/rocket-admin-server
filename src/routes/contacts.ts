import { Router } from 'express';
import { contactsController } from '../controllers/contacts.js';

export const contactsRouter = Router();

contactsRouter.get('/', contactsController.getContacts);
contactsRouter.get('/search', contactsController.searchContacts);
contactsRouter.get('/:id', contactsController.getContactById);
contactsRouter.post('/', contactsController.createContact);
contactsRouter.patch('/:id', contactsController.updateContact);
contactsRouter.delete('/:id', contactsController.deleteContact);
