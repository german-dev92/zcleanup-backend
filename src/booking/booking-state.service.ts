import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { BookingStatus } from './types/booking-status';

export type BookingTransitionSource = 'admin' | 'employee' | 'webhook';

/**
 * @class BookingStateService
 * @description Servicio encargado de gestionar las transiciones de estado de las reservas.
 * Implementa una máquina de estados para asegurar que las reservas sigan un flujo lógico y permitido.
 */
@Injectable()
export class BookingStateService {
  /**
   * Determina si una transición de estado es válida.
   * @param from Estado actual de la reserva.
   * @param to Estado destino deseado.
   * @returns Verdadero si la transición es permitida, falso de lo contrario.
   */
  canTransition(from: BookingStatus, to: BookingStatus): boolean {
    if (from === to) return true;

    if (to === 'cancelled') {
      return (
        from === 'pending' ||
        from === 'confirmed' ||
        from === 'assigned' ||
        from === 'in_progress' ||
        from === 'paid'
      );
    }

    if (from === 'pending' && to === 'confirmed') return true;
    if (from === 'confirmed' && to === 'assigned') return true;
    if (from === 'assigned' && to === 'in_progress') return true;
    if (from === 'in_progress' && to === 'completed') return true;

    if (to === 'paid') {
      return (
        from === 'confirmed' ||
        from === 'assigned' ||
        from === 'in_progress' ||
        from === 'completed'
      );
    }

    return false;
  }

  /**
   * Ejecuta la transición de estado de una reserva, validando permisos según el origen.
   * @param params Parámetros de la transición: estado actual, siguiente y origen del cambio.
   * @returns El nuevo estado de la reserva si la transición es exitosa.
   * @throws BadRequestException si la transición no es válida lógicamente.
   * @throws ForbiddenException si el origen no tiene permisos para realizar la transición.
   */
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

    if (next === 'paid') {
      if (source !== 'webhook') {
        throw new ForbiddenException('Only webhook can mark bookings as paid');
      }
    }

    if (next === 'assigned') {
      if (source !== 'admin') {
        throw new ForbiddenException(
          'Only admin can update operational status',
        );
      }
    }

    if (next === 'in_progress' || next === 'completed') {
      if (source !== 'admin' && source !== 'employee') {
        throw new ForbiddenException(
          'Only admin/employee can update operational status',
        );
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
