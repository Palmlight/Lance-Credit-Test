import bcrypt from "bcryptjs";
import { ApiError } from "../../utils/errors.js";
import { signAccessToken } from "../../utils/jwt.js";
import { userService } from "../user/user.service.js";

type AuthResponseUser = {
  id: string;
  name: string;
  email: string;
  wallet_id?: string;
  created_at?: Date;
};

export class AuthService {
  buildAuthResponse(user: AuthResponseUser) {
    const token = signAccessToken({
      userId: user.id,
      email: user.email
    });

    return {
      token,
      user
    };
  }

  async assertValidUserCredentials(email: string, password: string) {
    const user = await userService.findUserByEmail(email);

    if (!user) {
      throw new ApiError(401, "Invalid email or password");
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      throw new ApiError(401, "Invalid email or password");
    }

    return user;
  }
}

export const authService = new AuthService();
