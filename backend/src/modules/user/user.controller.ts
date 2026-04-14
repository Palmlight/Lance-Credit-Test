import { authController, registerValidation as createUserValidation } from "../auth/auth.controller.js";

export class UserController {
  createUser = authController.register;
}

export const userController = new UserController();
export { createUserValidation };
