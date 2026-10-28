import { Controller, Get, Param } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from './schema';

@Controller('users')
export class UsersController {
  @Get(':id')
  find(@Param('id') id: string) {
    return db.select().from(users).where(eq(users.id, id));
  }
}
