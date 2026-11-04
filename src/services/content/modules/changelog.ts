/**
 * changelog 更新日志模块：src/content/changelog/*.md
 * 站点排序规则：date 倒序 → version 数值倒序（v2.10.0 视为比 v2.9.0 新）
 * order 字段站点不参与排序，因此后台不再暴露。
 */
import type { ContentListItem, ContentModuleDef } from "../../../types/content.js";

const TYPE = [
  { value: "feature", label: "新增功能" },
  { value: "improvement", label: "优化改进" },
  { value: "fix", label: "问题修复" },
  { value: "removal", label: "功能移除" },
];

/** 解析 v主.次.补丁 为可比较数组 */
function versionParts(value: unknown): number[] {
  const text = String(value ?? "").trim().replace(/^v/i, "");
  return text.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function compareVersion(a: unknown, b: unknown): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export const changelogModule: ContentModuleDef = {
  id: "changelog",
  name: "更新日志",
  dir: "changelog",
  urlPrefix: "/changelog/",
  isSingleFile: false,
  hasBody: true,
  titleField: "version",
  fields: [
    { key: "version", label: "版本号", type: "string", required: true, help: "格式建议 v主.次.补丁，例如 v2.4.2；同时作为文件名" },
    { key: "date", label: "发布日期", type: "date", required: true },
    { key: "time", label: "发布时间", type: "time" },
    { key: "type", label: "更新类型", type: "string", required: true, enum: TYPE },
    { key: "description", label: "版本概述", type: "textarea", required: true, help: "版本简短一句话概述" },
    { key: "related", label: "相关更新日志", type: "stringArray", help: "填写关联日志的文件名 id（如 v1.0.0）或版本号，用于链路图连线" },
  ],
  sortItems: (items: ContentListItem[]) =>
    [...items].sort((a, b) => {
      const dateCmp = String(b.fields["date"] ?? "").localeCompare(String(a.fields["date"] ?? ""));
      if (dateCmp !== 0) return dateCmp;
      const versionCmp = compareVersion(b.fields["version"], a.fields["version"]);
      if (versionCmp !== 0) return versionCmp;
      return String(b.fields["time"] ?? "").localeCompare(String(a.fields["time"] ?? ""));
    }),
  // 与现有更新日志文件一致：全部双引号（含日期）
  yamlFormat: { quote: "double", arrayStyle: "flow", arrayItemQuote: "double", overrides: { date: { quote: "double" } } },
};
