/**
 * TS 配置文件 AST 读写核心（docs/后端设置Demo/00_公共通用规则.md）
 * - 使用 TypeScript Compiler API 解析与修改源码，禁止正则硬解析
 * - 只处理字面量对象导出；函数 / interface / 常量引用 / 预设对象跳过（返回 skipped）
 * - 读：捕获 value + hasQuote（原始是否双引号）+ isMedia
 * - 写：仅替换值节点文本范围，保留缩进 / 注释 / 尾部逗号 / as const
 * - 数组：整体替换（字符串元素双引号，保持单行/多行风格）；对象数组元素属性 keyPath 形如 xxx[0].prop
 * - 写回前先用 TS 重新解析校验语法，失败则不落盘
 */
import ts from "typescript";
import path from "node:path";
import { badRequest } from "../utils/errors.js";
import { readText, writeTextAtomic } from "../utils/fsx.js";
import { CONFIG_ROOT } from "../config/paths.js";

/** GET 返回的单条字段结构 */
export interface TsFieldEntry {
  keyPath: string;
  value: unknown;
  hasQuote: boolean;
  isMedia: boolean;
}

/** 跳过字段（函数/枚举/预设等，UI 提示到源码修改） */
export interface SkippedEntry {
  keyPath: string;
  reason: string;
}

/** 配置 target 定义 */
export interface ConfigTargetDef {
  /** target 标识：site / sponsor / ... */
  id: string;
  /** 中文名（标签页） */
  name: string;
  /** 文件名（相对 src/config） */
  file: string;
  /** 需处理的导出名（pio 双导出） */
  exportNames: string[];
  /** 多导出：keyPath 需带导出名前缀（如 spineModelConfig.model.path） */
  multiExport?: boolean;
  /** 媒体预览 keyPath 清单（[*] 通配数组索引） */
  mediaPaths?: string[];
  /** 附属非 TS 资源文件（相对 src/config，如 FooterConfig.html） */
  htmlFile?: string;
  /** 固定跳过提示（如 navbar 的 LinkPresets） */
  fixedSkipped?: SkippedEntry[];
  /** 保存成功附加提示 */
  saveNote?: string;
  /** 侧边栏分组（如 基础/页面布局/内容与文章/互动功能/外观美化） */
  group?: string;
}

/** POST 提交的单条变更 */
export interface ConfigChange {
  keyPath: string;
  value: unknown;
  hasQuote?: boolean;
}

/** 解析结果 */
export interface ParsedTarget {
  fields: TsFieldEntry[];
  skipped: SkippedEntry[];
}

/** 属性名取文本 */
function propName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return name.getText();
}

/** 解包 as const / 一元负号 */
function unwrap(node: ts.Node): ts.Node {
  if (ts.isAsExpression(node)) return node.expression;
  if (ts.isParenthesizedExpression(node)) return node.expression;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return node;
  return node;
}

/** 标量字面量判定 */
function isScalar(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  );
}

/** 取标量值（支持 -1 形式） */
function scalarValue(node: ts.Node): unknown {
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return -Number((node.operand as ts.NumericLiteral).text);
  }
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  return undefined;
}

/** 递归求对象字面量值（数组整体字段用） */
function objectValue(node: ts.ObjectLiteralExpression): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const v = unwrap(prop.initializer);
    if (ts.isObjectLiteralExpression(v)) out[propName(prop.name)] = objectValue(v);
    else if (ts.isArrayLiteralExpression(v)) out[propName(prop.name)] = v.elements.map((el) => literalValue(unwrap(el)));
    else if (isScalar(v)) out[propName(prop.name)] = scalarValue(v);
    else out[propName(prop.name)] = undefined; // 常量引用等：占位
  }
  return out;
}

/** 数组元素值（元素为对象时递归） */
function literalValue(node: ts.Node): unknown {
  if (ts.isObjectLiteralExpression(node)) return objectValue(node);
  if (isScalar(node)) return scalarValue(node);
  return undefined;
}

/** 原始文本首字符是否双引号 */
function hasDoubleQuote(node: ts.Node): boolean {
  return node.getText().trimStart().startsWith('"');
}

/** 原始文本是否单引号字符串 */
function isSingleQuoted(node: ts.Node): boolean {
  return node.getText().trimStart().startsWith("'");
}

