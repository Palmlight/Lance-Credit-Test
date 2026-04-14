import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { z } from "zod";
import { executeIdempotent } from "../../services/idempotencyService.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiError } from "../../utils/errors.js";
import { hashPayload } from "../../utils/hash.js";
import { authService } from "./auth.service.js";
import { userService } from "../user/user.service.js";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128)
});

export const registerValidation = registerSchema;
export const loginValidation = loginSchema;

export class AuthController {
  register = asyncHandler(async (request: Request, response: Response) => {
    const payload = registerSchema.parse(request.body);
    const idempotencyKey = request.header("x-idempotency-key") ?? undefined;

    const result = await executeIdempotent(
      {
        scope: "auth-register",
        key: idempotencyKey,
        requestHash: hashPayload({ ...payload, email: payload.email.toLowerCase() })
      },
      async (tx) => {
        const existingUser = await userService.findUserByEmail(payload.email);

        if (existingUser) {
          throw new ApiError(409, "An account with this email already exists");
        }

        const passwordHash = await bcrypt.hash(payload.password, 12);
        const user = await userService.createUserWithWallet(tx, {
          name: payload.name,
          email: payload.email,
          passwordHash
        });

        return {
          statusCode: 201,
          body: authService.buildAuthResponse(user)
        };
      }
    );

    response.status(result.statusCode).json({
      ...result.body,
      replayed: result.replayed
    });
  });

  login = asyncHandler(async (request: Request, response: Response) => {
    const payload = loginSchema.parse(request.body);
    const user = await authService.assertValidUserCredentials(payload.email, payload.password);

    response.json(
      authService.buildAuthResponse({
        id: user.id,
        name: user.name,
        email: user.email,
        created_at: user.createdAt
      })
    );
  });

  getMe = asyncHandler(async (request: Request, response: Response) => {
    const authUser = request.authUser;

    if (!authUser) {
      throw new ApiError(401, "Unauthorized");
    }

    const user = await userService.findUserById(authUser.userId);

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    response.json({ user });
  });
}

export const authController = new AuthController();
