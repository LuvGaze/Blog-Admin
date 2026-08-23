/**
 * travel 足迹模块（docs/后端新增Demo/11_travel足迹.md）
 * 路径：src/content/travel/*.md；无正文；visitCount 正整数校验
 */
import type { ContentModuleDef } from "../../../types/content.js";

/** 足迹 frontmatter 数据结构 */
export interface TravelData {
  title: string;
  date: string;
  province: string;
  city: string;
  visitCount: number;
}

export const travelModule: ContentModuleDef = {
  id: "travel",
  name: "足迹",
  dir: "travel",
  urlPrefix: "/travel/",
  isSingleFile: false,
  hasBody: true,
  titleField: "title",
  sortOrder: "desc",
  sortKeys: ["date"],
  fields: [
    { key: "title", label: "地点名称", type: "string", required: true },
    { key: "date", label: "到访日期", type: "date", required: true },
    { key: "province", label: "省份", type: "string", required: true },
    { key: "city", label: "城市", type: "string", required: true },
    { key: "visitCount", label: "到访次数", type: "positiveInt", required: true, help: "只允许大于 0 的正整数" },
  ],
  // 与现有足迹文件一致：字符串无引号、日期无引号
  yamlFormat: { quote: "none", arrayStyle: "flow", arrayItemQuote: "none" },
};
