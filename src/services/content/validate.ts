/**
 * 通用字段校验（按 ContentModuleDef.fields 定义执行）
 * 对应 docs/后端新增Demo/00_公共通用规则.md 第 5 节
 */
import type { ContentModuleDef } from "../../types/content.js";
import { badRequest } from "../../utils/errors.js";
import {
  assertBoolean,
  assertDate,
  assertEnum,
  assertNumber,
  assertPositiveInt,
  assertRequiredString,
  assertStringArray,
  assertTime,
  assertUrl,
} from "../../utils/validators.js";

/** 校验表单提交的字段值；校验失败抛 400 */
export function validateFields(def: Pick<ContentModuleDef, "fields">, values: Record<string, unknown>, isNew: boolean): void {
  for (const field of def.fields) {
    if (field.hidden && field.fixed !== undefined) continue; // 固定字段由 normalize 注入
    const v = values[field.key];
    const required = field.required === true;
    const empty = v === undefined || v === null || v === "";
    if (required && empty) {
      // 更新模式：未传入的必填字段视为「保持原值」，不校验；显式传空值才报错
      if (!isNew && v === undefined) continue;
      throw badRequest(`「${field.label}」不能为空`);
    }
    if (empty) continue;
    switch (field.type) {
      case "string":
        if (typeof v !== "string") throw badRequest(`「${field.label}」必须为字符串`);
        break;
      case "number":
        assertNumber(v, `「${field.label}」`);
        break;
      case "positiveInt":
        assertPositiveInt(v, `「${field.label}」`);
        break;
      case "boolean":
        assertBoolean(v, `「${field.label}」`);
        break;
      case "date":
        assertDate(v, `「${field.label}」`);
        break;
      case "time":
        assertTime(v, `「${field.label}」`);
        break;
      case "url":
        assertUrl(v, `「${field.label}」`);
        break;
      case "stringArray":
        assertStringArray(v, `「${field.label}」`);
        break;
      case "urlArray":
        assertStringArray(v, `「${field.label}」`, (item) => assertUrl(item, `「${field.label}」数组项`));
        break;
      case "numberEnum":
        if (field.enum) {
          assertEnum(v, field.enum.map((e) => e.value), `「${field.label}」`);
        }
        break;
      default: {
        // string 枚举（subcategory/type 等用 string + enum 表达）
        if (field.enum) {
          assertEnum(v, field.enum.map((e) => e.value), `「${field.label}」`);
        }
      }
    }
  }
  void isNew;
}

/** 注入默认值 / 固定值 */
export function applyDefaults(def: Pick<ContentModuleDef, "fields">, values: Record<string, unknown>, isNew: boolean): void {
  for (const field of def.fields) {
    if (field.fixed !== undefined) {
      values[field.key] = field.fixed;
      continue;
    }
    if (isNew && field.defaultValue !== undefined && (values[field.key] === undefined || values[field.key] === "")) {
      values[field.key] = field.defaultValue;
    }
  }
  // 必填字符串默认空串占位（表单缺失时补默认值由前端控制）
  void isNew;
}
