import { Router } from "express";
import { validateBody } from "../../middleware/validate.js";
import { userController, createUserValidation } from "./user.controller.js";

const userRouter = Router();

userRouter.post("/", validateBody(createUserValidation), userController.createUser);

export default userRouter;
