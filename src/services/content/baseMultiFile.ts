/**
 * 通用多文件 md 模块 service（isSingleFile=false / =true 均适用）
 * 提供 list / get / create / update / delete / restore / backups + 参数校验
 */
import fs from "node:fs";
import path from "node:path";
import { badRequest, notFound } from "../../utils/errors.js";
import {
  backupDir,
  backupFile,
  listBackups,
  restoreDirBackup,
  restoreFileBackup,
  type BackupInfo,
} from "../../utils/backup.js";
import { ensureDir, listFiles, readText, removeFile, safeName, writeTextAtomic } from "../../utils/fsx.js";
import { CONTENT_ROOT } from "../../config/paths.js";
import type { ContentDetail, ContentListItem, ContentModuleDef } from "../../types/content.js";
import { BACKUP_CONTENT_ROOT } from "../../config/paths.js";
import {
  analyzeFrontmatter,
  buildFrontmatterTemplate,
  joinFrontmatter,
  splitFrontmatter,
  writeFrontmatter,
  type ChangeOp,
} from "../yamlService.js";
import { applyDefaults, validateFields } from "./validate.js";

export interface ContentSaveInput {
  /** 字段值（form 回填结构） */
  data: Record<string, unknown>;
  /** 正文（md） */
  body?: string;
}

export interface ContentService {
  meta: ContentModuleDef;
  list(): ContentListItem[];
  get(id: string): ContentDetail;
  create(input: ContentSaveInput): { id: string; filename: string };
  update(id: string, input: ContentSaveInput): void;
  delete(id: string): void;
  restore(backupName: string): void;
  backups(): BackupInfo[];
  /** 手动创建整模块备份（目录快照），返回备份名 */
  backupNow(): string;
}

