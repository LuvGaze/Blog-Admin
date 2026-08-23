/**
 * notebooks 笔记本模块 service（docs/后端新增Demo/08_notebooks笔记本.md）
 * 结构：src/content/notebooks/{笔记本ID}/_index.json + 若干 *.md 笔记
 * - 笔记本 = 子目录 + _index.json（JSON 严格校验，用 jsonService）
 * - 笔记 = 目录下 md（frontmatter 用 yamlService 引号保留写回）
 * - 备份：更新/删除自动备份，目录快照走 backupDir，md 走 backupFile
 * - 新建不备份；恢复：目录还原 / md 还原回对应笔记本
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
import { ensureDir, listDirs, listFiles, readText, removeDir, removeFile, safeName, writeTextAtomic } from "../../utils/fsx.js";
import { BACKUP_CONTENT_ROOT, CONTENT_ROOT } from "../../config/paths.js";
import type { ContentDetail, ContentListItem, FieldDef, YamlFormat } from "../../types/content.js";
import { readJsonFile, writeJsonFile } from "../jsonService.js";
import {
  analyzeFrontmatter,
  buildFrontmatterTemplate,
  joinFrontmatter,
  splitFrontmatter,
  writeFrontmatter,
  type ChangeOp,
} from "../yamlService.js";
import { applyDefaults, validateFields } from "./validate.js";

/** 笔记本元信息字段定义（_index.json 表单） */
export const notebookFieldDef: FieldDef[] = [
  { key: "name", label: "笔记本名称", type: "string", required: true, help: "展示名称，非目录 ID" },
  { key: "cover", label: "封面图", type: "url", media: true, help: "http/https 在线图片链接" },
  { key: "summary", label: "笔记本简介", type: "string" },
];

/** 笔记 md frontmatter 字段定义 */
export const noteFieldDef: FieldDef[] = [
  { key: "title", label: "笔记标题", type: "string", required: true },
  { key: "date", label: "笔记日期", type: "date", required: true, help: "格式 YYYY-MM-DD" },
  { key: "tags", label: "标签", type: "stringArray" },
];

/** 笔记 md 写回格式规范（与现有笔记文件一致：全双引号、tags flow 双引号、date 双引号） */
const noteYamlFormat: YamlFormat = {
  quote: "double",
  arrayStyle: "flow",
  arrayItemQuote: "double",
  overrides: { date: { quote: "double" } },
};

/** 笔记本元信息数据结构 */
export interface NotebookMeta {
  name: string;
  cover?: string;
  summary?: string;
}

/** 笔记本摘要（列表用） */
export interface NotebookListItem {
  id: string;
  name: string;
  cover?: string;
  summary?: string;
  noteCount: number;
  /** _index.json 缺失或 JSON 非法时非空 */
  error?: string;
}

/** 笔记条目摘要 */
export interface NoteListItem extends ContentListItem {
  date?: string;
}

