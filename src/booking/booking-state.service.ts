import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { BookingStatus } from './types/booking-status';

export type BookingTransitionSource = 'admin' | 'webhook';

@Injectable()
export class BookingStateService {
  canTransition(from: BookingStatus, to: BookingStatus): boolean {
    if (from === to) return true;

    if (to === 'cancelled') {
      return from === 'pending' || from === 'confirmed' || from === 'paid';
    }

    if (from === 'pending' && to === 'confirmed') return true;
    if (from === 'confirmed' && to === 'paid') return true;

    return false;
  }

  transitionBooking(params: {
    current: BookingStatus;
    next: BookingStatus;
    source: BookingTransitionSource;
  }): BookingStatus {
    const { current, next, source } = params;

    if (current === next) {
      return current;
    }

    if (!this.canTransition(current, next)) {
      throw new BadRequestException('Invalid booking status transition');
    }

    if (current === 'pending' && next === 'confirmed') {
      if (source !== 'admin') {
        throw new ForbiddenException('Only admin can confirm bookings');
      }
    }

    if (current === 'confirmed' && next === 'paid') {
      if (source !== 'webhook') {
        throw new ForbiddenException('Only webhook can mark bookings as paid');
      }
    }

    if (next === 'cancelled') {
      if (source !== 'admin') {
        throw new ForbiddenException('Only admin can cancel bookings');
      }
    }

    return next;
  }
}
