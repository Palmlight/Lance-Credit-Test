import type { NextFunction, Request, Response } from "express";
import { ApiError, isPgSerializationError } from "../utils/errors.js";

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction
) {
  if (isPgSerializationError(error)) {
    response.status(409).json({
      error: "Request conflicted with another concurrent transaction. Please retry."
    });
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    response.status(409).json({
      error: "A record with this unique value already exists"
    });
    return;
  }

  if (error instanceof ApiError) {
    response.status(error.statusCode).json({
      error: error.message,
      details: error.details
    });
    return;
  }

  console.error(error);
  response.status(500).json({
    error: "Internal server error"
  });
}
