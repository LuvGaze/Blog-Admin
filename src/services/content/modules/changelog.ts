/**
 * changelog 更新日志模块（docs/后端新增Demo/04_changelog更新日志.md）
 * 路径：src/content/changelog/*.md；有正文；date/time/type 校验
 */
import type { ContentModuleDef } from "../../../types/content.js";

/** 更新日志 frontmatter 数据结构 */
export interface ChangelogData {
  version: string;
  date: string;
  time: string;
  type: "feature" | "improvement" | "fix" | "removal";
  description: string;
  related?: string[];
}

// 与博客 src/content.config.ts 中 changelog 的 z.enum 保持一致，避免后台写出非法值
const TYPE = [
  { value: "feature", label: "新增功能" },
  { value: "improvement", label: "优化改进" },
  { value: "fix", label: "问题修复" },
  { value: "removal", label: "功能移除" },
];

export const changelogModule: ContentModuleDef = {
  id: "changelog",
  name: "更新日志",
  dir: "changelog",
  urlPrefix: "/changelog/",
  isSingleFile: false,
  hasBody: true,
  titleField: "version",
  sortOrder: "desc",
  sortKeys: ["date", "time", "version"],
  fields: [
    { key: "version", label: "版本号", type: "string", required: true, help: "格式建议 v主.次.补丁，例如 v1.0.0" },
    { key: "date", label: "发布日期", type: "date", required: true },
    { key: "time", label: "发布时间", type: "time", required: false },
    { key: "type", label: "更新类型", type: "string", required: true, enum: TYPE },
    { key: "order", label: "手动排序", type: "number", required: false, help: "越大越靠前；不填则按日期从新到旧排" },
    { key: "description", label: "版本概述", type: "string", required: true, help: "版本简短一句话概述" },
    { key: "related", label: "相关更新日志", type: "stringArray", required: false, help: "填写相关联日志的文件名 id（如 v1.0.0）或版本号，用于在更新日志链路图中画关联线" },
  ],
  // 与现有更新日志文件一致：全部双引号（含日期）
  yamlFormat: { quote: "double", arrayStyle: "flow", arrayItemQuote: "double", overrides: { date: { quote: "double" } } },
};
