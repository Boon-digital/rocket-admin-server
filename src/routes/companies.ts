import { Router } from 'express';
import { companiesController } from '../controllers/companies.js';

export const companiesRouter = Router();

companiesRouter.get('/', companiesController.getCompanies);
companiesRouter.get('/search', companiesController.searchCompanies);
companiesRouter.get('/:id', companiesController.getCompanyById);
companiesRouter.post('/', companiesController.createCompany);
companiesRouter.patch('/:id', companiesController.updateCompany);
companiesRouter.delete('/:id', companiesController.deleteCompany);
