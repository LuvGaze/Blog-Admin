/**
 * 配置模块控制器（docs/后端设置Demo/00_公共通用规则.md API 约定）
 * GET /api/config → target 清单
 * GET /api/config/:target → 字段数组 [{keyPath,value,hasQuote,isMedia}] + skipped
 * POST /api/config/:target → { changes:[{keyPath,value,hasQuote}] } 写回（AST / __raw_html）
 */
import { Router } from "express";
import { badRequest } from "../utils/errors.js";
import { listConfigTargets, readConfigTarget, saveConfigTarget } from "../services/configService.js";

export const configRouter = Router();

/** GET /api/config：target 清单 */
configRouter.get("/", (_req, res, next) => {
  try {
    res.json({ targets: listConfigTargets() });
  } catch (e) {
    next(e);
  }
});

/** GET /api/config/:target：读取全部字段 */
configRouter.get("/:target", (req, res, next) => {
  try {
    res.json(readConfigTarget(req.params.target));
  } catch (e) {
    next(e);
  }
});

/** POST /api/config/:target：保存变更 */
configRouter.post("/:target", (req, res, next) => {
  try {
    const changes = req.body?.changes;
    if (!Array.isArray(changes)) {
      throw badRequest("changes 必须为数组");
    }
    const result = saveConfigTarget(req.params.target, changes);
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});
