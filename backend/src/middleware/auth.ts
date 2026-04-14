import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { ApiError } from "../utils/errors.js";

export function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction
) {
  const authorization = request.header("authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    next(new ApiError(401, "Missing or invalid authorization header"));
    return;
  }

  const token = authorization.slice("Bearer ".length).trim();

  try {
    request.authUser = verifyAccessToken(token);
    next();
  } catch {
    next(new ApiError(401, "Invalid or expired token"));
  }
}
