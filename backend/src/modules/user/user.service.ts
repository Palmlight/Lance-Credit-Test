import { eq } from "drizzle-orm";
import type { AppTransaction } from "../../db/pool.js";
import { db } from "../../db/pool.js";
import users from "../../models/users.js";
import wallets from "../../models/wallets.js";

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
};

export class UserService {
  async createUserWithWallet(
    tx: AppTransaction,
    input: { name: string; email: string; passwordHash: string }
  ): Promise<{ id: string; name: string; email: string; wallet_id: string; created_at: Date }> {
    const [user] = await tx
      .insert(users)
      .values({
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash
      })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        created_at: users.createdAt
      });

    const [wallet] = await tx
      .insert(wallets)
      .values({ userId: user.id })
      .returning({ id: wallets.id });

    return {
      ...user,
      wallet_id: wallet.id
    };
  }

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const result = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
        createdAt: users.createdAt
      })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    return result[0];
  }

  async findUserById(userId: string): Promise<Omit<UserRecord, "passwordHash"> | undefined> {
    const result = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return result[0];
  }
}

export const userService = new UserService();