/** keyPath 是否命中媒体清单（[*] 通配数组索引） */
function isMediaPath(def: ConfigTargetDef, keyPath: string): boolean {
  if (!def.mediaPaths || def.mediaPaths.length === 0) return false;
  const normalized = keyPath.replace(/\[\d+\]/g, "[*]");
  return def.mediaPaths.includes(normalized);
}

/** 非字面量节点描述（skipped 原因） */
function describeNonLiteral(node: ts.Node): string {
  if (ts.isIdentifier(node)) return "常量引用，后台不修改";
  if (ts.isCallExpression(node)) return "函数调用生成对象，后台不修改";
  if (ts.isPropertyAccessExpression(node)) return "枚举/常量属性引用，后台不修改";
  if (ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) return "展开运算符，后台不修改";
  return "非字面量表达式，后台不修改";
}

/** 找 export const 声明的对象字面量 */
function findExportObject(sourceFile: ts.SourceFile, name: string): ts.ObjectLiteralExpression | null {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt) || !stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
        const init = unwrap(decl.initializer);
        return ts.isObjectLiteralExpression(init) ? init : null;
      }
    }
  }
  return null;
}

/** 解析单个配置文件 target */
export function parseConfigTarget(def: ConfigTargetDef): ParsedTarget {
  const file = path.join(CONFIG_ROOT, def.file);
  const source = readText(file);
  if (source === null) throw badRequest(`配置文件不存在：${def.file}`);
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fields: TsFieldEntry[] = [];
  const skipped: SkippedEntry[] = [...(def.fixedSkipped ?? [])];

  const walk = (obj: ts.ObjectLiteralExpression, prefix: string, sourceText: string): void => {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        const key = ts.isShorthandPropertyAssignment(prop) ? propName(prop.name) : "(?)";
        skipped.push({ keyPath: prefix ? `${prefix}.${key}` : key, reason: "非字面量属性，后台不修改" });
        continue;
      }
      const key = propName(prop.name);
      const full = prefix ? `${prefix}.${key}` : key;
      const init = unwrap(prop.initializer);
      if (ts.isObjectLiteralExpression(init)) {
        walk(init, full, sourceText);
      } else if (ts.isArrayLiteralExpression(init)) {
        const elements = init.elements.map((el) => unwrap(el));
        if (elements.length > 0 && elements.every((el) => isScalar(el) || (ts.isPrefixUnaryExpression(el) && ts.isNumericLiteral(el.operand)))) {
          // 纯标量数组：整体字段（字符串元素双引号写回）
          fields.push({ keyPath: full, value: elements.map((el) => scalarValue(el)), hasQuote: true, isMedia: isMediaPath(def, full) });
        } else if (elements.length > 0 && elements.every((el) => ts.isObjectLiteralExpression(el))) {
          // 对象数组：整体字段（增删拖拽）+ 元素属性字段（折叠编辑）
          fields.push({ keyPath: full, value: elements.map((el) => objectValue(el as ts.ObjectLiteralExpression)), hasQuote: true, isMedia: isMediaPath(def, full) });
          elements.forEach((el, i) => walk(el as ts.ObjectLiteralExpression, `${full}[${i}]`, sourceText));
        } else if (elements.length === 0) {
          fields.push({ keyPath: full, value: [], hasQuote: true, isMedia: isMediaPath(def, full) });
        } else {
          skipped.push({ keyPath: full, reason: "数组元素包含非常量表达式，后台不修改" });
        }
      } else if (isScalar(init)) {
        fields.push({
          keyPath: full,
          value: scalarValue(init),
          hasQuote: hasDoubleQuote(prop.initializer),
          isMedia: isMediaPath(def, full),
        });
      } else {
        skipped.push({ keyPath: full, reason: describeNonLiteral(prop.initializer) });
      }
    }
  };

  if (def.multiExport) {
    for (const name of def.exportNames) {
      const obj = findExportObject(sourceFile, name);
      if (obj) walk(obj, name, source);
      else skipped.push({ keyPath: name, reason: "导出未找到或非字面量对象" });
    }
  } else {
    for (const name of def.exportNames) {
      const obj = findExportObject(sourceFile, name);
      if (obj) walk(obj, "", source);
      else skipped.push({ keyPath: name, reason: "导出未找到或非字面量对象" });
    }
  }
  return { fields, skipped };
}

