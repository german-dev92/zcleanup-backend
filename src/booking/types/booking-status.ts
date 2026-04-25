export const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
  'paid',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];
