import { sql } from "drizzle-orm";
import { bigint, check, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import ledgerTransactions from "./ledgerTransactions.js";
import wallets from "./wallets.js";

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", ["credit", "debit"]);

const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: "cascade" }),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    amountPositive: check("ledger_entries_amount_positive", sql`${table.amount} > 0`)
  })
);

export default ledgerEntries;
