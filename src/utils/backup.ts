/**
 * 备份与恢复工具（docs/后端新增Demo/00_公共通用规则.md 第 4 节）
 * - 统一归档：admin/backup/content/{模块名}/
 * - 新建不备份；更新 / 删除自动备份；最多保留最新 5 份
 * - 文件备份命名：原文件名_时间戳.bak.md；目录备份：目录名_时间戳.bak/
 * - 恢复：名称严格限定在备份目录内（防路径穿越），还原覆盖源路径
 */
import fs from "node:fs";
import path from "node:path";
import { notFound } from "./errors.js";
import { copyDir, ensureDir, removeDir, removeFile, resolveInside } from "./fsx.js";

export const BACKUP_KEEP = 5;

export interface BackupInfo {
  name: string;
  type: "file" | "dir";
  /** 原始文件名（不含 .bak 后缀）或目录名 */
  origin: string;
  time: string;
  size: number;
  isDirSnapshot: boolean;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 生成备份文件名：xxx_20260806-101530.bak.md */
export function backupFileName(original: string, isDir = false): string {
  const base = original.replace(/\.bak(\.\w+)?$/i, "");
  return isDir ? `${base}_${timestamp()}.bak` : `${base}_${timestamp()}.bak.md`;
}

/** 滚动清理：目录内仅保留最新 N 份同名备份 */
function prune(backupDir: string, keep = BACKUP_KEEP): void {
  if (!fs.existsSync(backupDir)) return;
  const entries = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .map((e) => ({ name: e.name, isDir: e.isDirectory(), time: fs.statSync(path.join(backupDir, e.name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const e of entries.slice(keep)) {
    const full = path.join(backupDir, e.name);
    if (e.isDir) removeDir(full);
    else removeFile(full);
  }
}

/** 备份单个文件 → {模块备份目录}/xxx_时间戳.bak.md；返回备份文件名 */
export function backupFile(srcFile: string, backupDir: string): string {
  ensureDir(backupDir);
  const name = backupFileName(path.basename(srcFile));
  fs.copyFileSync(srcFile, path.join(backupDir, name));
  prune(backupDir);
  return name;
}

/** 备份整个目录快照 → {模块备份目录}/{目录名}_时间戳.bak/；返回备份名 */
export function backupDir(srcDir: string, backupDir: string): string {
  ensureDir(backupDir);
  const name = backupFileName(path.basename(srcDir), true);
  copyDir(srcDir, path.join(backupDir, name));
  prune(backupDir);
  return name;
}

/** 列出模块备份（按时间倒序） */
export function listBackups(backupDir: string): BackupInfo[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir, { withFileTypes: true })
    .map((e) => {
      const full = path.join(backupDir, e.name);
      const stat = fs.statSync(full);
      return {
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
        origin: e.name.replace(/_20\d{6}-\d{6}\.bak(\.\w+)?$/i, ""),
        time: new Date(stat.mtimeMs).toISOString().replace("T", " ").slice(0, 19),
        size: e.isDirectory() ? dirSize(full) : stat.size,
        isDirSnapshot: e.isDirectory(),
      } satisfies BackupInfo;
    })
    .sort((a, b) => (a.time < b.time ? 1 : -1));
}

function dirSize(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

/** 校验备份名并返回备份目录内绝对路径 */
function resolveBackup(backupDir: string, name: string): string {
  return resolveInside(backupDir, name, "备份名称");
}

/** 恢复文件备份到目标路径（覆盖） */
export function restoreFileBackup(backupDir: string, name: string, destFile: string): void {
  const backup = resolveBackup(backupDir, name);
  if (!fs.existsSync(backup) || !fs.statSync(backup).isFile()) {
    throw notFound("备份文件不存在");
  }
  ensureDir(path.dirname(destFile));
  fs.copyFileSync(backup, destFile);
}

/** 恢复目录备份到目标目录（先移除现有，再整体还原） */
export function restoreDirBackup(backupDir: string, name: string, destDir: string): void {
  const backup = resolveBackup(backupDir, name);
  if (!fs.existsSync(backup) || !fs.statSync(backup).isDirectory()) {
    throw notFound("备份目录不存在");
  }
  removeDir(destDir);
  copyDir(backup, destDir);
}
