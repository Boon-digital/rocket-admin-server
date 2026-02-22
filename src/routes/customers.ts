import { Router } from 'express';
import { customersController } from '../controllers/customers.js';

export const customersRouter = Router();

customersRouter.get('/', customersController.getCustomers);
customersRouter.get('/search', customersController.searchCustomers);
customersRouter.get('/:id', customersController.getCustomerById);
customersRouter.post('/', customersController.createCustomer);
customersRouter.patch('/:id', customersController.updateCustomer);
customersRouter.delete('/:id', customersController.deleteCustomer);
