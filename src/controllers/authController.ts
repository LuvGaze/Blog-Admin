/**
 * 认证控制器：POST /api/auth/login
 * 密码错误返回 401；未配置 ADMIN_PASSWORD 返回 500 提示
 */
import { Router } from "express";
import { badRequest, internal, unauthorized } from "../utils/errors.js";
import { passwordConfigured, signToken, verifyPassword } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

export const authRouter = Router();

authRouter.post("/login", (req, res, next) => {
  try {
    if (!passwordConfigured()) {
      logger.warn("未配置 ADMIN_PASSWORD，拒绝登录；请在 admin/.env 或项目根 .env 中设置");
      throw internal("服务端未配置 ADMIN_PASSWORD，请在 admin/.env 或项目根 .env 中设置后重启");
    }
    const password = req.body?.password;
    if (typeof password !== "string" || password === "") {
      throw badRequest("密码不能为空");
    }
    if (!verifyPassword(password)) {
      throw unauthorized("密码错误");
    }
    const { token, expiresAt } = signToken();
    res.json({ token, expiresAt, expiresIn: 12 * 60 * 60 });
  } catch (e) {
    next(e);
  }
});