// ─────────────── 写回序列化 ───────────────

function escapeDouble(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function escapeSingle(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

/** 无引号裸写安全判定（标识符/URL/纯数字样式） */
const SAFE_BARE = /^[A-Za-z_$][A-Za-z0-9_$.@/?#&=+%~-]*$/;

/** 标量序列化：严格按 hasQuote + 原节点风格 */
function serializeScalar(value: unknown, hasQuote: boolean, originalNode: ts.Node): string {
  if (typeof value === "string") {
    if (hasQuote) return `"${escapeDouble(value)}"`;
    // 无引号：原单引号字符串保持单引号；否则仅允许安全裸写
    if (isSingleQuoted(originalNode)) return `'${escapeSingle(value)}'`;
    if (value === "" || !SAFE_BARE.test(value)) {
      throw badRequest("该字段原为无引号格式，新值含特殊字符无法安全写入，请保持原格式（或到源码修改）");
    }
    return value;
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value === null) return "null";
  throw badRequest("值类型不合法（仅支持字符串/数字/布尔/null）");
}

/** 提取数组缩进信息 */
function arrayIndent(originalText: string): { indent: string; closeIndent: string } {
  const lines = originalText.split("\n");
  if (lines.length <= 1) return { indent: "", closeIndent: "" };
  const first = lines[1].match(/^(\s*)/)?.[1] ?? "";
  const close = lines[lines.length - 1].match(/^(\s*)/)?.[1] ?? "";
  return { indent: first, closeIndent: close };
}

/** 对象值序列化（数组元素用；键安全则裸写，否则加引号） */
function serializeObjectValue(value: Record<string, unknown>, indent: string, multiLine: boolean): string {
  const keys = Object.keys(value);
  const inner = keys
    .map((k) => {
      const safeKey = SAFE_BARE.test(k) ? k : `"${escapeDouble(k)}"`;
      const v = value[k];
      const item = multiLine ? `${indent}${safeKey}: ${serializeArrayItem(v, indent)}` : `${safeKey}: ${serializeArrayItem(v, indent)}`;
      return item;
    })
    .join(multiLine ? ",\n" : ", ");
  if (!multiLine) return `{ ${inner} }`;
  return `{\n${inner}\n${indent.slice(0, Math.max(0, indent.length - 1))}}`;
}

/** 数组元素序列化（字符串双引号，数字/布尔/null 原样，对象递归） */
function serializeArrayItem(v: unknown, indent = ""): string {
  if (typeof v === "string") return `"${escapeDouble(v)}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "null";
  if (Array.isArray(v)) return serializeArray(v, "[]", indent);
  if (typeof v === "object") return serializeObjectValue(v as Record<string, unknown>, indent + "    ", true);
  return "null";
}

/** 数组整体序列化：保持原单行/多行风格 */
function serializeArray(value: unknown[], originalText: string, _indent = ""): string {
  const multiLine = originalText.includes("\n");
  const { indent, closeIndent } = arrayIndent(originalText);
  const items = value.map((v) => (multiLine ? `${indent}${serializeArrayItem(v, indent)}` : serializeArrayItem(v)));
  if (!multiLine) return `[${items.join(", ")}]`;
  return `[\n${items.join(",\n")}\n${closeIndent}]`;
}

// ─────────────── keyPath 定位 ───────────────

interface LocatedNode {
  /** 待替换节点（值节点） */
  node: ts.Node;
  /** 原始文本（用于引号/格式判定） */
  text: string;
}

/** 解析 keyPath 为段：属性名或 [索引] */
function parseSegments(keyPath: string): Array<{ kind: "prop" | "index"; name?: string; index?: number }> {
  const segs: Array<{ kind: "prop" | "index"; name?: string; index?: number }> = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(keyPath)) !== null) {
    if (m[1] !== undefined) segs.push({ kind: "prop", name: m[1] });
    else segs.push({ kind: "index", index: Number(m[2]) });
  }
  if (segs.length === 0) throw badRequest(`keyPath 非法：${keyPath}`);
  return segs;
}

/** 沿 keyPath 定位到值节点 */
function locate(sourceFile: ts.SourceFile, def: ConfigTargetDef, keyPath: string): LocatedNode {
  const segs = parseSegments(keyPath);
  let obj: ts.ObjectLiteralExpression | null;
  let segIndex = 0;
  if (def.multiExport) {
    const exportName = segs[0].kind === "prop" ? segs[0].name! : "";
    obj = findExportObject(sourceFile, exportName);
    if (!obj) throw badRequest(`导出未找到：${exportName}`);
    segIndex = 1;
  } else {
    obj = findExportObject(sourceFile, def.exportNames[0]);
    if (!obj) throw badRequest(`导出未找到：${def.exportNames[0]}`);
  }

  let node: ts.Node = obj;
  for (let i = segIndex; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.kind === "index") {
      if (!ts.isArrayLiteralExpression(node)) throw badRequest(`keyPath 越界：${keyPath}`);
      const el = node.elements[seg.index!];
      if (!el) throw badRequest(`数组索引越界：${keyPath}`);
      node = el;
      continue;
    }
    // prop 段
    if (!ts.isObjectLiteralExpression(node)) throw badRequest(`keyPath 非法：${keyPath}`);
    let found: ts.PropertyAssignment | undefined;
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && propName(prop.name) === seg.name) {
        found = prop;
        break;
      }
    }
    if (!found) throw badRequest(`字段不存在：${keyPath}`);
    if (i === segs.length - 1) {
      return { node: unwrap(found.initializer), text: found.initializer.getText(sourceFile) };
    }
    node = unwrap(found.initializer);
  }
  // keyPath 只有导出名（无字段）→ 整个对象，禁止整体替换
  throw badRequest(`keyPath 未指向可编辑字段：${keyPath}`);
}

/**
 * 应用变更并写回；写回前 TS 重新解析校验语法，失败不落盘
 * @returns 已保存的字段数
 */
export function applyConfigChanges(def: ConfigTargetDef, changes: ConfigChange[]): { saved: number } {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw badRequest("没有提交任何变更");
  }
  const file = path.join(CONFIG_ROOT, def.file);
  const source = readText(file);
  if (source === null) throw badRequest(`配置文件不存在：${def.file}`);
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const patches: Array<{ start: number; end: number; text: string }> = [];
  for (const change of changes) {
    if (typeof change.keyPath !== "string" || change.keyPath === "") throw badRequest("变更缺少 keyPath");
    const located = locate(sourceFile, def, change.keyPath);
    let replacement: string;
    if (Array.isArray(change.value)) {
      replacement = serializeArray(change.value, located.text);
    } else {
      const hasQuote = change.hasQuote ?? hasDoubleQuote(located.node);
      replacement = serializeScalar(change.value, hasQuote, located.node);
    }
    if (replacement === located.text) continue; // 无变化跳过
    patches.push({ start: located.node.getStart(sourceFile), end: located.node.getEnd(), text: replacement });
  }
  if (patches.length === 0) return { saved: 0 };

  // 从后往前应用，避免位置偏移
  let output = source;
  for (const p of patches.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, p.start) + p.text + output.slice(p.end);
  }

  // 写回前语法校验（transpileModule 轻量检查）
  const transpiled = ts.transpileModule(output, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: file,
  });
  const diags = (transpiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (diags.length > 0) {
    const msg = ts.flattenDiagnosticMessageText(diags[0].messageText, "\n");
    throw badRequest(`写回后语法校验失败，已取消写入：${msg}`);
  }

  writeTextAtomic(file, output);
  return { saved: patches.length };
}

// ─────────────── 附属 html 文件（虚拟 keyPath __raw_html） ───────────────

/** 读取附属 html（footer）全文 */
export function readHtmlAttachment(def: ConfigTargetDef): string {
  if (!def.htmlFile) throw badRequest("该 target 无附属文件");
  const file = path.join(CONFIG_ROOT, def.htmlFile);
  return readText(file) ?? "";
}

/** 完整覆盖写回附属 html（保留全部换行/空格/标签） */
export function writeHtmlAttachment(def: ConfigTargetDef, content: string): void {
  if (!def.htmlFile) throw badRequest("该 target 无附属文件");
  if (typeof content !== "string") throw badRequest("html 内容必须为字符串");
  writeTextAtomic(path.join(CONFIG_ROOT, def.htmlFile), content);
}
