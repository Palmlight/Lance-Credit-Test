import { and, eq, sql } from "drizzle-orm";
import type { AppTransaction } from "../db/pool.js";
import { withSerializableTransaction } from "../db/pool.js";
import idempotencyKeys from "../models/idempotencyKeys.js";
import { ApiError } from "../utils/errors.js";

type IdempotentResult<T> = {
  statusCode: number;
  body: T;
  replayed: boolean;
};

type HandlerResult<T> = {
  statusCode: number;
  body: T;
};

type StoredIdempotencyRecord<T> = {
  request_hash: string;
  status: "processing" | "completed";
  response_code: number | null;
  response_body: T | null;
};

export async function executeIdempotent<T extends Record<string, unknown>>(
  options: {
    scope: string;
    key?: string;
    requestHash: string;
  },
  handler: (tx: AppTransaction) => Promise<HandlerResult<T>>
): Promise<IdempotentResult<T>> {
  const trimmedKey = options.key?.trim();

  if (!trimmedKey) {
    const result = await withSerializableTransaction(handler);
    return {
      ...result,
      replayed: false
    };
  }

  return withSerializableTransaction(async (tx) => {
    const insertedRows = await tx
      .insert(idempotencyKeys)
      .values({
        scope: options.scope,
        key: trimmedKey,
        requestHash: options.requestHash,
        status: "processing"
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    const existingResult = await tx.execute<StoredIdempotencyRecord<T>>(sql`
      SELECT request_hash, status, response_code, response_body
      FROM idempotency_keys
      WHERE scope = ${options.scope} AND key = ${trimmedKey}
      FOR UPDATE
    `);

    const existing = existingResult.rows[0];

    if (!existing) {
      throw new ApiError(500, "Failed to create idempotency record");
    }

    if (existing.request_hash !== options.requestHash) {
      throw new ApiError(
        409,
        "Idempotency key was already used with a different request payload"
      );
    }

    if (insertedRows.length === 0) {
      if (existing.status === "completed" && existing.response_code && existing.response_body) {
        return {
          statusCode: existing.response_code,
          body: existing.response_body,
          replayed: true
        };
      }

      throw new ApiError(409, "Request with this idempotency key is already in progress");
    }

    const result = await handler(tx);

    await tx
      .update(idempotencyKeys)
      .set({
        status: "completed",
        responseCode: result.statusCode,
        responseBody: result.body,
        updatedAt: new Date()
      })
      .where(and(eq(idempotencyKeys.scope, options.scope), eq(idempotencyKeys.key, trimmedKey)));

    return {
      ...result,
      replayed: false
    };
  });
}
