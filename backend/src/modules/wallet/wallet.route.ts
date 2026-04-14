import { Router } from "express";
import { validateBody } from "../../middleware/validate.js";
import {
  depositValidation,
  transferValidation
} from "./wallet.controller.js";
import { walletController } from "./wallet.controller.js";

const walletRouter = Router();

walletRouter.post("/deposit", validateBody(depositValidation), walletController.postDeposit);
walletRouter.post("/transfer", validateBody(transferValidation), walletController.postTransfer);
walletRouter.get("/me/balance", walletController.getMyBalance);
walletRouter.get("/me/transactions", walletController.getMyTransactions);
walletRouter.get("/:userId/balance", walletController.getBalance);
walletRouter.get("/:userId/transactions", walletController.getTransactions);

export default walletRouter;
