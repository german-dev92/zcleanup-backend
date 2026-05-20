import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BookingStateService, BookingTransitionSource } from './booking-state.service';
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
      expect(() => service.transitionBooking(params)).toThrow(ForbiddenException);
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

      expect(() => service.transitionBooking(params)).toThrow(BadRequestException);
    });
  });
});
