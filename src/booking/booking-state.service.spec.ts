import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  BookingStateService,
  BookingTransitionSource,
} from './booking-state.service';
import { BookingStatus } from './types/booking-status';

/**
 * @file booking-state.service.spec.ts
 * @description Test unitario para BookingStateService.
 *
 * CONCEPTOS CLAVE PARA APRENDER:
 * - describe: Agrupa tests relacionados (una suite).
 * - it: Un test individual. Debe leerse como una frase: "it should allow transition..."
 * - expect: La validación. Compara el resultado real con el esperado.
 * - Unit Test: No tocamos base de datos ni archivos externos. Es 100% lógica pura.
 */

describe('BookingStateService (Unit Test)', () => {
  let service: BookingStateService;

  // beforeEach: Se ejecuta ANTES de cada 'it'.
  // Nos asegura que cada test empiece con una instancia limpia del servicio.
  beforeEach(() => {
    service = new BookingStateService();
  });

  describe('canTransition', () => {
    it('should allow transition from pending to confirmed', () => {
      // Act (Actuar): Llamamos a la función que queremos probar
      const result = service.canTransition('pending', 'confirmed');

      // Assert (Aseverar): Verificamos que el resultado sea true
      expect(result).toBe(true);
    });

    it('should not allow transition from pending to completed (invalid flow)', () => {
      const result = service.canTransition('pending', 'completed');
      expect(result).toBe(false);
    });

    it('should allow transition to cancelled from almost any state', () => {
      expect(service.canTransition('pending', 'cancelled')).toBe(true);
      expect(service.canTransition('confirmed', 'cancelled')).toBe(true);
      expect(service.canTransition('in_progress', 'cancelled')).toBe(true);
    });
  });

  describe('transitionBooking', () => {
    it('should throw ForbiddenException if employee tries to confirm a booking', () => {
      const params = {
        current: 'pending' as BookingStatus,
        next: 'confirmed' as BookingStatus,
        source: 'employee' as BookingTransitionSource,
      };

      // Para validar errores, envolvemos la llamada en una función anónima
      expect(() => service.transitionBooking(params)).toThrow(
        ForbiddenException,
      );
    });

    it('should allow admin to confirm a booking', () => {
      const params = {
        current: 'pending' as BookingStatus,
        next: 'confirmed' as BookingStatus,
        source: 'admin' as BookingTransitionSource,
      };

      const result = service.transitionBooking(params);
      expect(result).toBe('confirmed');
    });

    it('should throw BadRequestException for invalid logical transitions', () => {
      const params = {
        current: 'pending' as BookingStatus,
        next: 'completed' as BookingStatus,
        source: 'admin' as BookingTransitionSource,
      };

      expect(() => service.transitionBooking(params)).toThrow(
        BadRequestException,
      );
    });

    it('should allow webhook to mark a booking as paid (financial source of truth)', () => {
      /**
       * @description En producción, SOLO el webhook debe marcar un booking como paid.
       * Esto evita fraude: ni admin ni empleados deberían poder forzar paid manualmente.
       */
      const result = service.transitionBooking({
        current: 'confirmed',
        next: 'paid',
        source: 'webhook',
      });
      expect(result).toBe('paid');
    });

    it('should reject admin trying to mark booking as paid (ForbiddenException)', () => {
      expect(() =>
        service.transitionBooking({
          current: 'confirmed',
          next: 'paid',
          source: 'admin',
        }),
      ).toThrow(ForbiddenException);
    });

    it('should allow admin to move confirmed -> assigned', () => {
      const result = service.transitionBooking({
        current: 'confirmed',
        next: 'assigned',
        source: 'admin',
      });
      expect(result).toBe('assigned');
    });

    it('should allow employee to move assigned -> in_progress and in_progress -> completed', () => {
      const inProgress = service.transitionBooking({
        current: 'assigned',
        next: 'in_progress',
        source: 'employee',
      });
      expect(inProgress).toBe('in_progress');

      const completed = service.transitionBooking({
        current: 'in_progress',
        next: 'completed',
        source: 'employee',
      });
      expect(completed).toBe('completed');
    });

    it('should reject invalid transitions like paid -> pending, cancelled -> completed, completed -> confirmed', () => {
      expect(() =>
        service.transitionBooking({
          current: 'paid',
          next: 'pending',
          source: 'admin',
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        service.transitionBooking({
          current: 'cancelled',
          next: 'completed',
          source: 'admin',
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        service.transitionBooking({
          current: 'completed',
          next: 'confirmed',
          source: 'admin',
        }),
      ).toThrow(BadRequestException);
    });
  });
});
