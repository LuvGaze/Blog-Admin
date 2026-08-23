/**
 * Express 应用组装
 * - /api/auth/login、/api/health 免鉴权；其余 /api/* 全部走 Bearer token 鉴权
 * - 静态托管 admin/public 于 /admin（后台管理页面）
 * - 统一错误处理：ApiError → 状态码 + message；未知错误 → 500
 */
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { ApiError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
import { PUBLIC_DIR } from "./config/paths.js";
import { BLOG_BASE_URL } from "./config/env.js";
import { authMiddleware } from "./middleware/auth.js";
import { authRouter } from "./controllers/authController.js";
import { contentRouter, modulesListHandler } from "./controllers/contentController.js";
import { configRouter } from "./controllers/configController.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));

// ─────────────── 路由 ───────────────

// 认证（免鉴权）
app.use("/api/auth", authRouter);

// 健康检查（免鉴权：前端登录页探测博客地址用）
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "blog-admin", time: new Date().toISOString(), blogBaseUrl: BLOG_BASE_URL });
});

// 业务 API：全部需要 Bearer token
app.use("/api", authMiddleware);

// 内容模块元数据
app.get("/api/modules", modulesListHandler);

// 内容模块 CRUD / 备份恢复
app.use("/api/content", contentRouter);

// 站点配置 17 target 读取/保存
app.use("/api/config", configRouter);

// ─────────────── 静态后台页面（/admin） ───────────────

app.use(
  "/admin",
  express.static(PUBLIC_DIR, {
    index: "index.html",
    fallthrough: true,
    maxAge: "5m",
  }),
);
// 兜底：未命中静态文件时返回 index.html（SPA 式单页）
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ─────────────── 404 与错误处理 ───────────────

app.use((_req, res) => {
  res.status(404).json({ error: "接口不存在" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error("未处理异常：", err);
  res.status(500).json({ error: `服务器内部错误：${message}` });
});
