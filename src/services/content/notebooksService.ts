/**
 * notebooks 笔记本模块 service
 * 结构：src/content/notebooks/{笔记本ID}/_index.json + 若干 *.md 笔记
 * - 笔记本元信息遵循 notebooks schema（name/title/cover/summary/image/tags/date/order）
 * - 笔记本按 order 倒序、其次最近笔记日期倒序
 * - 笔记按 order 倒序、其次日期倒序
 * - 更新只改动提交字段；未知字段原样保留
 * - 更新/删除自动备份，支持恢复
 */
import fs from "node:fs";
import path from "node:path";
import { badRequest, notFound } from "../../utils/errors.js";
import {
  backupDir,
  backupFile,
  backupOrigin,
  decodeBackupOrigin,
  deleteBackup,
  listBackups,
  restoreDirBackup,
  restoreFileBackup,
  type BackupInfo,
} from "../../utils/backup.js";
import { ensureDir, listDirs, listFiles, readText, removeDir, removeFile, safeName, writeTextAtomic } from "../../utils/fsx.js";
import { BACKUP_CONTENT_ROOT, CONTENT_ROOT } from "../../config/paths.js";
import type { ContentDetail, ContentListItem, FieldDef } from "../../types/content.js";
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
  { key: "name", label: "笔记本名称", type: "string", required: true, help: "展示名称；新建时同时用于生成目录 ID" },
  { key: "title", label: "副标题", type: "string", help: "可选，显示在名称下方" },
  { key: "cover", label: "封面图", type: "string", media: true, help: "在线图片 URL 或站内路径" },
  { key: "summary", label: "笔记本简介", type: "textarea" },
  { key: "image", label: "配图", type: "string", media: true, help: "可选，单张图片地址" },
  { key: "tags", label: "标签", type: "stringArray", help: "每行一个标签" },
  { key: "date", label: "创建日期", type: "date" },
  { key: "order", label: "排序", type: "number", defaultValue: 0, help: "越大越靠前" },
];

/** 笔记 md frontmatter 字段定义 */
export const noteFieldDef: FieldDef[] = [
  { key: "title", label: "笔记标题", type: "string", required: true },
  { key: "date", label: "笔记日期", type: "date", required: true, help: "格式 YYYY-MM-DD" },
  { key: "tags", label: "标签", type: "stringArray", help: "每行一个标签" },
  { key: "order", label: "排序", type: "number", defaultValue: 0, help: "越大越靠前；相同按日期从新到旧" },
];

/** 笔记 md 写回格式规范（与现有笔记文件一致：全双引号、tags flow 双引号、date 双引号） */
const noteYamlFormat = {
  quote: "double" as const,
  arrayStyle: "flow" as const,
  arrayItemQuote: "double" as const,
  overrides: { date: { quote: "double" as const } },
};

/** 笔记本摘要（列表用） */
export interface NotebookListItem {
  id: string;
  name: string;
  fields: Record<string, unknown>;
  noteCount: number;
  latestDate: string;
  /** _index.json 缺失或 JSON 非法时非空 */
  error?: string;
}

/** 笔记条目摘要 */
export interface NoteListItem extends ContentListItem {
  date?: string;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

export class NotebooksService {
  readonly id = "notebooks";
  readonly name = "笔记本";

  get root(): string {
    return path.join(CONTENT_ROOT, "notebooks");
  }

  get backupRoot(): string {
    return path.join(BACKUP_CONTENT_ROOT, "notebooks");
  }

  private resolveNotebookDir(id: string): string {
    if (typeof id !== "string" || id === "" || id.includes("/") || id.includes("\\") || id.includes("..")) {
      throw badRequest("笔记本 ID 非法");
    }
    const dir = path.join(this.root, id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw notFound("笔记本不存在");
    return dir;
  }

  private resolveNoteFile(notebookId: string, noteId: string): string {
    if (
      typeof noteId !== "string" ||
      noteId === "" ||
      noteId.includes("/") ||
      noteId.includes("\\") ||
      noteId.includes("..") ||
      !noteId.endsWith(".md")
    ) {
      throw badRequest("笔记文件名非法");
    }
    const file = path.join(this.resolveNotebookDir(notebookId), noteId);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw notFound("笔记不存在");
    return file;
  }

  private parseNote(source: string): {
    fields: Record<string, unknown>;
    body: string;
    hasFrontmatter: boolean;
    unknownKeys: string[];
    error?: string;
  } {
    const { frontmatter, body } = splitFrontmatter(source);
    if (frontmatter === null) {
      return { fields: {}, body, hasFrontmatter: false, unknownKeys: [], error: "缺少 YAML frontmatter 头部" };
    }
    const parsed = analyzeFrontmatter(frontmatter);
    if (parsed.errors.length > 0) {
      return { fields: {}, body, hasFrontmatter: true, unknownKeys: [], error: `YAML 语法错误：${parsed.errors[0]}` };
    }
    const fields: Record<string, unknown> = {};
    for (const f of parsed.fields) fields[f.key] = f.value;
    return { fields, body, hasFrontmatter: true, unknownKeys: parsed.unknownKeys };
  }

  private readNotebookMeta(dir: string): { meta: Record<string, unknown>; error?: string } {
    const indexFile = path.join(dir, "_index.json");
    if (!fs.existsSync(indexFile)) return { meta: {}, error: "缺少 _index.json，视为非法笔记本" };
    try {
      const raw = readJsonFile<unknown>(indexFile);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { meta: {}, error: "_index.json 必须为 JSON 对象" };
      }
      return { meta: raw as Record<string, unknown> };
    } catch (e) {
      return { meta: {}, error: (e as Error).message };
    }
  }

