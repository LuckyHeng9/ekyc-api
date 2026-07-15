import { Injectable, NotFoundException } from '@nestjs/common';
import { UserStore } from './user.store';

@Injectable()
export class UserService {
  private readonly store = new UserStore();

  async findAll() {
    const users = await this.store.findAll();
    return {
      total: users.length,
      data: users,
    };
  }

  async findById(id: string) {
    const user = await this.store.findById(id);
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    return user;
  }
}