/** 检测文本换行风格 */
function detectNewline(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export class MultiFileContentService implements ContentService {
  readonly meta: ContentModuleDef;

  constructor(def: ContentModuleDef) {
    this.meta = def;
  }

  /** 模块源目录绝对路径 */
  get root(): string {
    return path.join(CONTENT_ROOT, this.meta.dir);
  }

  /** 模块备份目录绝对路径 */
  get backupRoot(): string {
    return path.join(BACKUP_CONTENT_ROOT, this.meta.id);
  }

  private resolveFile(id: string): string {
    if (typeof id !== "string" || id === "" || id.includes("/") || id.includes("\\") || id.includes("..")) {
      throw badRequest("文件名非法");
    }
    const file = path.join(this.root, id);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw notFound(`${this.meta.name}文件不存在`);
    }
    return file;
  }

  private readAll(id: string): { file: string; source: string } {
    const file = this.resolveFile(id);
    const source = readText(file);
    if (source === null) throw notFound(`${this.meta.name}文件不存在`);
    return { file, source };
  }

  list(): ContentListItem[] {
    const ext = this.meta.ext ?? ".md";
    const files = listFiles(this.root, ext).filter((f) => !f.includes(".bak"));
    const items = files.map((f) => {
      const raw = readText(path.join(this.root, f)) ?? "";
      const parsed = this.parseEntry(raw);
      return {
        id: f,
        filename: f,
        title: String(parsed.fields[this.meta.titleField] ?? f),
        fields: parsed.fields,
        error: parsed.error,
      };
    });
    if (this.meta.sortOrder) {
      const keys = this.meta.sortKeys?.length ? this.meta.sortKeys : ["filename"];
      items.sort((a, b) => {
        for (const key of keys) {
          const av = String(a.fields[key] ?? a.filename ?? "");
          const bv = String(b.fields[key] ?? b.filename ?? "");
          const cmp = av.localeCompare(bv);
          if (cmp !== 0) {
            return this.meta.sortOrder === "desc" ? -cmp : cmp;
          }
        }
        return 0;
      });
    }
    return items;
  }

  get(id: string): ContentDetail {
    const { source } = this.readAll(id);
    if (this.meta.noFrontmatter) {
      return { id, filename: id, fields: {}, body: source, hasFrontmatter: false, unknownKeys: [] };
    }
    const parsed = this.parseEntry(source);
    return {
      id,
      filename: id,
      fields: parsed.fields,
      body: parsed.body,
      hasFrontmatter: parsed.hasFrontmatter,
      unknownKeys: parsed.unknownKeys,
      error: parsed.error,
    };
  }

  /** 解析单个 md：分离 frontmatter/正文；YAML 非法时标记 error */
  private parseEntry(source: string): {
    fields: Record<string, unknown>;
    body: string;
    hasFrontmatter: boolean;
    unknownKeys: string[];
    error?: string;
  } {
    const { frontmatter, body } = splitFrontmatter(source);
    if (frontmatter === null) {
      return { fields: {}, body, hasFrontmatter: false, unknownKeys: [], error: this.meta.noFrontmatter ? undefined : "缺少 YAML frontmatter 头部" };
    }
    const parsed = analyzeFrontmatter(frontmatter);
    if (parsed.errors.length > 0) {
      return { fields: {}, body, hasFrontmatter: true, unknownKeys: [], error: `YAML 语法错误：${parsed.errors[0]}` };
    }
    const fields: Record<string, unknown> = {};
    for (const f of parsed.fields) fields[f.key] = f.value;
    return { fields, body, hasFrontmatter: true, unknownKeys: parsed.unknownKeys };
  }

  /** 生成不冲突的文件名 */
  private genFileName(values: Record<string, unknown>): string {
    const ext = this.meta.ext ?? ".md";
    const base = this.meta.fileName
      ? this.meta.fileName(values)
      : safeName(String(values[this.meta.titleField] ?? "untitled"));
    const exist = new Set(listFiles(this.root, ext));
    let name = `${base}${ext}`;
    let i = 2;
    while (exist.has(name)) {
      name = `${base}-${i}${ext}`;
      i += 1;
    }
    return name;
  }

  create(input: ContentSaveInput): { id: string; filename: string } {
    if (this.meta.isSingleFile) {
      throw badRequest(`${this.meta.name}为单文件模块，不支持新建`);
    }
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    applyDefaults(this.meta, values, true);
    const { remove } = this.meta.normalize ? this.meta.normalize(values, true) : { remove: [] as string[] };
    for (const key of remove) delete values[key];
    validateFields(this.meta, values, true);

    const filename = this.genFileName(values);
    const nl = this.detectDirNewline();
    const dateKeys = new Set(this.meta.fields.filter((f) => f.type === "date").map((f) => f.key));
    const fm = buildFrontmatterTemplate(values, nl, dateKeys, this.meta.yamlFormat);
    const body = typeof input.body === "string" ? input.body : "";
    const content = this.meta.noFrontmatter ? body : `---${nl}${fm}---${nl}${body === "" ? "" : nl + body}`;
    ensureDir(this.root);
    writeTextAtomic(path.join(this.root, filename), content);
    return { id: filename, filename };
  }

  update(id: string, input: ContentSaveInput): void {
    if (this.meta.isSingleFile && id !== (this.meta.fileName?.({}) ?? "about.md")) {
      throw notFound(`${this.meta.name}文件不存在`);
    }
    const { file, source } = this.readAll(id);
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    applyDefaults(this.meta, values, false);
    const { remove } = this.meta.normalize ? this.meta.normalize(values, false) : { remove: [] as string[] };

    if (this.meta.noFrontmatter) {
      // about：无 frontmatter，剔除任何 YAML 头部后直接覆盖正文
      const body = typeof input.body === "string" ? input.body : "";
      const stripped = splitFrontmatter(body).body;
      backupFile(file, this.backupRoot);
      writeTextAtomic(file, stripped);
      return;
    }

    validateFields(this.meta, values, false);

    // 组装写回变更：仅提交且非空串的字段；remove 清单删除字段
    const changes: ChangeOp[] = [];
    for (const field of this.meta.fields) {
      const v = values[field.key];
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v === "") continue; // 空串视为不修改
      // 日期字段强制无引号：博客 z.date() 校验要求 YAML 解析为 Date，带引号会变成字符串
      changes.push({ key: field.key, value: v, quote: field.type === "date" ? "none" : "auto" });
    }
    for (const key of remove) {
      changes.push({ key, remove: true });
    }

    const { frontmatter, body: oldBody } = splitFrontmatter(source);
    if (frontmatter === null) {
      throw badRequest("文件缺少 YAML frontmatter，无法更新；请先检查文件格式");
    }
    const newFm = writeFrontmatter(frontmatter, changes, this.meta.yamlFormat);
    const newBody = typeof input.body === "string" ? input.body : oldBody;
    const output = joinFrontmatter(newFm, newBody, true);

    backupFile(file, this.backupRoot);
    writeTextAtomic(file, output);
  }

  delete(id: string): void {
    if (this.meta.isSingleFile) {
      throw badRequest(`${this.meta.name}为单文件模块，禁止删除（文件丢失时可通过备份恢复重建）`);
    }
    const { file } = this.readAll(id);
    backupFile(file, this.backupRoot);
    removeFile(file);
  }

  restore(backupName: string): void {
    const dest = this.meta.fileName ? path.join(this.root, this.meta.fileName({})) : undefined;
    if (this.meta.isSingleFile && dest) {
      restoreFileBackup(this.backupRoot, backupName, dest);
      return;
    }
    // 整模块目录快照备份（books_20260806-101530.bak）：整体还原模块目录
    if (/\.bak$/i.test(backupName) && !/\.bak\.\w+$/i.test(backupName)) {
      restoreDirBackup(this.backupRoot, backupName, this.root);
      return;
    }
    // 多文件模块：备份名须为 `原文件名_时间戳.bak.md`，还原到源目录
    const m = /^(.+)_\d{8}-\d{6}\.bak(\.\w+)?$/.exec(backupName);
    if (!m) {
      throw badRequest("备份名称格式非法");
    }
    const destFile = path.join(this.root, m[1]);
    restoreFileBackup(this.backupRoot, backupName, destFile);
  }

  /** 手动创建整模块目录快照备份 */
  backupNow(): string {
    return backupDir(this.root, this.backupRoot);
  }

  backups(): BackupInfo[] {
    return listBackups(this.backupRoot);
  }

  /** 目录现有文件换行风格（新文件跟随） */
  private detectDirNewline(): string {
    const ext = this.meta.ext ?? ".md";
    const files = listFiles(this.root, ext);
    for (const f of files) {
      const raw = readText(path.join(this.root, f));
      if (raw !== null && raw.includes("\r\n")) return "\r\n";
    }
    return "\n";
  }
}
