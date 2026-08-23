/**
 * 内容模块控制器（docs/后端新增Demo/00_公共通用规则.md）
 * 路由：/api/content/:module ...；notebooks 为多层目录模块，子路由先行注册
 * 全部读写经 service：YAML 引号保留写回、自动备份、防路径穿越
 */
import { Router, type Request, type Response } from "express";
import { badRequest } from "../utils/errors.js";
import { getContentService, isNotebooksModule, notebooksService, listContentModules } from "../services/content/registry.js";
import { notebookFieldDef, noteFieldDef } from "../services/content/notebooksService.js";

export const contentRouter = Router();

// ─────────────── 模块元数据 / 清单 ───────────────

/** GET /api/modules：模块清单 + 字段定义（前端动态渲染表单） */
export function modulesListHandler(_req: Request, res: Response): void {
  const modules = listContentModules().map((m) => {
    if (m.isNotebooks) {
      return { ...m, fields: notebookFieldDef, noteFields: noteFieldDef };
    }
    const svc = getContentService(m.id);
    return {
      id: m.id,
      name: m.name,
      isNotebooks: false,
      urlPrefix: m.urlPrefix,
      hasBody: svc.meta.hasBody,
      isSingleFile: svc.meta.isSingleFile,
      noFrontmatter: svc.meta.noFrontmatter === true,
      titleField: svc.meta.titleField,
      fields: svc.meta.fields,
    };
  });
  res.json({ modules });
}

// ─────────────── notebooks 多层模块：笔记子路由（优先注册） ───────────────

/** 新建笔记 */
contentRouter.post("/notebooks/:notebookId/notes", (req, res, next) => {
  try {
    const r = notebooksService.createNote(req.params.notebookId, { data: req.body?.data, body: req.body?.body });
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});

/** 笔记详情 */
contentRouter.get("/notebooks/:notebookId/notes/:noteId", (req, res, next) => {
  try {
    res.json(notebooksService.getNote(req.params.notebookId, req.params.noteId));
  } catch (e) {
    next(e);
  }
});

/** 更新笔记（仅更新传入字段，引号保留） */
contentRouter.put("/notebooks/:notebookId/notes/:noteId", (req, res, next) => {
  try {
    notebooksService.updateNote(req.params.notebookId, req.params.noteId, { data: req.body?.data, body: req.body?.body });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** 删除笔记 */
contentRouter.delete("/notebooks/:notebookId/notes/:noteId", (req, res, next) => {
  try {
    notebooksService.deleteNote(req.params.notebookId, req.params.noteId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** 恢复单篇笔记 */
contentRouter.post("/notebooks/:notebookId/notes/:noteId/restore", (req, res, next) => {
  try {
    notebooksService.restoreNote(req.params.notebookId, String(req.body?.backupName ?? ""));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ─────────────── 通用模块路由 ───────────────

/** 备份列表（含 notebooks 目录快照 + md 备份） */
contentRouter.get("/:module/backups", (req, res, next) => {
  try {
    const moduleId = req.params.module;
    if (isNotebooksModule(moduleId)) {
      res.json(notebooksService.backups());
      return;
    }
    res.json(getContentService(moduleId).backups());
  } catch (e) {
    next(e);
  }
});

/** 手动创建备份（目录快照） */
contentRouter.post("/:module/backups", (req, res, next) => {
  try {
    const moduleId = req.params.module;
    if (isNotebooksModule(moduleId)) {
      const created = notebooksService.backupNow();
      res.status(201).json({ ok: true, created });
      return;
    }
    const svc = getContentService(moduleId);
    const name = svc.backupNow();
    res.status(201).json({ ok: true, created: [name] });
  } catch (e) {
    next(e);
  }
});

/** 恢复（notebooks：恢复整个笔记本目录快照） */
contentRouter.post("/:module/restore", (req, res, next) => {
  try {
    const moduleId = req.params.module;
    const backupName = String(req.body?.backupName ?? "");
    if (backupName === "") throw badRequest("backupName 不能为空");
    if (isNotebooksModule(moduleId)) {
      notebooksService.restoreNotebook(backupName);
    } else {
      getContentService(moduleId).restore(backupName);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** 列表（notebooks：笔记本列表） */
contentRouter.get("/:module", (req, res, next) => {
  try {
    const moduleId = req.params.module;
    if (isNotebooksModule(moduleId)) {
      res.json(notebooksService.listNotebooks());
      return;
    }
    res.json(getContentService(moduleId).list());
  } catch (e) {
    next(e);
  }
});

/** 新建（notebooks：新建笔记本） */
contentRouter.post("/:module", (req, res, next) => {
  try {
    const moduleId = req.params.module;
    if (isNotebooksModule(moduleId)) {
      const r = notebooksService.createNotebook({ data: req.body?.data });
      res.status(201).json(r);
      return;
    }
    const svc = getContentService(moduleId);
    const r = svc.create({ data: req.body?.data, body: req.body?.body });
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});

/** 详情（notebooks：笔记本详情含笔记列表） */
contentRouter.get("/:module/:id", (req, res, next) => {
  try {
    const moduleId = req.params.module;
    if (isNotebooksModule(moduleId)) {
      res.json(notebooksService.getNotebook(req.params.id));
      return;
    }
    res.json(getContentService(moduleId).get(req.params.id));
  } catch (e) {
    next(e);
  }
});

/** 更新（notebooks：更新笔记本 _index.json） */
contentRouter.put("/:module/:id", (req, res, next) => {
  try {
    const moduleId = req.params.module;
    if (isNotebooksModule(moduleId)) {
      notebooksService.updateNotebook(req.params.id, { data: req.body?.data });
    } else {
      getContentService(moduleId).update(req.params.id, { data: req.body?.data, body: req.body?.body });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** 删除（notebooks：整目录快照备份后删除） */
contentRouter.delete("/:module/:id", (req, res, next) => {
  try {
    const moduleId = req.params.module;
    if (isNotebooksModule(moduleId)) {
      notebooksService.deleteNotebook(req.params.id);
    } else {
      getContentService(moduleId).delete(req.params.id);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
