/**
 * 配置模块统一服务（docs/后端设置Demo/00_公共通用规则.md API 约定）
 * GET：返回 { fields:[{keyPath,value,hasQuote,isMedia}], skipped:[{keyPath,reason}] }
 * POST：按 keyPath 写回；虚拟 keyPath `__raw_html` 走附属 html 文件读写
 */
import {
  applyConfigChanges,
  parseConfigTarget,
  readHtmlAttachment,
  writeHtmlAttachment,
  type ConfigChange,
  type TsFieldEntry,
} from "./tsAstService.js";
import { configTargets, getConfigTarget } from "./config/targets.js";
import { badRequest } from "../utils/errors.js";

/** 单个 target 完整读取结果 */
export interface ConfigTargetRead {
  targetId: string;
  name: string;
  fields: TsFieldEntry[];
  skipped: Array<{ keyPath: string; reason: string }>;
  saveNote?: string;
}

/** 读取配置 target（含附属 html 虚拟字段） */
export function readConfigTarget(targetId: string): ConfigTargetRead {
  const def = getConfigTarget(targetId);
  const { fields, skipped } = parseConfigTarget(def);
  if (def.htmlFile) {
    // 附属文件：虚拟 keyPath __raw_html，value 为完整文本
    fields.unshift({ keyPath: "__raw_html", value: readHtmlAttachment(def), hasQuote: false, isMedia: false });
  }
  return { targetId: def.id, name: def.name, fields, skipped, saveNote: def.saveNote };
}

/** 保存配置 target：普通字段走 TS-AST 写回；__raw_html 直接覆盖附属文件 */
export function saveConfigTarget(targetId: string, changes: ConfigChange[]): { saved: number; note?: string } {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw badRequest("没有提交任何变更");
  }
  const def = getConfigTarget(targetId);
  let saved = 0;

  // 分离虚拟 keyPath 与 AST 字段
  const htmlChange = changes.find((c) => c.keyPath === "__raw_html");
  const astChanges = changes.filter((c) => c.keyPath !== "__raw_html");

  if (def.htmlFile && htmlChange) {
    if (typeof htmlChange.value !== "string") {
      throw badRequest("__raw_html 内容必须为字符串");
    }
    writeHtmlAttachment(def, htmlChange.value);
    saved += 1;
  } else if (htmlChange) {
    throw badRequest("该 target 不支持 __raw_html");
  }

  if (astChanges.length > 0) {
    saved += applyConfigChanges(def, astChanges).saved;
  }
  return { saved, note: def.saveNote };
}

/** 配置 target 清单（前端标签页，含分组） */
export function listConfigTargets(): Array<{ id: string; name: string; file: string; hasHtml: boolean; group?: string }> {
  return configTargets.map((t) => ({ id: t.id, name: t.name, file: t.file, hasHtml: Boolean(t.htmlFile), group: t.group }));
}
