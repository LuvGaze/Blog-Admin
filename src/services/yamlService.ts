/**
 * YAML frontmatter 读写核心（docs/后端新增Demo/00_公共通用规则.md 第 2、3 节）
 *
 * 设计要点：
 * - 禁止 yaml.dump 整体重渲染；采用「按原始文本范围局部替换」策略：
 *   未修改字段的引号、空格、换行字节级原样保留。
 * - 解析：yaml-ast-parser 得到 AST；记录每个 pair 的 value 原始范围与引号风格。
 * - 写回：仅替换被修改字段的 value 文本范围；新增字段追加到末尾；
 *   删除字段删除整个 key-value 行；数组整体重写但元素沿用各自原始引号风格。
 * - 强制转义兜底：字符串在会造成 YAML 解析歧义的位置（行首 -、: 后跟空格、
 *   # 前有空白、前后空白、换行、特殊起始字符等）强制双引号，优先于保留格式。
 */
import yaml from "yaml-ast-parser";
import type { QuoteStyle, YamlFormat } from "../types/content.js";

export type { QuoteStyle }; // 兼容旧引用

export interface FrontmatterField {
  key: string;
  value: unknown;
  quote: QuoteStyle;
}

export interface ParsedFrontmatter {
  fields: FrontmatterField[];
  /** 嵌套对象等无法扁平化展示的字段（保留不动，不在表单编辑范围） */
  unknownKeys: string[];
  /** YAML 语法错误信息；非空代表该文件为非法文件 */
  errors: string[];
}

export interface ChangeOp {
  key: string;
  /** 删除整个 key-value 节点（不赋空字符串） */
  remove?: boolean;
  value?: unknown;
  /** 默认 auto：沿用该字段原有引号风格；double/single/none 强制指定 */
  quote?: QuoteStyle | "auto";
}

/** 分离 frontmatter 与正文：返回 frontmatter 原文（不含 `---`）与正文 */
export function splitFrontmatter(source: string): { frontmatter: string | null; body: string } {
  if (!source.startsWith("---")) {
    return { frontmatter: null, body: source };
  }
  // 找闭合标记：行首 `---`（下一行）
  const firstNl = source.indexOf("\n");
  if (firstNl < 0) {
    return { frontmatter: null, body: source };
  }
  const bodyStart = firstNl + 1;
  const closeMatch = /\n---(?=\r?\n|$)/.exec(source.slice(bodyStart));
  if (!closeMatch) {
    return { frontmatter: null, body: source };
  }
  const closeIndex = bodyStart + closeMatch.index + 1; // 指向 `\n` 之后的 `-`
  const fmStart = bodyStart;
  const fmEnd = closeIndex;
  let restStart = closeIndex + 3; // 跳过 `---`
  if (source[restStart] === "\r") restStart += 1;
  if (source[restStart] === "\n") restStart += 1;
  return {
    frontmatter: source.slice(fmStart, fmEnd),
    body: source.slice(restStart),
  };
}

/** 将 frontmatter 与正文重新组装为完整 md 文本 */
export function joinFrontmatter(frontmatter: string | null, body: string, hadFrontmatter: boolean): string {
  if (frontmatter === null) {
    return body;
  }
  const nl = frontmatter.includes("\r\n") ? "\r\n" : "\n";
  const fm = frontmatter.endsWith(nl) ? frontmatter.slice(0, -nl.length) : frontmatter;
  const parts = ["---", fm, "---"];
  if (body !== "") {
    parts.push("", body);
  }
  return parts.join(nl);
}

/** 判断字符串引号风格：以原始文本首字符为准 */
function detectQuote(raw: string): QuoteStyle {
  const t = raw.trimStart();
  if (t.startsWith('"')) return "double";
  if (t.startsWith("'")) return "single";
  return "none";
}

