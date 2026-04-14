import type { Request, Response } from "express";
import { z } from "zod";
import { withSerializableTransaction } from "../../db/pool.js";
import { executeIdempotent } from "../../services/idempotencyService.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiError } from "../../utils/errors.js";
import { hashPayload } from "../../utils/hash.js";
import { walletService } from "./wallet.service.js";

const moneySchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const depositSchema = z.object({
  amount: moneySchema
});

const transferSchema = z.object({
  to_user_id: z.string().uuid(),
  amount: moneySchema
});

export const depositValidation = depositSchema;
export const transferValidation = transferSchema;

export class WalletController {
  private parseUserId(rawUserId: string | string[]) {
    const candidate = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
    const parsed = z.string().uuid().safeParse(candidate);

    if (!parsed.success) {
      throw new ApiError(400, "Invalid user id");
    }

    return parsed.data;
  }

  private getAuthenticatedUserId(request: Request) {
    const userId = request.authUser?.userId;

    if (!userId) {
      throw new ApiError(401, "Unauthorized");
    }

    return userId;
  }

  private assertSameUser(request: Request, requestedUserId: string) {
    const authenticatedUserId = this.getAuthenticatedUserId(request);

    if (authenticatedUserId !== requestedUserId) {
      throw new ApiError(403, "You can only access your own wallet");
    }

    return authenticatedUserId;
  }

  postDeposit = asyncHandler(async (request: Request, response: Response) => {
    const payload = depositSchema.parse(request.body);
    const userId = this.getAuthenticatedUserId(request);
    const idempotencyKey = request.header("x-idempotency-key") ?? undefined;

    const result = await executeIdempotent(
      {
        scope: "wallet-deposit",
        key: idempotencyKey,
        requestHash: hashPayload({ user_id: userId, amount: payload.amount })
      },
      async (tx) => {
        const deposit = await walletService.depositFunds(tx, {
          userId,
          amount: payload.amount
        });

        return {
          statusCode: 201,
          body: deposit
        };
      }
    );

    response.status(result.statusCode).json({
      ...result.body,
      replayed: result.replayed
    });
  });

  postTransfer = asyncHandler(async (request: Request, response: Response) => {
    const payload = transferSchema.parse(request.body);
    const fromUserId = this.getAuthenticatedUserId(request);
    const idempotencyKey = request.header("x-idempotency-key") ?? undefined;

    const result = await executeIdempotent(
      {
        scope: "wallet-transfer",
        key: idempotencyKey,
        requestHash: hashPayload({ from_user_id: fromUserId, ...payload })
      },
      async (tx) => {
        const transfer = await walletService.transferFunds(tx, {
          fromUserId,
          toUserId: payload.to_user_id,
          amount: payload.amount
        });

        return {
          statusCode: 201,
          body: transfer
        };
      }
    );

    response.status(result.statusCode).json({
      ...result.body,
      replayed: result.replayed
    });
  });

  getMyBalance = asyncHandler(async (request: Request, response: Response) => {
    const userId = this.getAuthenticatedUserId(request);
    const result = await withSerializableTransaction((tx) => walletService.getBalanceByUserId(tx, userId));
    response.json(result);
  });

  getMyTransactions = asyncHandler(async (request: Request, response: Response) => {
    const userId = this.getAuthenticatedUserId(request);
    const result = await withSerializableTransaction((tx) => walletService.getTransactionHistory(tx, userId));
    response.json({
      user_id: userId,
      transactions: result
    });
  });

  getBalance = asyncHandler(async (request: Request, response: Response) => {
    const userId = this.parseUserId(request.params.userId);
    this.assertSameUser(request, userId);

    const result = await withSerializableTransaction((tx) => walletService.getBalanceByUserId(tx, userId));

    response.json(result);
  });

  getTransactions = asyncHandler(async (request: Request, response: Response) => {
    const userId = this.parseUserId(request.params.userId);
    this.assertSameUser(request, userId);

    const result = await withSerializableTransaction((tx) => walletService.getTransactionHistory(tx, userId));

    response.json({
      user_id: userId,
      transactions: result
    });
  });
}

export const walletController = new WalletController();
