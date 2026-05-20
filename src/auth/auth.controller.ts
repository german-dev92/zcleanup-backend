import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

/**
 * @controller AuthController
 * @description Controlador para el manejo de la autenticación de usuarios.
 * Proporciona endpoints para el inicio de sesión y obtención de tokens JWT.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Endpoint para el inicio de sesión de usuarios.
   * Valida las credenciales y devuelve un token de acceso JWT si son correctas.
   * @param body Datos de inicio de sesión (email y password).
   * @returns Objeto con el token de acceso y la información básica del usuario.
   */
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }
}
