/**
 * 通用多文件 md 模块 service（isSingleFile=false / =true 均适用）
 * 提供 list / get / create / update / delete / restore / backups + 分组元数据管理
 *
 * 分组模式（groupMeta）：条目位于一级分类目录中（如 friend/大佬/xxx.md），
 * 分类目录下的 _index.json 保存分组标题、图标、排序等元数据。
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
import {
  ensureDir,
  listDirs,
  listFiles,
  listFilesRecursive,
  readText,
  removeDir,
  removeFile,
  resolveInside,
  safeName,
  writeTextAtomic,
} from "../../utils/fsx.js";
import { CONTENT_ROOT, BACKUP_CONTENT_ROOT } from "../../config/paths.js";
import type {
  ContentDetail,
  ContentGroup,
  ContentListItem,
  ContentModuleDef,
} from "../../types/content.js";
import {
  analyzeFrontmatter,
  buildFrontmatterTemplate,
  isAmbiguousYamlString,
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
  /** 分组目录名（仅分组模块有效） */
  group?: string;
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
  /** 删除指定备份（文件备份 / 目录快照） */
  deleteBackup(backupName: string): void;
  /** 手动创建整模块备份（目录快照），返回备份名 */
  backupNow(): string;
  /** 分组列表（非分组模块返回空数组） */
  listGroups(): ContentGroup[];
  createGroup(input: ContentSaveInput): { id: string };
  updateGroup(id: string, input: ContentSaveInput): void;
  deleteGroup(id: string): void;
}

