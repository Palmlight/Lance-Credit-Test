export type AuthUser = {
  id: string;
  name: string;
  email: string;
  wallet_id?: string;
  created_at?: string;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
  replayed?: boolean;
};

export type BalanceResponse = {
  user_id: string;
  balance: number;
};

export type Transaction = {
  id: string;
  type: "deposit" | "transfer";
  amount: number;
  created_at: string;
  description: string | null;
  direction: "deposit" | "transfer_in" | "transfer_out";
  counterparty_user_id: string | null;
  counterparty_name: string | null;
};

export type TransactionHistoryResponse = {
  user_id: string;
  transactions: Transaction[];
};