  /** 读取并排序笔记列表 */
  private readNotes(dir: string): NoteListItem[] {
    const notes: NoteListItem[] = listFiles(dir, ".md").map((f) => {
      const raw = readText(path.join(dir, f)) ?? "";
      const parsed = this.parseNote(raw);
      return {
        id: f,
        filename: f,
        title: String(parsed.fields["title"] ?? f),
        fields: parsed.fields,
        date: parsed.fields["date"] === undefined ? undefined : String(parsed.fields["date"]),
        error: parsed.error,
      };
    });
    notes.sort((a, b) => {
      const ao = num(a.fields["order"]);
      const bo = num(b.fields["order"]);
      if (ao !== bo) return bo - ao;
      const dateCmp = String(b.fields["date"] ?? "").localeCompare(String(a.fields["date"] ?? ""));
      if (dateCmp !== 0) return dateCmp;
      return a.filename.localeCompare(b.filename, "zh-CN");
    });
    return notes;
  }

  // ─────────────── 笔记本：目录 + _index.json ───────────────

  listNotebooks(): NotebookListItem[] {
    const items = listDirs(this.root).map((id) => {
      const dir = path.join(this.root, id);
      const { meta, error } = this.readNotebookMeta(dir);
      const notes = this.readNotes(dir);
      const latestDate = notes.reduce((max, n) => (dateValue(n.date) > max ? dateValue(n.date) : max), "");
      return {
        id,
        name: String(meta["name"] ?? id),
        fields: meta,
        noteCount: notes.length,
        latestDate,
        error,
      };
    });
    items.sort((a, b) => {
      const orderCmp = num(b.fields["order"]) - num(a.fields["order"]);
      if (orderCmp !== 0) return orderCmp;
      const dateCmp = b.latestDate.localeCompare(a.latestDate);
      if (dateCmp !== 0) return dateCmp;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    return items;
  }

  getNotebook(id: string): NotebookListItem & { notes: NoteListItem[]; unknownKeys: string[] } {
    const dir = this.resolveNotebookDir(id);
    const { meta, error } = this.readNotebookMeta(dir);
    const notes = this.readNotes(dir);
    return {
      id,
      name: String(meta["name"] ?? id),
      fields: meta,
      noteCount: notes.length,
      latestDate: notes.reduce((max, n) => (dateValue(n.date) > max ? dateValue(n.date) : max), ""),
      notes,
      unknownKeys: Object.keys(meta).filter((k) => !notebookFieldDef.some((f) => f.key === k)),
      error,
    };
  }

  /** 新建笔记本：创建子目录 + _index.json（新建不备份） */
  createNotebook(input: { data: Record<string, unknown> }): { id: string } {
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    applyDefaults({ fields: notebookFieldDef }, values, true);
    validateFields({ fields: notebookFieldDef }, values, true);
    const id = safeName(String(values["name"] ?? ""), "notebook");
    const dir = path.join(this.root, id);
    if (fs.existsSync(dir)) throw badRequest(`笔记本「${id}」已存在，请换一个名称`);

    const meta: Record<string, unknown> = { name: String(values["name"]) };
    for (const field of notebookFieldDef) {
      if (field.key === "name") continue;
      const v = values[field.key];
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      meta[field.key] = v;
    }
    ensureDir(dir);
    writeJsonFile(path.join(dir, "_index.json"), meta);
    return { id };
  }

  /** 更新笔记本元信息：合并未知字段，空值删除，备份后原子写回 */
  updateNotebook(id: string, input: { data: Record<string, unknown> }): void {
    const dir = this.resolveNotebookDir(id);
    const indexFile = path.join(dir, "_index.json");
    if (!fs.existsSync(indexFile)) throw badRequest("笔记本缺少 _index.json，无法更新");
    let current: Record<string, unknown>;
    try {
      const raw = readJsonFile<unknown>(indexFile);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
      current = raw as Record<string, unknown>;
    } catch {
      throw badRequest("_index.json JSON 语法错误，拒绝写入");
    }
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    applyDefaults({ fields: notebookFieldDef }, values, false);
    validateFields({ fields: notebookFieldDef }, values, false);

    for (const field of notebookFieldDef) {
      if (!(field.key in values)) continue;
      const v = values[field.key];
      if (v === undefined) continue;
      if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete current[field.key];
      else current[field.key] = v;
    }
    if (typeof current["name"] !== "string" || current["name"] === "") current["name"] = id;

    backupFile(indexFile, this.backupRoot, `${id}/_index.json`);
    writeJsonFile(indexFile, current);
  }

  deleteNotebook(id: string): void {
    const dir = this.resolveNotebookDir(id);
    backupDir(dir, this.backupRoot);
    removeDir(dir);
  }

  restoreNotebook(backupName: string): void {
    const m = /^(.+?)_\d{8}-\d{6}\.bak$/.exec(backupName);
    if (!m) throw badRequest("备份名称格式非法（目录快照形如 笔记本名_时间戳.bak）");
    const destDir = path.join(this.root, m[1]);
    restoreDirBackup(this.backupRoot, backupName, destDir);
  }

  backupNow(): string[] {
    const names: string[] = [];
    for (const d of listDirs(this.root)) names.push(backupDir(path.join(this.root, d), this.backupRoot));
    return names;
  }

  // ─────────────── 笔记：目录下 md ───────────────

  getNote(notebookId: string, noteId: string): ContentDetail {
    const file = this.resolveNoteFile(notebookId, noteId);
    const source = readText(file) ?? "";
    const parsed = this.parseNote(source);
    return {
      id: noteId,
      filename: noteId,
      fields: parsed.fields,
      body: parsed.body,
      hasFrontmatter: parsed.hasFrontmatter,
      unknownKeys: parsed.unknownKeys,
      error: parsed.error,
    };
  }

  createNote(notebookId: string, input: { data: Record<string, unknown>; body?: string }): { id: string; filename: string } {
    const dir = this.resolveNotebookDir(notebookId);
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    applyDefaults({ fields: noteFieldDef }, values, true);
    validateFields({ fields: noteFieldDef }, values, true);

    const base = safeName(String(values["title"] ?? "note"), "note");
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
    writeTextAtomic(path.join(dir, name), `---${nl}${fm}---${nl}${body === "" ? "" : nl + body}`);
    return { id: name, filename: name };
  }

  /** 更新笔记：只写提交字段；空串删除已有字段；未知字段保留 */
  updateNote(notebookId: string, noteId: string, input: { data: Record<string, unknown>; body?: string }): void {
    const file = this.resolveNoteFile(notebookId, noteId);
    const source = readText(file) ?? "";
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    validateFields({ fields: noteFieldDef }, values, false);

    const { frontmatter, body: oldBody } = splitFrontmatter(source);
    if (frontmatter === null) throw badRequest("笔记缺少 YAML frontmatter，无法更新");
    const old = analyzeFrontmatter(frontmatter);
    const oldKeys = new Set(old.fields.map((f) => f.key));

    const changes: ChangeOp[] = [];
    for (const field of noteFieldDef) {
      const v = values[field.key];
      if (v === undefined) continue;
      if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
        if (oldKeys.has(field.key)) changes.push({ key: field.key, remove: true });
        continue;
      }
      changes.push({ key: field.key, value: v, quote: "auto" });
    }
    const newFm = writeFrontmatter(frontmatter, changes, noteYamlFormat);
    const newBody = typeof input.body === "string" ? input.body : oldBody;
    const output = joinFrontmatter(newFm, newBody, true);
    if (output === source) return;

    backupFile(file, this.backupRoot, `${notebookId}/${noteId}`);
    writeTextAtomic(file, output);
  }

  deleteNote(notebookId: string, noteId: string): void {
    const file = this.resolveNoteFile(notebookId, noteId);
    backupFile(file, this.backupRoot, `${notebookId}/${noteId}`);
    removeFile(file);
  }

  restoreNote(notebookId: string, backupName: string): void {
    const origin = backupOrigin(backupName);
    if (!origin) throw badRequest("备份名称格式非法");
    const relative = decodeBackupOrigin(origin);
    const parts = relative.split("/");
    const fileName = parts[parts.length - 1];
    if (!fileName.endsWith(".md")) throw badRequest("备份内容不是笔记文件");
    const dir = this.resolveNotebookDir(notebookId);
    restoreFileBackup(this.backupRoot, backupName, path.join(dir, path.basename(fileName)));
  }

  backups(): BackupInfo[] {
    return listBackups(this.backupRoot);
  }

  deleteBackup(backupName: string): void {
    deleteBackup(this.backupRoot, backupName);
  }

  private detectDirNewline(dir: string): string {
    for (const f of listFiles(dir, ".md")) {
      const raw = readText(path.join(dir, f));
      if (raw !== null && raw.includes("\r\n")) return "\r\n";
    }
    return "\n";
  }
}
