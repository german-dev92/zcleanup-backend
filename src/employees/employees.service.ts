import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, type UserDocument } from '../users/schemas/user.schema';
import { Employee, type EmployeeDocument } from './schemas/employee.schema';
import { UserRole } from '../auth/roles.enum';
import {
  Booking,
  type BookingDocument,
} from '../booking/schemas/booking.schema';

@Injectable()
export class EmployeesService {
  toEmployeeDto(input: {
    employeeId: string;
    name: string;
    email: string;
    phone: string;
    role: UserRole;
    isActive: boolean;
  }) {
    return {
      id: input.employeeId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      isActive: input.isActive,
    };
  }

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
  ) {}

  async createEmployee(input: {
    email: string;
    password: string;
    name: string;
    phone?: string;
    role?: UserRole;
  }): Promise<{
    id: string;
    name: string;
    email: string;
    phone: string;
    role: UserRole;
    isActive: boolean;
  }> {
    const email = (input.email ?? '').toLowerCase().trim();
    const password = String(input.password ?? '');
    const name = String(input.name ?? '').trim();
    const phoneRaw = typeof input.phone === 'string' ? input.phone.trim() : '';

    if (!name) {
      throw new BadRequestException('Name is required');
    }
    if (!email) {
      throw new BadRequestException('Valid email required');
    }
    if (!password) {
      throw new BadRequestException('Password is required');
    }

    const role =
      input.role === UserRole.ADMIN ||
      input.role === UserRole.SUPERVISOR ||
      input.role === UserRole.EMPLOYEE
        ? input.role
        : UserRole.EMPLOYEE;

    const existing = await this.userModel.findOne({ email }).select({ _id: 1 });
    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const saltRoundsRaw =
      typeof process.env.BCRYPT_SALT_ROUNDS === 'string'
        ? Number(process.env.BCRYPT_SALT_ROUNDS)
        : 12;
    const saltRounds = Number.isFinite(saltRoundsRaw) ? saltRoundsRaw : 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const session = await this.userModel.startSession();
    try {
      let employeeId: Types.ObjectId | null = null;

      try {
        await session.withTransaction(async () => {
          const [createdUser] = await this.userModel.create(
            [
              {
                email,
                passwordHash,
                role,
                active: true,
              },
            ],
            { session },
          );

          const [createdEmployee] = await this.employeeModel.create(
            [
              {
                userId: createdUser._id,
                name,
                phone: phoneRaw || undefined,
                isActive: true,
              },
            ],
            { session },
          );

          employeeId = createdEmployee._id;
        });
      } catch (error) {
        if (!this.isTransactionNotSupportedError(error)) {
          throw error;
        }

        const createdUser = await this.userModel.create({
          email,
          passwordHash,
          role,
          active: true,
        });

        try {
          const createdEmployee = await this.employeeModel.create({
            userId: createdUser._id,
            name,
            phone: phoneRaw || undefined,
            isActive: true,
          });
          employeeId = createdEmployee._id;
        } catch (createEmployeeError) {
          await this.userModel.deleteOne({ _id: createdUser._id });
          throw createEmployeeError;
        }
      }

      if (!employeeId) {
        throw new BadRequestException('Employee creation failed');
      }

      const employee = await this.employeeModel
        .findById(employeeId)
        .populate('userId', 'email role active');
      if (!employee) {
        throw new BadRequestException('Employee creation failed');
      }

      const meta = this.extractEmployeeMeta(employee);
      return this.toEmployeeDto(meta);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('Email already exists');
      }
      if (error instanceof BadRequestException) throw error;
      if (error instanceof ConflictException) throw error;
      throw new InternalServerErrorException('Failed to create employee');
    } finally {
      await session.endSession();
    }
  }

  async getAllEmployees(): Promise<
    {
      id: string;
      name: string;
      email: string;
      phone: string;
      role: UserRole;
      isActive: boolean;
    }[]
  > {
    const employees = await this.employeeModel
      .find()
      .sort({ createdAt: -1 })
      .populate('userId', 'email role active');

    return employees.map((e) =>
      this.toEmployeeDto(this.extractEmployeeMeta(e)),
    );
  }

  async setEmployeeActive(
    employeeId: string,
    isActive: boolean,
  ): Promise<{
    id: string;
    name: string;
    email: string;
    phone: string;
    role: UserRole;
    isActive: boolean;
  }> {
    if (!Types.ObjectId.isValid(employeeId)) {
      throw new BadRequestException('Invalid employee id');
    }

    const employee = await this.employeeModel.findById(employeeId);
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    if (isActive === false && employee.isActive !== false) {
      const hasActiveBookings = await this.bookingModel
        .findOne({
          status: { $in: ['assigned', 'in_progress'] },
          $or: [
            { assignedEmployeeId: employee._id },
            { 'assignedEmployees.employeeId': employee._id },
          ],
        })
        .select({ _id: 1 })
        .lean();
      if (hasActiveBookings) {
        throw new ConflictException(
          'Cannot deactivate employee with active bookings',
        );
      }
    }

    employee.isActive = isActive;
    await employee.save();

    await this.userModel.updateOne(
      { _id: employee.userId },
      { $set: { active: isActive } },
    );

    const updated = await this.employeeModel
      .findById(employee._id)
      .populate('userId', 'email role active');
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }

    return this.toEmployeeDto(this.extractEmployeeMeta(updated));
  }

  async setEmployeeRole(
    employeeId: string,
    role: UserRole,
  ): Promise<{
    id: string;
    name: string;
    email: string;
    phone: string;
    role: UserRole;
    isActive: boolean;
  }> {
    if (!Types.ObjectId.isValid(employeeId)) {
      throw new BadRequestException('Invalid employee id');
    }

    if (
      role !== UserRole.ADMIN &&
      role !== UserRole.EMPLOYEE &&
      role !== UserRole.SUPERVISOR
    ) {
      throw new BadRequestException('Invalid role');
    }

    const employee = await this.employeeModel.findById(employeeId);
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    await this.userModel.updateOne(
      { _id: employee.userId },
      { $set: { role } },
    );

    const updated = await this.employeeModel
      .findById(employee._id)
      .populate('userId', 'email role active');
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }

    return this.toEmployeeDto(this.extractEmployeeMeta(updated));
  }

  async updateEmployee(
    employeeId: string,
    input: {
      name?: string;
      phone?: string;
      role?: UserRole;
      isActive?: boolean;
    },
  ): Promise<{
    id: string;
    name: string;
    email: string;
    phone: string;
    role: UserRole;
    isActive: boolean;
  }> {
    if (!Types.ObjectId.isValid(employeeId)) {
      throw new BadRequestException('Invalid employee id');
    }

    const employee = await this.employeeModel.findById(employeeId);
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const nextIsActive =
      typeof input.isActive === 'boolean' ? input.isActive : undefined;
    if (nextIsActive === false && employee.isActive !== false) {
      const hasActiveBookings = await this.bookingModel
        .findOne({
          status: { $in: ['assigned', 'in_progress'] },
          $or: [
            { assignedEmployeeId: employee._id },
            { 'assignedEmployees.employeeId': employee._id },
          ],
        })
        .select({ _id: 1 })
        .lean();
      if (hasActiveBookings) {
        throw new ConflictException(
          'Cannot deactivate employee with active bookings',
        );
      }
    }

    if (typeof input.name === 'string') {
      const name = input.name.trim();
      if (!name) {
        throw new BadRequestException('Name is required');
      }
      employee.name = name;
    }

    if (typeof input.phone === 'string') {
      const phone = input.phone.trim();
      employee.phone = phone ? phone : undefined;
    }

    if (nextIsActive !== undefined) {
      employee.isActive = nextIsActive;
    }

    await employee.save();

    const userUpdates: Record<string, unknown> = {};
    if (nextIsActive !== undefined) {
      userUpdates.active = nextIsActive;
    }

    if (input.role !== undefined) {
      if (
        input.role !== UserRole.ADMIN &&
        input.role !== UserRole.EMPLOYEE &&
        input.role !== UserRole.SUPERVISOR
      ) {
        throw new BadRequestException('Invalid role');
      }
      userUpdates.role = input.role;
    }

    if (Object.keys(userUpdates).length > 0) {
      await this.userModel.updateOne(
        { _id: employee.userId },
        { $set: userUpdates },
      );
    }

    const updated = await this.employeeModel
      .findById(employee._id)
      .populate('userId', 'email role active');
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }

    return this.toEmployeeDto(this.extractEmployeeMeta(updated));
  }

  async deleteEmployee(employeeId: string): Promise<{
    id: string;
    name: string;
    email: string;
    phone: string;
    role: UserRole;
    isActive: boolean;
  }> {
    if (!Types.ObjectId.isValid(employeeId)) {
      throw new BadRequestException('Invalid employee id');
    }

    const employee = await this.employeeModel.findById(employeeId);
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const hasActiveBookings = await this.bookingModel
      .findOne({
        status: { $in: ['assigned', 'in_progress'] },
        $or: [
          { assignedEmployeeId: employee._id },
          { 'assignedEmployees.employeeId': employee._id },
        ],
      })
      .select({ _id: 1 })
      .lean();
    if (hasActiveBookings) {
      throw new ConflictException(
        'Cannot delete employee with active bookings',
      );
    }

    employee.isActive = false;
    await employee.save();

    await this.userModel.updateOne(
      { _id: employee.userId },
      { $set: { active: false } },
    );

    const updated = await this.employeeModel
      .findById(employee._id)
      .populate('userId', 'email role active');
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }

    return this.toEmployeeDto(this.extractEmployeeMeta(updated));
  }

  async getActiveEmployeeById(employeeId: string): Promise<EmployeeDocument> {
    if (!Types.ObjectId.isValid(employeeId)) {
      throw new BadRequestException('Invalid employee id');
    }

    const employee = await this.employeeModel.findById(employeeId);
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    if (!employee.isActive) {
      throw new ConflictException('Employee is inactive');
    }

    return employee;
  }

  async getActiveEmployeeWithUserEmail(employeeId: string): Promise<{
    employee: EmployeeDocument;
    userEmail: string;
    userRole: UserRole;
  }> {
    if (!Types.ObjectId.isValid(employeeId)) {
      throw new BadRequestException('Invalid employee id');
    }

    const employee = await this.employeeModel
      .findById(employeeId)
      .populate('userId', 'email role active');
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    if (!employee.isActive) {
      throw new ConflictException('Employee is inactive');
    }

    const userIdValue = employee.get('userId') as unknown;
    const emailValue =
      typeof (userIdValue as { email?: unknown })?.email === 'string'
        ? (userIdValue as { email: string }).email
        : '';
    const userEmail = emailValue.toLowerCase().trim();
    if (!userEmail) {
      throw new BadRequestException('Employee user is invalid');
    }

    const userActiveValue = (userIdValue as { active?: unknown })?.active;
    if (userActiveValue === false) {
      throw new ConflictException('Employee is inactive');
    }

    const roleValue = (userIdValue as { role?: unknown })?.role;
    const userRole = this.coerceRole(roleValue);

    return { employee, userEmail, userRole };
  }

  async getActiveEmployeesWithUserMeta(
    employeeIds: string[],
  ): Promise<
    Map<
      string,
      { employee: EmployeeDocument; userEmail: string; userRole: UserRole }
    >
  > {
    const ids = Array.from(
      new Set(employeeIds.filter((id) => Types.ObjectId.isValid(id))),
    ).map((id) => new Types.ObjectId(id));

    if (ids.length === 0) {
      throw new BadRequestException('Invalid employee id');
    }

    const employees = await this.employeeModel
      .find({ _id: { $in: ids } })
      .populate('userId', 'email role active');

    if (employees.length !== ids.length) {
      throw new NotFoundException('Employee not found');
    }

    const map = new Map<
      string,
      { employee: EmployeeDocument; userEmail: string; userRole: UserRole }
    >();

    for (const employee of employees) {
      if (!employee.isActive) {
        throw new ConflictException('Employee is inactive');
      }

      const userIdValue = employee.get('userId') as unknown;
      const emailValue =
        typeof (userIdValue as { email?: unknown })?.email === 'string'
          ? (userIdValue as { email: string }).email
          : '';
      const userEmail = emailValue.toLowerCase().trim();
      if (!userEmail) {
        throw new BadRequestException('Employee user is invalid');
      }

      const userActiveValue = (userIdValue as { active?: unknown })?.active;
      if (userActiveValue === false) {
        throw new ConflictException('Employee is inactive');
      }

      const roleValue = (userIdValue as { role?: unknown })?.role;
      const userRole = this.coerceRole(roleValue);

      map.set(String(employee._id), { employee, userEmail, userRole });
    }

    return map;
  }

  async getActiveEmployeeByUserId(userId: string): Promise<EmployeeDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    const employee = await this.employeeModel.findOne({
      userId: new Types.ObjectId(userId),
      isActive: true,
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  async getEmployeeMetaMap(
    employeeIds: string[],
  ): Promise<
    Map<
      string,
      { name: string; email: string; isActive: boolean; role: UserRole }
    >
  > {
    const ids = Array.from(
      new Set(employeeIds.filter((id) => Types.ObjectId.isValid(id))),
    ).map((id) => new Types.ObjectId(id));

    if (ids.length === 0) {
      return new Map();
    }

    const employees = await this.employeeModel
      .find({ _id: { $in: ids } })
      .populate('userId', 'email role active');

    const map = new Map<
      string,
      { name: string; email: string; isActive: boolean; role: UserRole }
    >();
    for (const employee of employees) {
      const meta = this.extractEmployeeMeta(employee);
      map.set(meta.employeeId, {
        name: meta.name,
        email: meta.email,
        isActive: meta.isActive,
        role: meta.role,
      });
    }
    return map;
  }

  private extractEmployeeMeta(employee: EmployeeDocument): {
    employeeId: string;
    name: string;
    email: string;
    phone: string;
    role: UserRole;
    isActive: boolean;
  } {
    const employeeId = String(employee._id);
    const name = typeof employee.name === 'string' ? employee.name : '';
    const isActive = Boolean(employee.isActive);
    const phone =
      typeof (employee as unknown as { phone?: unknown }).phone === 'string'
        ? String((employee as unknown as { phone?: unknown }).phone).trim()
        : '';

    const userIdValue = employee.get('userId') as unknown;
    const emailValue =
      typeof (userIdValue as { email?: unknown })?.email === 'string'
        ? (userIdValue as { email: string }).email
        : '';
    const email = emailValue.toLowerCase().trim();

    const roleValue = (userIdValue as { role?: unknown })?.role;
    const role = this.coerceRole(roleValue);

    return { employeeId, name, email, phone, role, isActive };
  }

  private coerceRole(value: unknown): UserRole {
    if (value === UserRole.ADMIN) return UserRole.ADMIN;
    if (value === UserRole.SUPERVISOR) return UserRole.SUPERVISOR;
    return UserRole.EMPLOYEE;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    );
  }

  private isTransactionNotSupportedError(error: unknown): boolean {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('message' in error) ||
      typeof (error as { message?: unknown }).message !== 'string'
    ) {
      return false;
    }

    const message = (error as { message: string }).message;
    return (
      message.includes('Transaction numbers are only allowed') ||
      message.includes('replica set member or mongos')
    );
  }
}
