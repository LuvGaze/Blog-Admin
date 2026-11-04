/**
 * travel 足迹模块：src/content/travel/*.md
 * - order 越大越靠前；相同按日期倒序
 * - lat/lng 可留空，由足迹地图自动地理编码
 */
import type { ContentModuleDef } from "../../../types/content.js";

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
    { key: "date", label: "到访日期", type: "date" },
    { key: "province", label: "省份", type: "string", required: true },
    { key: "city", label: "城市", type: "string", required: true },
    { key: "district", label: "区/县", type: "string" },
    { key: "visitCount", label: "到访次数", type: "positiveInt", required: true, defaultValue: 1, help: "只允许大于 0 的正整数" },
    { key: "cover", label: "封面图", type: "string", media: true },
    { key: "tags", label: "标签", type: "stringArray", help: "每行一个标签" },
    { key: "lat", label: "纬度 (lat)", type: "number", help: "可选。留空时前端会用高德地理编码自动获取坐标" },
    { key: "lng", label: "经度 (lng)", type: "number", help: "可选。留空时前端会用高德地理编码自动获取坐标" },
    { key: "order", label: "手动排序", type: "number", defaultValue: 0, help: "越大越靠前；相同则按日期从新到旧" },
  ],
  // 与现有足迹文件一致：字符串无引号、日期无引号
  yamlFormat: { quote: "none", arrayStyle: "flow", arrayItemQuote: "none" },
};
