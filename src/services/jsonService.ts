/**
 * JSON 文件读写（docs/后端新增Demo/00_公共通用规则.md 第 3.3 节）
 * notebooks/_index.json：严格 JSON 标准，全部双引号，强制语法校验
 */
import { badRequest } from "../utils/errors.js";
import { readText, writeTextAtomic } from "../utils/fsx.js";

/** 读取并解析 JSON；语法错误抛 400 */
export function readJsonFile<T>(file: string): T {
  const raw = readText(file);
  if (raw === null) {
    throw badRequest("JSON 文件不存在");
  }
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw badRequest(`JSON 语法错误，无法解析：${(e as Error).message}`);
  }
}

/** 校验并写回 JSON（2 空格缩进 + 尾换行，符合 _index.json 示例风格） */
export function writeJsonFile(file: string, data: unknown): void {
  let text: string;
  try {
    text = JSON.stringify(data, null, 2) + "\n";
  } catch (e) {
    throw badRequest(`数据无法序列化为 JSON：${(e as Error).message}`);
  }
  writeTextAtomic(file, text);
}
