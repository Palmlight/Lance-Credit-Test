import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { authController, loginValidation, registerValidation } from "./auth.controller.js";

const authRouter = Router();

authRouter.post("/register", validateBody(registerValidation), authController.register);
authRouter.post("/login", validateBody(loginValidation), authController.login);
authRouter.get("/me", authenticate, authController.getMe);

export default authRouter;
