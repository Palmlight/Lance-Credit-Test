import { ZodError, type ZodSchema } from "zod";
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/errors.js";

export function validateBody(schema: ZodSchema) {
  return (request: Request, _response: Response, next: NextFunction) => {
    try {
      request.body = schema.parse(request.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiError(400, "Invalid request body", error.flatten()));
        return;
      }

      next(error);
    }
  };
}

