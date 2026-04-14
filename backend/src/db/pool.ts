import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import idempotencyKeys from "../models/idempotencyKeys.js";
import ledgerEntries from "../models/ledgerEntries.js";
import ledgerTransactions from "../models/ledgerTransactions.js";
import users from "../models/users.js";
import wallets from "../models/wallets.js";
import { isPgSerializationError } from "../utils/errors.js";

const schema = {
  users,
  wallets,
  ledgerTransactions,
  ledgerEntries,
  idempotencyKeys
};

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined
});

export const db = drizzle(pool, { schema });

export type AppDb = typeof db;
export type AppTransaction = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export async function withSerializableTransaction<T>(
  work: (tx: AppTransaction) => Promise<T>
): Promise<T> {
  let attempt = 0;

  while (attempt < 3) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
        return work(tx);
      });
    } catch (error) {
      if (isPgSerializationError(error) && attempt < 2) {
        attempt += 1;
        continue;
      }

      throw error;
    }
  }

  throw new Error("Transaction retry limit exceeded");
}
