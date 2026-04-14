import { useEffect, useState } from "react";
import { apiRequest, clearStoredToken, getStoredToken, makeIdempotencyKey, setStoredToken } from "./api";
import type { AuthResponse, AuthUser, BalanceResponse, TransactionHistoryResponse } from "./types";

const initialRegisterForm = { name: "", email: "", password: "" };
const initialLoginForm = { email: "", password: "" };
const initialDepositForm = { amount: "" };
const initialTransferForm = { to_user_id: "", amount: "" };

export default function App() {
  const [registerForm, setRegisterForm] = useState(initialRegisterForm);
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [depositForm, setDepositForm] = useState(initialDepositForm);
  const [transferForm, setTransferForm] = useState(initialTransferForm);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<TransactionHistoryResponse["transactions"]>([]);
  const [message, setMessage] = useState("Register or log in to access your wallet.");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setAuthUser(null);
      setBalance(null);
      setTransactions([]);
      return;
    }

    void bootstrapSession(token);
  }, [token]);

  async function bootstrapSession(activeToken: string) {
    setLoading(true);
    setError("");

    try {
      const profile = await apiRequest<{ user: AuthUser }>("/auth/me", {
        token: activeToken
      });
      setAuthUser(profile.user);
      await refreshWallet(activeToken);
    } catch (requestError) {
      clearStoredToken();
      setToken(null);
      setAuthUser(null);
      setError(requestError instanceof Error ? requestError.message : "Unable to restore session");
    } finally {
      setLoading(false);
    }
  }

  async function refreshWallet(activeToken = token) {
    if (!activeToken) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [balanceResponse, transactionsResponse] = await Promise.all([
        apiRequest<BalanceResponse>("/wallet/me/balance", { token: activeToken }),
        apiRequest<TransactionHistoryResponse>("/wallet/me/transactions", { token: activeToken })
      ]);

      setBalance(balanceResponse.balance);
      setTransactions(transactionsResponse.transactions);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load wallet");
    } finally {
      setLoading(false);
    }
  }

  async function handleAuthSuccess(result: AuthResponse, successMessage: string) {
    setStoredToken(result.token);
    setToken(result.token);
    setAuthUser(result.user);
    setMessage(successMessage);
    setError("");
    await refreshWallet(result.token);
  }

  async function handleRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await apiRequest<AuthResponse>("/auth/register", {
        method: "POST",
        body: registerForm,
        idempotencyKey: makeIdempotencyKey("register")
      });

      setRegisterForm(initialRegisterForm);
      setLoginForm({ email: registerForm.email, password: "" });
      await handleAuthSuccess(result, `Welcome, ${result.user.name}. Your wallet is ready.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to register");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: loginForm
      });

      setLoginForm(initialLoginForm);
      await handleAuthSuccess(result, `Signed in as ${result.user.email}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to log in");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeposit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await apiRequest("/wallet/deposit", {
        method: "POST",
        body: { amount: Number(depositForm.amount) },
        idempotencyKey: makeIdempotencyKey("deposit"),
        token
      });

      setMessage(`Deposited ${depositForm.amount} into your wallet.`);
      setDepositForm(initialDepositForm);
      await refreshWallet();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to deposit");
    } finally {
      setLoading(false);
    }
  }

  async function handleTransfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await apiRequest("/wallet/transfer", {
        method: "POST",
        body: {
          to_user_id: transferForm.to_user_id,
          amount: Number(transferForm.amount)
        },
        idempotencyKey: makeIdempotencyKey("transfer"),
        token
      });

      setMessage(`Transferred ${transferForm.amount} to ${transferForm.to_user_id}.`);
      setTransferForm(initialTransferForm);
      await refreshWallet();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to transfer funds");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearStoredToken();
    setToken(null);
    setAuthUser(null);
    setBalance(null);
    setTransactions([]);
    setDepositForm(initialDepositForm);
    setTransferForm(initialTransferForm);
    setMessage("You have been signed out.");
    setError("");
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">JWT-authenticated ledger wallet</p>
          <h1>Wallet dashboard</h1>
          <p className="hero-copy">
            Users register and log in with email and password, receive JWT access tokens, and can
            only act on their own wallet while balances remain ledger-derived.
          </p>
        </div>
        <div className="status-card">
          <span className="status-label">Signed-in user</span>
          <strong>{authUser?.email ?? "No active session"}</strong>
          <span className="status-label">Current balance</span>
          <strong>{balance ?? 0}</strong>
          {authUser ? (
            <button type="button" onClick={handleLogout}>
              Log out
            </button>
          ) : null}
        </div>
      </section>

      {!authUser ? (
        <section className="grid auth-grid">
          <article className="card">
            <h2>Register</h2>
            <form onSubmit={handleRegister} className="stack">
              <label>
                Name
                <input
                  value={registerForm.name}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="John Doe"
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="john@example.com"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Minimum 8 characters"
                  required
                />
              </label>
              <button disabled={loading} type="submit">
                Create account
              </button>
            </form>
          </article>

          <article className="card">
            <h2>Log in</h2>
            <form onSubmit={handleLogin} className="stack">
              <label>
                Email
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="john@example.com"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Your password"
                  required
                />
              </label>
              <button disabled={loading} type="submit">
                Log in
              </button>
            </form>
          </article>
        </section>
      ) : (
        <>
          <section className="grid">
            <article className="card">
              <h2>Account</h2>
              <div className="stack">
                <div>
                  <strong>{authUser.name}</strong>
                  <p>{authUser.email}</p>
                </div>
                <div>
                  <span className="status-label">User ID</span>
                  <strong>{authUser.id}</strong>
                </div>
                {authUser.wallet_id ? (
                  <div>
                    <span className="status-label">Wallet ID</span>
                    <strong>{authUser.wallet_id}</strong>
                  </div>
                ) : null}
                <button disabled={loading} onClick={() => void refreshWallet()} type="button">
                  Refresh wallet
                </button>
              </div>
            </article>

            <article className="card">
              <h2>Deposit funds</h2>
              <form onSubmit={handleDeposit} className="stack">
                <label>
                  Amount
                  <input
                    type="number"
                    min="1"
                    value={depositForm.amount}
                    onChange={(event) => setDepositForm({ amount: event.target.value })}
                    placeholder="5000"
                    required
                  />
                </label>
                <button disabled={loading} type="submit">
                  Deposit to my wallet
                </button>
              </form>
            </article>

            <article className="card">
              <h2>Transfer funds</h2>
              <form onSubmit={handleTransfer} className="stack">
                <label>
                  Recipient user ID
                  <input
                    value={transferForm.to_user_id}
                    onChange={(event) => setTransferForm((current) => ({ ...current, to_user_id: event.target.value }))}
                    placeholder="UUID"
                    required
                  />
                </label>
                <label>
                  Amount
                  <input
                    type="number"
                    min="1"
                    value={transferForm.amount}
                    onChange={(event) => setTransferForm((current) => ({ ...current, amount: event.target.value }))}
                    placeholder="1000"
                    required
                  />
                </label>
                <button disabled={loading} type="submit">
                  Transfer from my wallet
                </button>
              </form>
            </article>
          </section>

          <section className="feedback">
            <p>{message}</p>
            {error ? <p className="error">{error}</p> : null}
            {loading ? <p className="muted">Loading…</p> : null}
          </section>

          <section className="card">
            <div className="section-heading">
              <h2>Transaction history</h2>
              <span>{transactions.length} records</span>
            </div>
            <div className="transaction-list">
              {transactions.length === 0 ? (
                <p className="muted">No transactions yet for this wallet.</p>
              ) : (
                transactions.map((transaction) => (
                  <div key={transaction.id} className="transaction-row">
                    <div>
                      <strong>{transaction.direction.replace("_", " ")}</strong>
                      <p>{transaction.description ?? "Ledger transaction"}</p>
                    </div>
                    <div className="transaction-meta">
                      <strong>{transaction.amount}</strong>
                      <span>{new Date(transaction.created_at).toLocaleString()}</span>
                      {transaction.counterparty_name ? (
                        <span>Counterparty: {transaction.counterparty_name}</span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      {!authUser ? (
        <section className="feedback">
          <p>{message}</p>
          {error ? <p className="error">{error}</p> : null}
          {loading ? <p className="muted">Loading…</p> : null}
        </section>
      ) : null}
    </main>
  );
}