function detectNewline(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export class NotebooksService {
  readonly id = "notebooks";
  readonly name = "笔记本";

  /** 模块源目录 src/content/notebooks */
  get root(): string {
    return path.join(CONTENT_ROOT, "notebooks");
  }

  /** 备份目录 admin/backup/content/notebooks */
  get backupRoot(): string {
    return path.join(BACKUP_CONTENT_ROOT, "notebooks");
  }

  /** 校验笔记本 ID（目录名）并返回目录绝对路径 */
  private resolveNotebookDir(id: string): string {
    if (typeof id !== "string" || id === "" || id.includes("/") || id.includes("\\") || id.includes("..")) {
      throw badRequest("笔记本 ID 非法");
    }
    const dir = path.join(this.root, id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw notFound("笔记本不存在");
    }
    return dir;
  }

  /** 校验笔记文件名并返回 md 绝对路径 */
  private resolveNoteFile(notebookId: string, noteId: string): string {
    if (typeof noteId !== "string" || noteId === "" || noteId.includes("/") || noteId.includes("\\") || noteId.includes("..") || !noteId.endsWith(".md")) {
      throw badRequest("笔记文件名非法");
    }
    const file = path.join(this.resolveNotebookDir(notebookId), noteId);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw notFound("笔记不存在");
    }
    return file;
  }

  /** 解析单个笔记 md 的 frontmatter */
  private parseNote(source: string): { fields: Record<string, unknown>; body: string; unknownKeys: string[]; error?: string } {
    const { frontmatter, body } = splitFrontmatter(source);
    if (frontmatter === null) {
      return { fields: {}, body, unknownKeys: [], error: "缺少 YAML frontmatter 头部" };
    }
    const parsed = analyzeFrontmatter(frontmatter);
    if (parsed.errors.length > 0) {
      return { fields: {}, body, unknownKeys: [], error: `YAML 语法错误：${parsed.errors[0]}` };
    }
    const fields: Record<string, unknown> = {};
    for (const f of parsed.fields) fields[f.key] = f.value;
    return { fields, body, unknownKeys: parsed.unknownKeys };
  }

  /** 读取笔记本元信息；目录缺失 _index.json 时返回 error */
  private readNotebookMeta(dir: string): { meta: Record<string, unknown>; error?: string } {
    const indexFile = path.join(dir, "_index.json");
    if (!fs.existsSync(indexFile)) {
      return { meta: {}, error: "缺少 _index.json，视为非法笔记本" };
    }
    try {
      return { meta: readJsonFile<Record<string, unknown>>(indexFile) };
    } catch (e) {
      return { meta: {}, error: (e as Error).message };
    }
  }

  // ─────────────── 笔记本：目录 + _index.json ───────────────

  /** 笔记本列表（含每本笔记数量） */
  listNotebooks(): NotebookListItem[] {
    return listDirs(this.root).map((id) => {
      const dir = path.join(this.root, id);
      const { meta, error } = this.readNotebookMeta(dir);
      const noteCount = listFiles(dir, ".md").length;
      return {
        id,
        name: String(meta.name ?? id),
        cover: meta.cover === undefined ? undefined : String(meta.cover),
        summary: meta.summary === undefined ? undefined : String(meta.summary),
        noteCount,
        error,
      };
    });
  }

  /** 笔记本详情：元信息 + 笔记列表 */
  getNotebook(id: string): NotebookListItem & { notes: NoteListItem[]; unknownKeys: string[] } {
    const dir = this.resolveNotebookDir(id);
    const { meta, error } = this.readNotebookMeta(dir);
    const notes: NoteListItem[] = listFiles(dir, ".md").map((f) => {
      const raw = readText(path.join(dir, f)) ?? "";
      const parsed = this.parseNote(raw);
      return {
        id: f,
        filename: f,
        title: String(parsed.fields.title ?? f),
        fields: parsed.fields,
        date: parsed.fields.date === undefined ? undefined : String(parsed.fields.date),
        error: parsed.error,
      };
    });
    return {
      id,
      name: String(meta.name ?? id),
      cover: meta.cover === undefined ? undefined : String(meta.cover),
      summary: meta.summary === undefined ? undefined : String(meta.summary),
      noteCount: notes.length,
      notes,
      unknownKeys: Object.keys(meta).filter((k) => !notebookFieldDef.some((f) => f.key === k)),
      error,
    };
  }

  /** 新建笔记本：创建子目录 + 合法 _index.json（新建不备份） */
  createNotebook(input: { data: Record<string, unknown> }): { id: string } {
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    validateFields({ fields: notebookFieldDef }, values, true);
    const id = safeName(String(values.name ?? ""), "notebook");
    const dir = path.join(this.root, id);
    if (fs.existsSync(dir)) {
      throw badRequest(`笔记本「${id}」已存在，请换一个名称`);
    }
    const meta: NotebookMeta = {
      name: String(values.name),
      ...(typeof values.cover === "string" && values.cover !== "" ? { cover: values.cover } : {}),
      ...(typeof values.summary === "string" && values.summary !== "" ? { summary: values.summary } : {}),
    };
    ensureDir(dir);
    writeJsonFile(path.join(dir, "_index.json"), meta);
    return { id };
  }

  /** 更新笔记本元信息：校验 JSON → 备份 → 原子写回 */
  updateNotebook(id: string, input: { data: Record<string, unknown> }): void {
    const dir = this.resolveNotebookDir(id);
    const indexFile = path.join(dir, "_index.json");
    if (!fs.existsSync(indexFile)) {
      throw badRequest("笔记本缺少 _index.json，无法更新");
    }
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    validateFields({ fields: notebookFieldDef }, values, false);
    const meta: NotebookMeta = {
      name: String(values.name),
      ...(typeof values.cover === "string" && values.cover !== "" ? { cover: values.cover } : {}),
      ...(typeof values.summary === "string" && values.summary !== "" ? { summary: values.summary } : {}),
    };
    backupFile(indexFile, this.backupRoot);
    writeJsonFile(indexFile, meta);
  }

  /** 删除笔记本：整目录快照备份后删除 */
  deleteNotebook(id: string): void {
    const dir = this.resolveNotebookDir(id);
    backupDir(dir, this.backupRoot);
    removeDir(dir);
  }

  /** 恢复整个笔记本目录快照 */
  restoreNotebook(backupName: string): void {
    const m = /^(.+?)_\d{8}-\d{6}\.bak$/.exec(backupName);
    if (!m) {
      throw badRequest("备份名称格式非法（目录快照形如 笔记本名_时间戳.bak）");
    }
    const destDir = path.join(this.root, m[1]);
    restoreDirBackup(this.backupRoot, backupName, destDir);
  }

  /** 手动创建备份：逐个笔记本目录快照，返回备份名列表 */
  backupNow(): string[] {
    const names: string[] = [];
    for (const d of listDirs(this.root)) {
      names.push(backupDir(path.join(this.root, d), this.backupRoot));
    }
    return names;
  }

  // ─────────────── 笔记：目录下 md ───────────────

  /** 单篇笔记详情（表单回填） */
  getNote(notebookId: string, noteId: string): ContentDetail {
    const file = this.resolveNoteFile(notebookId, noteId);
    const source = readText(file) ?? "";
    const parsed = this.parseNote(source);
    return {
      id: noteId,
      filename: noteId,
      fields: parsed.fields,
      body: parsed.body,
      hasFrontmatter: parsed.fields !== undefined && Object.keys(parsed.fields).length > 0,
      unknownKeys: parsed.unknownKeys,
      error: parsed.error,
    };
  }

  /** 新建笔记：title 生成不冲突文件名，frontmatter 模板 + 正文 */
  createNote(notebookId: string, input: { data: Record<string, unknown>; body?: string }): { id: string; filename: string } {
    const dir = this.resolveNotebookDir(notebookId);
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    applyDefaults({ fields: noteFieldDef }, values, true);
    validateFields({ fields: noteFieldDef }, values, true);

    const base = safeName(String(values.title ?? "note"), "note");
    const exist = new Set(listFiles(dir, ".md"));
    let name = `${base}.md`;
    let i = 2;
    while (exist.has(name)) {
      name = `${base}-${i}.md`;
      i += 1;
    }

    const nl = this.detectDirNewline(dir);
    const dateKeys = new Set(noteFieldDef.filter((f) => f.type === "date").map((f) => f.key));
    const fm = buildFrontmatterTemplate(values, nl, dateKeys, noteYamlFormat);
    const body = typeof input.body === "string" ? input.body : "";
    const content = `---${nl}${fm}---${nl}${body === "" ? "" : nl + body}`;
    writeTextAtomic(path.join(dir, name), content);
    return { id: name, filename: name };
  }

  /** 更新笔记：仅更新传入字段（引号保留），未传入字段原样保留 */
  updateNote(notebookId: string, noteId: string, input: { data: Record<string, unknown>; body?: string }): void {
    const file = this.resolveNoteFile(notebookId, noteId);
    const source = readText(file) ?? "";
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    validateFields({ fields: noteFieldDef }, values, false);

    const changes: ChangeOp[] = [];
    for (const field of noteFieldDef) {
      const v = values[field.key];
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v === "") continue; // 空串视为不修改
      changes.push({ key: field.key, value: v, quote: field.type === "date" ? "none" : "auto" });
    }

    const { frontmatter, body: oldBody } = splitFrontmatter(source);
    if (frontmatter === null) {
      throw badRequest("笔记缺少 YAML frontmatter，无法更新");
    }
    const newFm = writeFrontmatter(frontmatter, changes, noteYamlFormat);
    const newBody = typeof input.body === "string" ? input.body : oldBody;
    const output = joinFrontmatter(newFm, newBody, true);

    backupFile(file, this.backupRoot);
    writeTextAtomic(file, output);
  }

  /** 删除单篇笔记：备份 md 后删除，不动 _index.json */
  deleteNote(notebookId: string, noteId: string): void {
    const file = this.resolveNoteFile(notebookId, noteId);
    backupFile(file, this.backupRoot);
    removeFile(file);
  }

  /** 恢复单篇笔记 md 到对应笔记本 */
  restoreNote(notebookId: string, backupName: string): void {
    const m = /^(.+)_\d{8}-\d{6}\.bak(\.\w+)?$/.exec(backupName);
    if (!m) {
      throw badRequest("备份名称格式非法");
    }
    const dir = this.resolveNotebookDir(notebookId);
    const destFile = path.join(dir, m[1]);
    restoreFileBackup(this.backupRoot, backupName, destFile);
  }

  /** 全部备份（目录快照 + md 备份混排，按时间倒序） */
  backups(): BackupInfo[] {
    return listBackups(this.backupRoot);
  }

  /** 目录现有 md 换行风格（新笔记跟随） */
  private detectDirNewline(dir: string): string {
    const files = listFiles(dir, ".md");
    for (const f of files) {
      const raw = readText(path.join(dir, f));
      if (raw !== null && raw.includes("\r\n")) return "\r\n";
    }
    return "\n";
  }
}
