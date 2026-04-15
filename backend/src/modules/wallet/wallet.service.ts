import { eq, sql } from "drizzle-orm";
import type { AppTransaction } from "../../db/pool.js";
import ledgerEntries from "../../models/ledgerEntries.js";
import ledgerTransactions from "../../models/ledgerTransactions.js";
import wallets from "../../models/wallets.js";
import { ApiError } from "../../utils/errors.js";

type WalletRow = {
  wallet_id: string;
  user_id: string;
  user_name: string;
};

export class WalletService {
  private uuidList(userIds: string[]) {
    return sql.join(userIds.map((id) => sql`${id}`), sql`, `);
  }

  private async getWalletsForUsers(
    tx: AppTransaction,
    userIds: string[],
    lockRows = false
  ): Promise<WalletRow[]> {
    const lockingClause = lockRows ? sql` FOR UPDATE` : sql``;
    const result = await tx.execute<WalletRow>(sql`
      SELECT w.id AS wallet_id, u.id AS user_id, u.name AS user_name
      FROM wallets w
      INNER JOIN users u ON u.id = w.user_id
      WHERE u.id IN (${this.uuidList(userIds)})
      ORDER BY w.id${lockingClause}
    `);

    return result.rows;
  }

  private async incrementWalletBalance(
    tx: AppTransaction,
    walletId: string,
    amount: number
  ): Promise<number> {
    const result = await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${amount}` })
      .where(eq(wallets.id, walletId))
      .returning({ balance: wallets.balance });

    return result[0].balance;
  }

  async getBalanceByUserId(
    tx: AppTransaction,
    userId: string
  ): Promise<{ user_id: string; balance: number }> {
    const result = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);

    if (result.length === 0) {
      throw new ApiError(404, "User wallet not found");
    }

    return { user_id: userId, balance: result[0].balance };
  }

  async depositFunds(
    tx: AppTransaction,
    input: { userId: string; amount: number }
  ) {
    if (input.amount <= 0) {
      throw new ApiError(400, "Amount must be greater than zero");
    }

    const walletRows = await this.getWalletsForUsers(tx, [input.userId], true);
    const wallet = walletRows[0];

    if (!wallet) {
      throw new ApiError(404, "Recipient wallet not found");
    }

    const [ledgerTransaction] = await tx
      .insert(ledgerTransactions)
      .values({
        type: "deposit",
        amount: input.amount,
        toWalletId: wallet.wallet_id,
        description: "Wallet deposit"
      })
      .returning({
        id: ledgerTransactions.id,
        created_at: ledgerTransactions.createdAt
      });

    await tx.insert(ledgerEntries).values({
      transactionId: ledgerTransaction.id,
      walletId: wallet.wallet_id,
      entryType: "credit",
      amount: input.amount
    });

    const balance = await this.incrementWalletBalance(tx, wallet.wallet_id, input.amount);

    return {
      transaction_id: ledgerTransaction.id,
      user_id: input.userId,
      amount: input.amount,
      balance,
      created_at: ledgerTransaction.created_at
    };
  }

  async transferFunds(
    tx: AppTransaction,
    input: { fromUserId: string; toUserId: string; amount: number }
  ) {
    if (input.amount <= 0) {
      throw new ApiError(400, "Amount must be greater than zero");
    }

    if (input.fromUserId === input.toUserId) {
      throw new ApiError(400, "Cannot transfer funds to the same wallet");
    }

    const walletRows = await this.getWalletsForUsers(tx, [input.fromUserId, input.toUserId], true);

    const sender = walletRows.find((wallet) => wallet.user_id === input.fromUserId);
    const recipient = walletRows.find((wallet) => wallet.user_id === input.toUserId);

    if (!sender) {
      throw new ApiError(404, "Sender wallet not found");
    }

    if (!recipient) {
      throw new ApiError(404, "Recipient wallet not found");
    }

    const senderWallet = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, sender.wallet_id))
      .limit(1);

    if (senderWallet[0].balance < input.amount) {
      throw new ApiError(400, "Insufficient funds");
    }

    const [ledgerTransaction] = await tx
      .insert(ledgerTransactions)
      .values({
        type: "transfer",
        amount: input.amount,
        fromWalletId: sender.wallet_id,
        toWalletId: recipient.wallet_id,
        description: `Transfer from ${sender.user_name} to ${recipient.user_name}`
      })
      .returning({
        id: ledgerTransactions.id,
        created_at: ledgerTransactions.createdAt
      });

    await tx.insert(ledgerEntries).values([
      {
        transactionId: ledgerTransaction.id,
        walletId: sender.wallet_id,
        entryType: "debit",
        amount: input.amount
      },
      {
        transactionId: ledgerTransaction.id,
        walletId: recipient.wallet_id,
        entryType: "credit",
        amount: input.amount
      }
    ]);

    const balanceAfterTransfer = await this.incrementWalletBalance(tx, sender.wallet_id, -input.amount);
    await this.incrementWalletBalance(tx, recipient.wallet_id, input.amount);

    return {
      transaction_id: ledgerTransaction.id,
      from_user_id: input.fromUserId,
      to_user_id: input.toUserId,
      amount: input.amount,
      balance_after_transfer: balanceAfterTransfer,
      created_at: ledgerTransaction.created_at
    };
  }

  async getTransactionHistory(tx: AppTransaction, userId: string) {
    const walletResult = await tx.execute<{ wallet_id: string }>(sql`
      SELECT id AS wallet_id
      FROM wallets
      WHERE user_id = ${userId}
    `);

    const wallet = walletResult.rows[0];

    if (!wallet) {
      throw new ApiError(404, "User wallet not found");
    }

    const result = await tx.execute<{
      id: string;
      type: "deposit" | "transfer";
      amount: number;
      created_at: Date;
      description: string | null;
      direction: "deposit" | "transfer_in" | "transfer_out";
      counterparty_user_id: string | null;
      counterparty_name: string | null;
    }>(sql`
      SELECT
        t.id,
        t.type,
        t.amount::bigint AS amount,
        t.created_at,
        t.description,
        CASE
          WHEN t.type = 'deposit' THEN 'deposit'
          WHEN t.from_wallet_id = ${wallet.wallet_id} THEN 'transfer_out'
          ELSE 'transfer_in'
        END AS direction,
        CASE
          WHEN t.type = 'transfer' AND t.from_wallet_id = ${wallet.wallet_id} THEN recipient_user.id
          WHEN t.type = 'transfer' AND t.to_wallet_id = ${wallet.wallet_id} THEN sender_user.id
          ELSE NULL
        END AS counterparty_user_id,
        CASE
          WHEN t.type = 'transfer' AND t.from_wallet_id = ${wallet.wallet_id} THEN recipient_user.name
          WHEN t.type = 'transfer' AND t.to_wallet_id = ${wallet.wallet_id} THEN sender_user.name
          ELSE NULL
        END AS counterparty_name
      FROM ledger_transactions t
      LEFT JOIN wallets sender_wallet ON sender_wallet.id = t.from_wallet_id
      LEFT JOIN users sender_user ON sender_user.id = sender_wallet.user_id
      LEFT JOIN wallets recipient_wallet ON recipient_wallet.id = t.to_wallet_id
      LEFT JOIN users recipient_user ON recipient_user.id = recipient_wallet.user_id
      WHERE t.from_wallet_id = ${wallet.wallet_id} OR t.to_wallet_id = ${wallet.wallet_id}
      ORDER BY t.created_at DESC
    `);

    return result.rows.map((row) => ({
      ...row,
      amount: Number(row.amount)
    }));
  }
}

export const walletService = new WalletService();
