import { Request, Response, NextFunction } from 'express';
import { MongoService } from '../services/mongoService.js';
import { decrypt, isEncrypted } from '../lib/crypto.js';
import { AppError } from '../middleware/errorHandler.js';
import { getRegistry } from '../lib/registry.js';

/**
 * POST /credentials/decrypt
 *
 * Body: { entity: string, id: string, field: string }
 *
 * Looks up the document, verifies the field is encrypted,
 * decrypts it server-side and returns only the plaintext.
 * The raw ciphertext is never sent to the client.
 */
export async function decryptCredential(req: Request, res: Response, next: NextFunction) {
  try {
    const { entity, id, field } = req.body as { entity?: string; id?: string; field?: string };

    if (!entity || !id || !field) {
      throw new AppError(400, 'entity, id and field are required');
    }

    if (!(entity in getRegistry())) {
      throw new AppError(400, `Unknown entity: ${entity}`);
    }

    const service = new MongoService(entity);
    const document = await service.getRawById(id) as Record<string, any> | null;

    if (!document) {
      throw new AppError(404, `Document not found`);
    }

    // Resolve dot-notation path (e.g. "registrar_login.password")
    const storedValue = field.split('.').reduce((obj: any, key: string) => obj?.[key], document);

    if (!isEncrypted(storedValue)) {
      throw new AppError(400, `Field "${field}" is not an encrypted credential`);
    }

    const plaintext = decrypt(storedValue);

    // Audit log — replace with a proper audit service when available
    console.log(`[credentials] decrypt — entity=${entity} id=${id} field=${field} at=${new Date().toISOString()}`);

    res.json({ success: true, data: { plaintext } });
  } catch (error) {
    next(error);
  }
}
