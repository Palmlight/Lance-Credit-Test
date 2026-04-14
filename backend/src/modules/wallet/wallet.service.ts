import { sql } from "drizzle-orm";
import type { AppTransaction } from "../../db/pool.js";
import ledgerEntries from "../../models/ledgerEntries.js";
import ledgerTransactions from "../../models/ledgerTransactions.js";
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

  private async getBalanceForWallet(tx: AppTransaction, walletId: string): Promise<number> {
    const result = await tx.execute<{ balance: number | null }>(sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN entry_type = 'credit' THEN amount
          ELSE -amount
        END
      ), 0)::bigint AS balance
      FROM ledger_entries
      WHERE wallet_id = ${walletId}
    `);

    return Number(result.rows[0]?.balance ?? 0);
  }

  async getBalanceByUserId(
    tx: AppTransaction,
    userId: string
  ): Promise<{ user_id: string; balance: number }> {
    const walletRows = await this.getWalletsForUsers(tx, [userId], false);
    const wallet = walletRows[0];

    if (!wallet) {
      throw new ApiError(404, "User wallet not found");
    }

    const balance = await this.getBalanceForWallet(tx, wallet.wallet_id);

    return {
      user_id: userId,
      balance
    };
  }

  async depositFunds(
    tx: AppTransaction,
    input: { userId: string; amount: number }
  ) {
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

    const balance = await this.getBalanceForWallet(tx, wallet.wallet_id);

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

    const senderBalance = await this.getBalanceForWallet(tx, sender.wallet_id);

    if (senderBalance < input.amount) {
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

    const updatedSenderBalance = await this.getBalanceForWallet(tx, sender.wallet_id);

    return {
      transaction_id: ledgerTransaction.id,
      from_user_id: input.fromUserId,
      to_user_id: input.toUserId,
      amount: input.amount,
      balance_after_transfer: updatedSenderBalance,
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
