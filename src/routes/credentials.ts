import { Router } from 'express';
import { decryptCredential } from '../controllers/credentials.js';

export const credentialsRouter = Router();

credentialsRouter.post('/decrypt', decryptCredential);
