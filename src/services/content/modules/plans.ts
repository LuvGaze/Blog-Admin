/**
 * plans 规划模块（docs/后端新增Demo/09_plans规划.md）
 * 路径：src/content/plans/*.md；有正文；updated 日期校验，新建自动填充当天
 */
import type { ContentModuleDef } from "../../../types/content.js";

/** 规划条目 frontmatter 数据结构 */
export interface PlanData {
  name: string;
  time?: string;
  cover?: string;
  description?: string;
  updated: string;
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const plansModule: ContentModuleDef = {
  id: "plans",
  name: "规划",
  dir: "plans",
  urlPrefix: "/plans",
  isSingleFile: false,
  hasBody: true,
  titleField: "name",
  sortOrder: "desc",
  sortKeys: ["updated"],
  fields: [
    { key: "name", label: "规划名称", type: "string", required: true },
    { key: "time", label: "执行时间", type: "string", help: "自由文本，例如时间段、周期" },
    { key: "cover", label: "封面图片", type: "string", help: "图片 URL，展示在卡片图标位置" },
    { key: "description", label: "规划描述", type: "string" },
    { key: "updated", label: "更新日期", type: "date", required: true, help: "新建时自动填充为当前日期" },
  ],
  // 与现有规划文件一致：全部无引号（含日期）
  yamlFormat: { quote: "none", arrayStyle: "flow", arrayItemQuote: "none" },
  normalize: (values, isNew) => {
    if (isNew && (values.updated === undefined || values.updated === "")) {
      values.updated = today();
    }
    return { remove: [] };
  },
};
