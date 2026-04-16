import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailService } from '../email/email.service';
import { Booking } from './schemas/booking.schema';
import { CreateBookingDto } from './dto/create-booking.dto';

@Injectable()
export class BookingService {
  constructor(
    @InjectModel(Booking.name)
    private bookingModel: Model<Booking>,
    private emailService: EmailService,
  ) {}

  async createBooking(data: CreateBookingDto) {
    // 1. Crear documento en memoria
    const newBooking = new this.bookingModel(data);

    // 2. Guardar en MongoDB
    await newBooking.save();

    // 3. Enviar email (solo si ya se guardó correctamente)
    try {
      await this.emailService.sendBookingEmail(newBooking);
    } catch (error) {
      console.error('Error sending email:', error);
      // IMPORTANTE: no rompemos el flujo si falla el email
    }

    // 4. Respuesta al frontend
    return {
      success: true,
      message: 'Booking saved successfully',
      data: newBooking,
    };
  }
}