/** 检测文本换行风格 */
function detectNewline(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** 数值比较：非数字按 0 */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 通用值比较：日期/数字优先按真实大小，其余按本地化字符串 */
function compareValues(a: unknown, b: unknown): number {
  const as = String(a ?? "");
  const bs = String(b ?? "");
  if (as === bs) return 0;
  const ad = /^\d{4}-\d{2}-\d{2}/.test(as) ? Date.parse(as.replace(" ", "T")) : NaN;
  const bd = /^\d{4}-\d{2}-\d{2}/.test(bs) ? Date.parse(bs.replace(" ", "T")) : NaN;
  if (!Number.isNaN(ad) && !Number.isNaN(bd)) return ad - bd;
  const an = /^[-+]?\d+$/.test(as) ? Number(as) : NaN;
  const bn = /^[-+]?\d+$/.test(bs) ? Number(bs) : NaN;
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return as.localeCompare(bs, "zh-CN");
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

  private get ext(): string {
    return this.meta.ext ?? ".md";
  }

  /** 用户传入的条目 id → 源文件绝对路径（分组模块允许一级目录） */
  private resolveFile(id: string): string {
    if (typeof id !== "string" || id.trim() === "") throw badRequest("文件名非法");
    const normalized = id.replace(/\\/g, "/");
    const segments = normalized.split("/");
    // 仅允许「文件名」或「一级分组/文件名」（分组由文件夹结构决定）
    if (normalized.includes("..") || normalized.startsWith("/") || segments.length > 2) {
      throw badRequest("文件名非法");
    }
    const file = resolveInside(this.root, normalized, "文件名");
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

  /** 条目 id 中的分组名（根目录条目为空字符串） */
  private groupOf(id: string): string {
    const normalized = id.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    return idx >= 0 ? normalized.slice(0, idx) : "";
  }

  // ───────────────────────────── 分组元数据 ─────────────────────────────

  private get groupFileName(): string {
    return this.meta.groupMeta?.fileName ?? "_index.json";
  }

  private groupDir(id: string): string {
    if (!this.meta.groupMeta) throw badRequest(`${this.meta.name}不支持分组`);
    if (typeof id !== "string" || id.trim() === "" || id.includes("/") || id.includes("\\")) {
      throw badRequest("分组名非法");
    }
    const dir = resolveInside(this.root, id, "分组名");
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw notFound("分组不存在");
    return dir;
  }

  /** 读取分组元数据；JSON 非法时返回空对象 */
  private readGroupMeta(dir: string): Record<string, unknown> {
    const file = path.join(dir, this.groupFileName);
    const raw = readText(file);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private groupTitle(id: string, meta: Record<string, unknown>): string {
    const def = this.meta.groupMeta;
    const value = def ? meta[def.titleField] : undefined;
    return typeof value === "string" && value.trim() !== "" ? value : id;
  }

  listGroups(): ContentGroup[] {
    const def = this.meta.groupMeta;
    if (!def) return [];
    const groups = listDirs(this.root).map((id) => {
      const dir = path.join(this.root, id);
      const fields = this.readGroupMeta(dir);
      const itemCount = listFilesRecursive(dir, this.ext).filter((f) => f !== this.groupFileName).length;
      return { id, name: this.groupTitle(id, fields), fields, itemCount };
    });
    groups.sort((a, b) => {
      const cmp = compareValues(a.fields[def.sortField] ?? 0, b.fields[def.sortField] ?? 0);
      const dir = def.sortOrder === "asc" ? cmp : -cmp;
      return dir !== 0 ? dir : a.id.localeCompare(b.id, "zh-CN");
    });
    return groups;
  }

  /** 分组 JSON 的缩进风格（沿用原文件） */
  private jsonIndent(raw: string | null): number {
    if (!raw) return 2;
    const m = /\n( +)"/.exec(raw);
    return m ? Math.min(m[1].length, 8) : 2;
  }

  private writeGroupMeta(dir: string, data: Record<string, unknown>): void {
    const file = path.join(dir, this.groupFileName);
    const old = readText(file);
    const indent = this.jsonIndent(old);
    if (old !== null) {
      backupFile(file, this.backupRoot, `${path.basename(dir)}/${this.groupFileName}`);
    }
    writeTextAtomic(file, JSON.stringify(data, null, indent) + "\n");
  }

  createGroup(input: ContentSaveInput): { id: string } {
    const def = this.meta.groupMeta;
    if (!def) throw badRequest(`${this.meta.name}不支持分组`);
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    const id = safeName(String(values["name"] ?? ""), "");
    if (!id) throw badRequest("分组名称不能为空");
    const dir = path.join(this.root, id);
    if (fs.existsSync(dir)) throw badRequest("同名分组已存在");

    applyDefaults({ fields: def.fields }, values, true);
    values["name"] = id;
    validateFields({ fields: def.fields }, values, true);
    // 只保留已定义字段，避免把 UI 辅助字段写入 JSON
    const data: Record<string, unknown> = {};
    for (const field of def.fields) {
      const value = values[field.key];
      if (value === undefined || value === null || value === "") continue;
      data[field.key] = value;
    }
    data["name"] = id;
    ensureDir(dir);
    this.writeGroupMeta(dir, data);
    return { id };
  }

  updateGroup(id: string, input: ContentSaveInput): void {
    const def = this.meta.groupMeta;
    if (!def) throw badRequest(`${this.meta.name}不支持分组`);
    const dir = this.groupDir(id);
    const file = path.join(dir, this.groupFileName);
    const oldRaw = readText(file);
    let current: Record<string, unknown> = {};
    if (oldRaw !== null) {
      try {
        current = JSON.parse(oldRaw) as Record<string, unknown>;
      } catch {
        throw badRequest(`${this.groupFileName} JSON 语法错误，拒绝写入`);
      }
    }
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    applyDefaults({ fields: def.fields }, values, false);
    validateFields({ fields: def.fields }, values, false);
    // 与 md 更新语义一致：提交空字符串表示删除该可选字段
    for (const field of def.fields) {
      if (!(field.key in values)) continue;
      const value = values[field.key];
      if (value === undefined) continue;
      if (value === null || value === "") delete current[field.key];
      else current[field.key] = value;
    }
    if (typeof current["name"] !== "string" || current["name"] === "") current["name"] = id;
    this.writeGroupMeta(dir, current);
  }

  deleteGroup(id: string): void {
    const dir = this.groupDir(id);
    const remaining = listFilesRecursive(dir, this.ext).filter((f) => !f.endsWith(path.basename(this.groupFileName)));
    if (remaining.length > 0) throw badRequest("分组内仍有内容，无法删除");
    const metaFile = path.join(dir, this.groupFileName);
    if (fs.existsSync(metaFile)) backupFile(metaFile, this.backupRoot, `${id}/${this.groupFileName}`);
    removeDir(dir);
  }

  // ───────────────────────────── 条目 CRUD ─────────────────────────────

  list(): ContentListItem[] {
    let files: string[];
    if (this.meta.isSingleFile) {
      // 单文件模块只列出模块自身的文件，避免同目录下其他单文件被误当作条目
      const name = this.meta.fileName ? this.meta.fileName({}) : "";
      files = name && fs.existsSync(path.join(this.root, name)) ? [name] : [];
    } else {
      files = (this.meta.groupMeta ? listFilesRecursive(this.root, this.ext) : listFiles(this.root, this.ext)).filter(
        (f) => !/\.(bak|tmp)$/i.test(f),
      );
    }
    const items = files.map((f) => {
      const raw = readText(path.join(this.root, f)) ?? "";
      const parsed = this.parseEntry(raw);
      const item: ContentListItem = {
        id: f,
        filename: path.basename(f),
        title: String(parsed.fields[this.meta.titleField] ?? path.basename(f, this.ext)),
        fields: parsed.fields,
        error: parsed.error,
      };
      if (this.meta.groupMeta) item.group = this.groupOf(f);
      return item;
    });

    if (this.meta.sortItems) return this.meta.sortItems(items);
    if (!this.meta.sortOrder && !this.meta.groupMeta) return items;

    if (this.meta.groupMeta) {
      const groupOrder = new Map(this.listGroups().map((g, i) => [g.id, i]));
      items.sort((a, b) => {
        const ga = a.group ?? "";
        const gb = b.group ?? "";
        const ra = groupOrder.get(ga) ?? Number.MAX_SAFE_INTEGER;
        const rb = groupOrder.get(gb) ?? Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return this.meta.compareItems ? this.meta.compareItems(a, b) : this.compareBySort(a, b);
      });
      return items;
    }

    items.sort((a, b) => this.compareBySort(a, b));
    return items;
  }

  /** 通用排序：order（方向可配）+ sortKeys */
  private compareBySort(a: ContentListItem, b: ContentListItem): number {
    const orderDir = this.meta.orderDirection === "asc" ? 1 : -1;
    const ao = num(a.fields["order"]);
    const bo = num(b.fields["order"]);
    if (ao !== bo) return (ao - bo) * orderDir;
    const keys = this.meta.sortKeys?.length ? this.meta.sortKeys : ["filename"];
    const dir = this.meta.sortOrder === "asc" ? 1 : -1;
    for (const key of keys) {
      const av = key === "filename" ? a.filename : a.fields[key];
      const bv = key === "filename" ? b.filename : b.fields[key];
      const cmp = compareValues(av, bv);
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  }

  get(id: string): ContentDetail {
    const { source } = this.readAll(id);
    if (this.meta.noFrontmatter) {
      return {
        id,
        filename: path.basename(id),
        group: this.meta.groupMeta ? this.groupOf(id) : undefined,
        fields: {},
        body: source,
        hasFrontmatter: false,
        unknownKeys: [],
      };
    }
    const parsed = this.parseEntry(source);
    return {
      id,
      filename: path.basename(id),
      group: this.meta.groupMeta ? this.groupOf(id) : undefined,
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
      return {
        fields: {},
        body,
        hasFrontmatter: false,
        unknownKeys: [],
        error: this.meta.noFrontmatter ? undefined : "缺少 YAML frontmatter 头部",
      };
    }
    const parsed = analyzeFrontmatter(frontmatter);
    if (parsed.errors.length > 0) {
      return { fields: {}, body, hasFrontmatter: true, unknownKeys: [], error: `YAML 语法错误：${parsed.errors[0]}` };
    }
    const fields: Record<string, unknown> = {};
    for (const f of parsed.fields) fields[f.key] = f.value;
    return { fields, body, hasFrontmatter: true, unknownKeys: parsed.unknownKeys };
  }

  /** 生成不冲突的文件名（可指定分组目录） */
  private genFileName(values: Record<string, unknown>, group = ""): string {
    const base = this.meta.fileName
      ? this.meta.fileName(values)
      : safeName(String(values[this.meta.titleField] ?? "untitled"));
    const dir = group ? path.join(this.root, group) : this.root;
    const exist = new Set(listFiles(dir, this.ext));
    let name = `${base}${this.ext}`;
    let i = 2;
    while (exist.has(name)) {
      name = `${base}-${i}${this.ext}`;
      i += 1;
    }
    return group ? `${group}/${name}` : name;
  }

  create(input: ContentSaveInput): { id: string; filename: string } {
    if (this.meta.isSingleFile) throw badRequest(`${this.meta.name}为单文件模块，不支持新建`);
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    applyDefaults(this.meta, values, true);
    const { remove } = this.meta.normalize ? this.meta.normalize(values, true) : { remove: [] as string[] };
    for (const key of remove) delete values[key];
    validateFields(this.meta, values, true);

    let group = "";
    if (this.meta.groupMeta) {
      group = safeName(String(input.group ?? ""), "");
      if (group.includes("/") || group.includes("\\")) throw badRequest("分组名非法");
      if (group !== "" && !fs.existsSync(path.join(this.root, group))) throw badRequest("分组不存在");
    }

    const id = this.genFileName(values, group);
    const filename = path.basename(id);
    const nl = this.detectDirNewline();
    const dateKeys = new Set(this.meta.fields.filter((f) => f.type === "date").map((f) => f.key));
    const fm = buildFrontmatterTemplate(values, nl, dateKeys, this.meta.yamlFormat);
    const body = typeof input.body === "string" ? input.body : "";
    const content = this.meta.noFrontmatter ? body : `---${nl}${fm}---${nl}${body === "" ? "" : nl + body}`;
    ensureDir(path.dirname(path.join(this.root, id)));
    writeTextAtomic(path.join(this.root, id), content);
    return { id, filename };
  }

  update(id: string, input: ContentSaveInput): void {
    const { file, source } = this.readAll(id);
    const values: Record<string, unknown> = { ...(input.data ?? {}) };
    applyDefaults(this.meta, values, false);
    const { remove } = this.meta.normalize ? this.meta.normalize(values, false) : { remove: [] as string[] };

    if (this.meta.noFrontmatter) {
      // 无 frontmatter 文件（about 等）：原样覆盖正文（不能误删内容中的 --- 分隔线）
      const body = typeof input.body === "string" ? input.body : "";
      backupFile(file, this.backupRoot, id);
      writeTextAtomic(file, body);
      return;
    }

    validateFields(this.meta, values, false);

    const { frontmatter } = splitFrontmatter(source);
    if (frontmatter === null) {
      throw badRequest("文件缺少 YAML frontmatter，无法更新；请先检查文件格式");
    }
    const old = analyzeFrontmatter(frontmatter);
    const oldKeys = new Set(old.fields.map((f) => f.key));

    // 组装写回变更：空值表示删除已有字段（清除），未提交的字段保持原样
    const changes: ChangeOp[] = [];
    for (const field of this.meta.fields) {
      const v = values[field.key];
      if (v === undefined) continue;
      const isEmpty = v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (isEmpty) {
        if (oldKeys.has(field.key)) changes.push({ key: field.key, remove: true });
        continue;
      }
      const quote =
        field.type === "date"
          ? "auto"
          : typeof v === "string" && isAmbiguousYamlString(v)
            ? "double"
            : "auto";
      changes.push({ key: field.key, value: v, quote });
    }
    for (const key of remove) {
      if (oldKeys.has(key)) changes.push({ key, remove: true });
    }

    const newFm = writeFrontmatter(frontmatter, changes, this.meta.yamlFormat);
    const newBody = typeof input.body === "string" ? input.body : splitFrontmatter(source).body;
    const output = joinFrontmatter(newFm, newBody, true);
    if (output === source) return;

    backupFile(file, this.backupRoot, id);
    writeTextAtomic(file, output);
  }

  delete(id: string): void {
    if (this.meta.isSingleFile) {
      throw badRequest(`${this.meta.name}为单文件模块，禁止删除（文件丢失时可通过备份恢复重建）`);
    }
    const { file } = this.readAll(id);
    backupFile(file, this.backupRoot, this.meta.groupMeta ? id : path.basename(id));
    removeFile(file);
  }

  restore(backupName: string): void {
    const dest = this.meta.fileName ? path.join(this.root, this.meta.fileName({})) : undefined;
    if (this.meta.isSingleFile && dest) {
      restoreFileBackup(this.backupRoot, backupName, dest);
      return;
    }
    // 整模块目录快照备份（xxx_20260806-101530.bak）：整体还原模块目录
    if (/\.bak$/i.test(backupName) && !/\.bak\.\w+$/i.test(backupName)) {
      restoreDirBackup(this.backupRoot, backupName, this.root);
      return;
    }
    const origin = backupOrigin(backupName);
    if (!origin) throw badRequest("备份名称格式非法");
    const relative = this.meta.groupMeta ? decodeBackupOrigin(origin) : origin;
    const destFile = resolveInside(this.root, relative, "备份路径");
    restoreFileBackup(this.backupRoot, backupName, destFile);
  }

  /** 手动创建整模块目录快照备份 */
  backupNow(): string {
    if (!fs.existsSync(this.root)) throw badRequest(`${this.meta.name}目录不存在，无法备份`);
    return backupDir(this.root, this.backupRoot);
  }

  backups(): BackupInfo[] {
    return listBackups(this.backupRoot);
  }

  deleteBackup(backupName: string): void {
    deleteBackup(this.backupRoot, backupName);
  }

  /** 目录现有文件换行风格（新文件跟随） */
  private detectDirNewline(): string {
    const files = this.meta.groupMeta ? listFilesRecursive(this.root, this.ext) : listFiles(this.root, this.ext);
    for (const f of files) {
      const raw = readText(path.join(this.root, f));
      if (raw !== null && raw.includes("\r\n")) return "\r\n";
    }
    return "\n";
  }
}

export { detectNewline };
