import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsDefined, IsEnum } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../auth/roles.enum';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

class UpdateEmployeeRoleDto {
  @IsDefined({ message: 'role is required' })
  @IsEnum(UserRole, { message: 'role must be a valid role' })
  role: UserRole;
}

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  create(@Body() body: CreateEmployeeDto) {
    return this.employeesService.createEmployee(body);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  getAll() {
    return this.employeesService.getAllEmployees();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateEmployeeDto) {
    return this.employeesService.updateEmployee(id, body);
  }

  @Patch(':id/role')
  updateRole(@Param('id') id: string, @Body() body: UpdateEmployeeRoleDto) {
    return this.employeesService.setEmployeeRole(id, body.role);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.employeesService.deleteEmployee(id);
  }
}
