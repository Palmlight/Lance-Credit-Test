import { sql } from "drizzle-orm";
import { bigint, check, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import wallets from "./wallets.js";

export const transactionTypeEnum = pgEnum("transaction_type", ["deposit", "transfer"]);

const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: transactionTypeEnum("type").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    fromWalletId: uuid("from_wallet_id").references(() => wallets.id),
    toWalletId: uuid("to_wallet_id").references(() => wallets.id),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    amountPositive: check("ledger_transactions_amount_positive", sql`${table.amount} > 0`),
    walletShape: check(
      "ledger_transactions_wallet_shape",
      sql`(
        (${table.type} = 'deposit' AND ${table.toWalletId} IS NOT NULL AND ${table.fromWalletId} IS NULL)
        OR
        (${table.type} = 'transfer' AND ${table.toWalletId} IS NOT NULL AND ${table.fromWalletId} IS NOT NULL)
      )`
    )
  })
);

export default ledgerTransactions;
