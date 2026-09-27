/**
 * 路径常量定义
 * 所有业务路径均锚定 admin/ 目录，不依赖进程工作目录
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** admin 目录绝对路径（本文件位于 admin/src/config/） */
export const ADMIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 博客项目根目录（admin 的上一级） */
export const PROJECT_ROOT = path.resolve(ADMIN_ROOT, "..");

/** 内容业务源路径（md / json 文件） */
export const CONTENT_ROOT = path.join(PROJECT_ROOT, "src", "content");

/** 站点配置源路径（ts 配置文件与附属 html） */
export const CONFIG_ROOT = path.join(PROJECT_ROOT, "src", "config");

/** 备份统一归档根目录 */
export const BACKUP_ROOT = path.join(ADMIN_ROOT, "backup");

/** 内容模块备份根目录 */
export const BACKUP_CONTENT_ROOT = path.join(BACKUP_ROOT, "content");

/** 后台前端静态资源目录 */
export const PUBLIC_DIR = path.join(ADMIN_ROOT, "public");

/** admin/.env 环境变量文件 */
export const ENV_FILE_ADMIN = path.join(ADMIN_ROOT, ".env");

/** 项目根 .env（兼容读取 ADMIN_PASSWORD 约定，只读不写） */
export const ENV_FILE_PROJECT = path.join(PROJECT_ROOT, ".env");
