import { Router } from 'express';
import { bookingsController } from '../controllers/bookings.js';

export const bookingsRouter = Router();

bookingsRouter.get('/', bookingsController.getBookings);
bookingsRouter.get('/search', bookingsController.searchBookings);

bookingsRouter.get('/:id', bookingsController.getBookingById);
bookingsRouter.post('/', bookingsController.createBooking);
bookingsRouter.patch('/:id', bookingsController.updateBooking);
bookingsRouter.delete('/:id', bookingsController.deleteBooking);