/** 字符串是否需要强制双引号（防止 YAML 解析损坏） */
function needsDoubleQuote(s: string): boolean {
  if (s === "") return true;
  if (/[\n\r\t]/.test(s)) return true;
  // `:` 后跟空白或在末尾
  if (/:\s/.test(s) || s.endsWith(":")) return true;
  // `#` 前有空白
  if (/\s#/.test(s) || s.startsWith("#")) return true;
  // 前后空白
  if (s !== s.trim()) return true;
  // 行首特殊字符（- ? : , { } [ ] & * ! | > ' " % @ ` 等）
  if (/^[-?:,{}[\]&*!|>'"%@`]/.test(s)) return true;
  return false;
}

/** 双引号转义 */
function escDouble(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

/** 单引号转义（单引号内 `'` 写作 `''`） */
function escSingle(s: string): string {
  return s.replace(/'/g, "''");
}

/** 生成单个标量文本（数字/布尔无引号；字符串按引号风格 + 强制转义兜底） */
export function formatScalar(value: unknown, quote: QuoteStyle | "auto" = "double"): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const s = String(value);
  if (needsDoubleQuote(s)) return `"${escDouble(s)}"`;
  if (quote === "double") return `"${escDouble(s)}"`;
  if (quote === "single") return `'${escSingle(s)}'`;
  return s;
}

/** 解析值：scalar → valueObject / string；seq → string[] */
function nodeValue(node: yaml.YAMLNode | undefined): unknown {
  if (!node) return null;
  if (node.kind === yaml.Kind.SCALAR) {
    const sc = node as yaml.YAMLScalar;
    // yaml-ast-parser 按 YAML 1.1 会把裸日期（2026-08-06）解析为 Date 对象，
    // 必须回退为原始字符串，否则序列化后变成 ISO 时间戳、写回也会损坏
    const vo = sc.valueObject;
    if (vo !== undefined && !(vo instanceof Date)) return vo;
    return sc.value;
  }
  if (node.kind === yaml.Kind.SEQ) {
    const seq = node as yaml.YAMLSequence;
    return seq.items.map((it) => (it.kind === yaml.Kind.SCALAR ? (it as yaml.YAMLScalar).value : nodeValue(it)));
  }
  return undefined; // MAP / 其他：无法扁平化
}

/** 解析 frontmatter（不含 `---`）为扁平字段列表；语法错误时 errors 非空 */
export function analyzeFrontmatter(frontmatter: string): ParsedFrontmatter {
  const result: ParsedFrontmatter = { fields: [], unknownKeys: [], errors: [] };
  const doc = yaml.load(frontmatter) as yaml.YamlMap;
  if (doc.errors && doc.errors.length > 0) {
    result.errors = doc.errors.map((e) => e.message || String(e));
    return result;
  }
  if (doc.kind !== yaml.Kind.MAP && doc.kind !== yaml.Kind.MAPPING) {
    return result;
  }
  const pairs = doc.mappings ?? [];
  for (const pair of pairs) {
    const key = pair.key?.value;
    if (typeof key !== "string" || !pair.value) continue;
    const raw = frontmatter.slice(pair.value.startPosition, pair.value.endPosition);
    const value = nodeValue(pair.value);
    if (value === undefined) {
      result.unknownKeys.push(key);
      continue;
    }
    result.fields.push({
      key,
      value,
      quote: detectQuote(raw),
    });
  }
  return result;
}

/** 从 frontmatter 提取「字段值 Map」与「元素引号风格」 */
export function extractValues(frontmatter: string): {
  values: Record<string, unknown>;
  quotes: Map<string, QuoteStyle>;
  /** 数组元素引号：key → (value → quote) */
  arrayItemQuotes: Map<string, Map<string, QuoteStyle>>;
  unknownKeys: string[];
  errors: string[];
} {
  const parsed = analyzeFrontmatter(frontmatter);
  const values: Record<string, unknown> = {};
  const quotes = new Map<string, QuoteStyle>();
  const arrayItemQuotes = new Map<string, Map<string, QuoteStyle>>();
  for (const f of parsed.fields) {
    values[f.key] = f.value;
    quotes.set(f.key, f.quote);
  }
  // 数组元素引号风格：按值匹配
  const doc = yaml.load(frontmatter) as yaml.YamlMap;
  if (!doc.errors || doc.errors.length === 0) {
    for (const pair of doc.mappings ?? []) {
      const key = pair.key?.value;
      if (typeof key !== "string" || !pair.value || pair.value.kind !== yaml.Kind.SEQ) continue;
      const itemQuotes = new Map<string, QuoteStyle>();
      for (const item of (pair.value as yaml.YAMLSequence).items) {
        if (item.kind !== yaml.Kind.SCALAR) continue;
        const v = String((item as yaml.YAMLScalar).value);
        if (!itemQuotes.has(v)) {
          itemQuotes.set(v, detectQuote(frontmatter.slice(item.startPosition, item.endPosition)));
        }
      }
      arrayItemQuotes.set(key, itemQuotes);
    }
  }
  return { values, quotes, arrayItemQuotes, unknownKeys: parsed.unknownKeys, errors: parsed.errors };
}

/** 生成数组文本：flow `[a, b]` 或 block `  - a`；
 * 配置了 format 时按模块规范（style + 元素引号），未配置时保留原格式（元素沿用原引号） */
function formatArray(value: unknown[], quotes: Map<string, QuoteStyle> | undefined, frontmatter: string, key: string, format?: YamlFormat): string {
  const nl = frontmatter.includes("\r\n") ? "\r\n" : "\n";
  const fo = format?.overrides?.[key];
  // 未配置模块规范时：检测原数组格式（flow `[` / block `- `）并沿用
  let isFlow = true;
  let indent = "  ";
  if (!fo?.arrayStyle && !format?.arrayStyle) {
    const doc = yaml.load(frontmatter) as yaml.YamlMap;
    if (!doc.errors || doc.errors.length === 0) {
      for (const pair of doc.mappings ?? []) {
        if (pair.key?.value === key && pair.value && pair.value.kind === yaml.Kind.SEQ) {
          const seq = pair.value as yaml.YAMLSequence;
          const raw = frontmatter.slice(seq.startPosition, seq.endPosition);
          isFlow = raw.trimStart().startsWith("[");
          if (!isFlow && seq.items.length > 0) {
            const firstRaw = frontmatter.slice(seq.items[0].startPosition, seq.items[0].endPosition);
            const lineStart = frontmatter.lastIndexOf(nl, seq.items[0].startPosition - 1);
            const linePrefix = frontmatter.slice(lineStart + nl.length, seq.items[0].startPosition);
            // linePrefix 形如 "  - "（含 "- "），m[1] 即为元素缩进；不再追加空格，否则每次写回缩进会 +1
            const m = /^(\s*)-/.exec(linePrefix);
            if (m) indent = m[1];
          }
          break;
        }
      }
    }
  } else {
    isFlow = (fo?.arrayStyle ?? format?.arrayStyle) === "flow";
  }
  const items = value.map((v) => formatScalar(v, fo?.quote ?? format?.arrayItemQuote ?? quotes?.get(String(v)) ?? "double"));
  if (isFlow) {
    return `[${items.join(", ")}]`;
  }
  return items.map((it) => `${indent}- ${it}`).join(nl);
}

/** 写回 frontmatter：局部替换 + 追加/删除，返回新 frontmatter（不含 `---`）
 * format 配置后：被编辑字段按模块规范生成（字段级覆盖 > 调用方显式 quote > 模块默认 > 原格式） */
export function writeFrontmatter(frontmatter: string, changes: ChangeOp[], format?: YamlFormat): string {
  if (changes.length === 0) return frontmatter;
  const parsed = analyzeFrontmatter(frontmatter);
  if (parsed.errors.length > 0) {
    const err = new Error(`frontmatter YAML 语法错误，拒绝写入：${parsed.errors[0]}`);
    err.name = "YamlSyntaxError";
    throw err;
  }
  const nl = frontmatter.includes("\r\n") ? "\r\n" : "\n";
  const doc = yaml.load(frontmatter) as yaml.YamlMap;
  const pairs = doc.mappings ?? [];

  // key → ChangeOp
  const changeMap = new Map<string, ChangeOp>();
  for (const c of changes) changeMap.set(c.key, c);

  // 逐行删除辅助：从 start 到「value 结束所在行的行尾 + 换行」
  const lineEndAfter = (pos: number): number => {
    if (pos < frontmatter.length && frontmatter[pos] === "\n") return pos + 1;
    const i = frontmatter.indexOf("\n", pos);
    return i >= 0 ? i + 1 : frontmatter.length;
  };
  const lineStartBefore = (pos: number): number => {
    const i = frontmatter.lastIndexOf("\n", pos - 1);
    return i >= 0 ? i + 1 : 0;
  };

  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const handled = new Set<string>();

  for (const pair of pairs) {
    const key = pair.key?.value;
    if (typeof key !== "string") continue;
    const op = changeMap.get(key);
    if (!op) continue;
    handled.add(key);
    if (!pair.value) continue;
    if (op.remove) {
      // 删除整个 key-value 行（含行尾换行）
      replacements.push({ start: lineStartBefore(pair.startPosition), end: lineEndAfter(pair.endPosition), text: "" });
      continue;
    }
    // 替换 value 文本范围
    const value = op.value;
    if (Array.isArray(value)) {
      const itemQuotes = extractValues(frontmatter).arrayItemQuotes.get(key);
      const fo = format?.overrides?.[key];
      // 模块规范要求该数组的写法（未配置时 undefined = 保留原格式）
      const wantBlock = (fo?.arrayStyle ?? format?.arrayStyle) === "block";
      let start = pair.value.startPosition;
      const end = pair.value.endPosition;
      const text = formatArray(value, itemQuotes, frontmatter, key, format);
      if (pair.value.kind === yaml.Kind.SEQ) {
        const raw = frontmatter.slice(pair.value.startPosition, pair.value.endPosition);
        const origBlock = !raw.trimStart().startsWith("[");
        if (origBlock && !wantBlock) {
          // 原 block → 模块规范强制 flow：必须连 `key:` 行一起替换（含残留缩进），
          // 否则只替换 value 范围会留下 `key:` + 裸 `[...]`
          start = lineStartBefore(pair.startPosition);
          replacements.push({ start, end, text: `${key}: ${text}` });
          continue;
        }
        if (origBlock) {
          // block 数组的 SEQ startPosition 指向 `-`（不含行首缩进）：
          // 若只替换 value 范围，残留缩进会与 formatArray 生成的新缩进叠加（每次写回 +1）
          // 因此将替换起点扩展到 seq 所在行行首（含缩进）
          const seqLineStart = frontmatter.lastIndexOf(nl, pair.value.startPosition - 1);
          if (seqLineStart >= 0) start = Math.min(start, seqLineStart + 1);
        }
      }
      replacements.push({ start, end, text });
    } else {
      const fo = format?.overrides?.[key];
      const quote: QuoteStyle =
        fo?.quote ?? (op.quote && op.quote !== "auto" ? op.quote : format?.quote ?? detectQuote(frontmatter.slice(pair.value.startPosition, pair.value.endPosition)));
      replacements.push({ start: pair.value.startPosition, end: pair.value.endPosition, text: formatScalar(value, quote) });
    }
  }

  // 新增字段：追加到 frontmatter 末尾
  const additions: string[] = [];
  for (const c of changes) {
    if (handled.has(c.key)) continue;
    if (c.remove) continue; // 删除不存在的字段无操作
    const fo = format?.overrides?.[c.key];
    if (Array.isArray(c.value)) {
      const arrQuote = fo?.quote ?? format?.arrayItemQuote ?? "double";
      if ((fo?.arrayStyle ?? format?.arrayStyle ?? "flow") === "block") {
        additions.push(`${c.key}:${nl}${c.value.map((it) => `  - ${formatScalar(it, arrQuote)}`).join(nl)}`);
      } else {
        additions.push(`${c.key}: [${c.value.map((it) => formatScalar(it, arrQuote)).join(", ")}]`);
      }
    } else {
      additions.push(`${c.key}: ${formatScalar(c.value, fo?.quote ?? format?.quote ?? "double")}`);
    }
  }
  if (additions.length > 0) {
    const base = frontmatter.endsWith(nl) ? frontmatter : frontmatter + nl;
    replacements.push({ start: base.length, end: base.length, text: additions.join(nl) + nl });
  }

  // 从后往前应用替换
  let out = frontmatter;
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

/** 新建文件 frontmatter 模板：
 * - format 配置时按模块规范（引号 + 数组写法，字段级覆盖优先）
 * - 未配置 format 时：字符串双引号、数字/布尔无引号、数组元素双引号；
 *   dateKeys 中的日期字段写无引号（博客 z.date() 校验要求 YAML 解析为 Date，带引号会变成字符串导致校验失败） */
export function buildFrontmatterTemplate(
  values: Record<string, unknown>,
  newline = "\n",
  dateKeys?: ReadonlySet<string>,
  format?: YamlFormat,
): string {
  const lines = Object.entries(values).map(([k, v]) => {
    const fo = format?.overrides?.[k];
    if (Array.isArray(v)) {
      const arrQuote = fo?.quote ?? format?.arrayItemQuote ?? "double";
      if ((fo?.arrayStyle ?? format?.arrayStyle ?? "flow") === "block") {
        return `${k}:${newline}${v.map((it) => `  - ${formatScalar(it, arrQuote)}`).join(newline)}`;
      }
      return `${k}: [${v.map((it) => formatScalar(it, arrQuote)).join(", ")}]`;
    }
    const quote: QuoteStyle = fo?.quote ?? (dateKeys?.has(k) ? "none" : format?.quote ?? "double");
    return `${k}: ${formatScalar(v, quote)}`;
  });
  return lines.join(newline) + (lines.length > 0 ? newline : "");
}
