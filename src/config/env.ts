/**
 * 环境变量读取
 * 优先读取 admin/.env；不存在时兼容读取项目根 .env 的 ADMIN_PASSWORD（文档约定），只读不写。
 */
import fs from "node:fs";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { ENV_FILE_ADMIN, ENV_FILE_PROJECT } from "./paths.js";

function loadEnvFile(): void {
  if (fs.existsSync(ENV_FILE_ADMIN)) {
    dotenv.config({ path: ENV_FILE_ADMIN });
  } else if (fs.existsSync(ENV_FILE_PROJECT)) {
    dotenv.config({ path: ENV_FILE_PROJECT });
  }
}

loadEnvFile();

function readStr(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/** 服务监听端口 */
export const PORT: number = (() => {
  const raw = readStr("PORT", "3344");
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3344;
})();

/** 后台管理密码（来自 ADMIN_PASSWORD） */
export const ADMIN_PASSWORD: string = readStr("ADMIN_PASSWORD", "");

/** token 签名密钥：优先 ADMIN_SECRET，否则随机生成（重启后会话失效） */
export const ADMIN_SECRET: string = readStr("ADMIN_SECRET", crypto.randomBytes(32).toString("hex"));

/** 博客站点基础地址（后台「预览」跳转用，astro dev 默认 4321 端口） */
export const BLOG_BASE_URL: string = readStr("BLOG_BASE_URL", "http://localhost:4321").replace(/\/+$/, "");
