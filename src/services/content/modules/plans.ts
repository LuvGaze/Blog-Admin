/**
 * plans 规划模块：src/content/plans/*.md（集合 routines）
 * - order 升序（越小越靠前，默认 999，新增自动放到末尾）
 * - 同 order 按 updated 倒序
 */
import type { ContentModuleDef } from "../../../types/content.js";
import { today } from "../../../utils/date.js";

export const plansModule: ContentModuleDef = {
  id: "plans",
  name: "规划",
  dir: "plans",
  urlPrefix: "/plans/",
  isSingleFile: false,
  hasBody: true,
  titleField: "name",
  sortOrder: "desc",
  sortKeys: ["updated"],
  orderDirection: "asc",
  fields: [
    { key: "name", label: "规划名称", type: "string", required: true },
    { key: "time", label: "执行时间", type: "string", help: "自由文本，例如时间段、周期" },
    { key: "cover", label: "封面图片", type: "string", media: true, help: "图片 URL，展示在卡片图标位置" },
    { key: "description", label: "规划描述", type: "textarea" },
    { key: "updated", label: "更新日期", type: "date", required: true, help: "新建时自动填充为当前日期" },
    { key: "order", label: "手动排序", type: "number", defaultValue: 999, help: "越小越靠前；相同则按更新日期从新到旧" },
  ],
  // 与现有规划文件一致：全部无引号（含日期）
  yamlFormat: { quote: "none", arrayStyle: "flow", arrayItemQuote: "none" },
  normalize: (values, isNew) => {
    if (isNew && (values["updated"] === undefined || values["updated"] === "")) {
      values["updated"] = today();
    }
    return { remove: [] };
  },
};
