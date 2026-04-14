import cors from "cors";
import express from "express";
import helmet from "helmet";
import { authenticate } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRouter from "./modules/auth/auth.route.js";
import userRouter from "./modules/user/user.route.js";
import walletRouter from "./modules/wallet/wallet.route.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.use("/auth", authRouter);
app.use("/users", userRouter);
app.use("/wallet", authenticate, walletRouter);
app.use(errorHandler);
