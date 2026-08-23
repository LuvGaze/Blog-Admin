/**
 * 通用字段校验规则（对应 docs/后端新增Demo/00_公共通用规则.md 第 5 节）
 * 各模块按需复用；校验失败抛出 badRequest（400）
 */
import { badRequest } from "./errors.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const URL_RE = /^https?:\/\/\S+$/i;

/** 校验 YYYY-MM-DD 日期（含真实日期合法性） */
export function assertDate(value: unknown, label: string): void {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw badRequest(`${label} 格式必须为 YYYY-MM-DD`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw badRequest(`${label} 不是合法日期`);
  }
}

/** 校验 HH:MM 时间 */
export function assertTime(value: unknown, label: string): void {
  if (typeof value !== "string" || !TIME_RE.test(value)) {
    throw badRequest(`${label} 格式必须为 HH:MM`);
  }
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) {
    throw badRequest(`${label} 不是合法时间`);
  }
}

/** 校验 http/https URL */
export function assertUrl(value: unknown, label: string, required = false): void {
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`${label} 不能为空`);
    return;
  }
  if (typeof value !== "string" || !URL_RE.test(value)) {
    throw badRequest(`${label} 必须为合法的 http:// 或 https:// 链接`);
  }
}

/** 校验布尔值（仅 true/false） */
export function assertBoolean(value: unknown, label: string): void {
  if (typeof value !== "boolean") {
    throw badRequest(`${label} 只允许布尔值 true/false`);
  }
}

/** 校验普通数字（可选小数） */
export function assertNumber(value: unknown, label: string, required = false): void {
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`${label} 不能为空`);
    return;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw badRequest(`${label} 必须为数字`);
  }
}

/** 校验正整数 */
export function assertPositiveInt(value: unknown, label: string, required = false): void {
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`${label} 不能为空`);
    return;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw badRequest(`${label} 必须为大于 0 的正整数`);
  }
}

/** 校验字符串必填 */
export function assertRequiredString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${label} 不能为空`);
  }
}

/** 校验枚举值 */
export function assertEnum<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  required = false,
): void {
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`${label} 不能为空`);
    return;
  }
  if (!allowed.includes(value as T)) {
    throw badRequest(`${label} 只允许值：${allowed.join(" / ")}`);
  }
}

/** 校验字符串数组：数组项不能为空字符串；可传入每项校验器 */
export function assertStringArray(value: unknown, label: string, itemValidator?: (item: string) => void): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    throw badRequest(`${label} 必须为数组`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      throw badRequest(`${label} 数组项不能为空字符串`);
    }
    itemValidator?.(item);
  }
}
