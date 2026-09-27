/**
 * 文件系统安全工具
 * 所有用户可控的文件名 / 目录名必须经过本工具校验，防止路径穿越
 */
import fs from "node:fs";
import path from "node:path";
import { badRequest } from "./errors.js";

/** 非法文件名保留字符（Windows / POSIX 通用） */
const ILLEGAL_FILENAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 校验 name 是否为安全文件名（不含路径分隔符与 `..`），返回清理后的文件名 */
export function safeName(name: string, fallback = "unnamed"): string {
  if (typeof name !== "string" || name.trim() === "") {
    return fallback;
  }
  const cleaned = name.trim().replace(ILLEGAL_FILENAME, "-").replace(/\.\./g, "").slice(0, 120);
  return cleaned === "" ? fallback : cleaned;
}

/** 校验用户传入的路径片段只能命中 base 目录内部，返回绝对路径；非法则抛 400 */
export function resolveInside(base: string, relative: string, what = "路径"): string {
  if (typeof relative !== "string" || relative === "" || relative.includes("..") || path.isAbsolute(relative)) {
    throw badRequest(`${what} 非法`);
  }
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw badRequest(`${what} 越界`);
  }
  return target;
}

/** 确保目录存在（递归创建） */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** 读取文本文件，不存在返回 null */
export function readText(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

/** 原子写文本文件：先写临时文件再 rename，避免写坏业务文件 */
export function writeTextAtomic(file: string, content: string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

/** 递归复制目录 */
export function copyDir(src: string, dest: string): void {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

/** 删除目录（含内容） */
export function removeDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 删除文件 */
export function removeFile(file: string): void {
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
  }
}

/** 列出目录下直接子目录名（升序） */
export function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** 列出目录下直接文件（可过滤扩展名），返回文件名 */
export function listFiles(dir: string, ext?: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && (ext === undefined || e.name.endsWith(ext)))
    .map((e) => e.name)
    .sort();
}
