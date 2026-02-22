import { Router } from 'express';
import { hotelsController } from '../controllers/hotels.js';

export const hotelsRouter = Router();

hotelsRouter.get('/', hotelsController.getHotels);
hotelsRouter.get('/search', hotelsController.searchHotels);
hotelsRouter.get('/:id', hotelsController.getHotelById);
hotelsRouter.post('/', hotelsController.createHotel);
hotelsRouter.patch('/:id', hotelsController.updateHotel);
hotelsRouter.delete('/:id', hotelsController.deleteHotel);
