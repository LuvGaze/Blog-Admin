/**
 * 鉴权中间件：HMAC-SHA256 签名 token（12 小时有效期）
 * 密码校验成功签发 token；后续请求携带 Authorization: Bearer <token>
 */
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ADMIN_PASSWORD, ADMIN_SECRET } from "../config/env.js";
import { unauthorized } from "../utils/errors.js";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

interface AuthPayload {
  sub: "admin";
  iat: number;
  exp: number;
}

/** 签发 token（登录成功后调用） */
export function signToken(): { token: string; expiresAt: number } {
  const iat = Date.now();
  const payload: AuthPayload = { sub: "admin", iat, exp: iat + TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", ADMIN_SECRET).update(body).digest("base64url");
  return { token: `${body}.${sig}`, expiresAt: payload.exp };
}

/** 验证 token（签名 + 有效期） */
export function verifyToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  const expect = crypto.createHmac("sha256", ADMIN_SECRET).update(body).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AuthPayload;
    return payload.sub === "admin" && typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

/** 密码恒定时间比较 */
export function verifyPassword(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 未配置密码时的状态（登录接口提示） */
export function passwordConfigured(): boolean {
  return ADMIN_PASSWORD !== "";
}

/** Express 鉴权中间件：所有 /api 业务路由前置 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token === "" || !verifyToken(token)) {
    next(unauthorized());
    return;
  }
  next();
}
