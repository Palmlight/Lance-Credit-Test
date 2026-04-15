import { bigint, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import users from "./users.js";

const wallets = pgTable("wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export default wallets;
