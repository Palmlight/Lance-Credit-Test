import cors, { type CorsOptions } from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRouter from "./modules/auth/auth.route.js";
import userRouter from "./modules/user/user.route.js";
import walletRouter from "./modules/wallet/wallet.route.js";

export const app = express();

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  optionsSuccessStatus: 204
};

app.use(helmet());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.use("/auth", authRouter);
app.use("/users", userRouter);
app.use("/wallet", authenticate, walletRouter);
app.use(errorHandler);
