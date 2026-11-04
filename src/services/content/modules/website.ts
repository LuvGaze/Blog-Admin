/**
 * 网站导航模块：src/content/website
 * 分类由文件夹结构决定：website/<分类>/<站点>.md + 分类/_index.json
 * md 中不再写 category 字段；分类图标与排序写在 _index.json。
 */
import type { ContentListItem, ContentModuleDef } from "../../../types/content.js";

export const websiteModule: ContentModuleDef = {
  id: "website",
  name: "网站导航",
  dir: "website",
  isSingleFile: false,
  hasBody: false,
  titleField: "name",
  urlPrefix: "/website/",
  groupMeta: {
    fileName: "_index.json",
    titleField: "name",
    sortField: "order",
    sortOrder: "desc",
    fields: [
      { key: "name", label: "分类名称", type: "string", required: true, help: "通常与文件夹同名" },
      { key: "icon", label: "分类图标", type: "string", media: true, help: "图标库名称或图片 URL" },
      { key: "order", label: "分类排序", type: "number", defaultValue: 0, help: "数字越大越靠前" },
      { key: "description", label: "分类说明", type: "textarea", help: "可选，显示在分类标题旁" },
    ],
  },
  fields: [
    { key: "name", label: "站点名称", type: "string", required: true },
    { key: "url", label: "站点地址", type: "url", required: true, media: false },
    { key: "icon", label: "图标", type: "string", media: true, help: "图标库名称（如 mdi:github）或图片 URL" },
    { key: "description", label: "站点描述", type: "textarea" },
    { key: "tags", label: "标签", type: "stringArray", help: "每行一个标签" },
    { key: "color", label: "主题色", type: "string", help: "CSS 色值，例如 #0ea5e9" },
    { key: "image", label: "预览图", type: "string", media: true, help: "可填图片 URL" },
    { key: "featured", label: "置顶推荐", type: "boolean", defaultValue: false },
    { key: "order", label: "排序", type: "number", defaultValue: 99, help: "数字越小越靠前" },
  ],
  compareItems: (a: ContentListItem, b: ContentListItem) =>
    (Number(a.fields["order"] ?? 99) || 0) - (Number(b.fields["order"] ?? 99) || 0),
  yamlFormat: {
    quote: "none",
    arrayStyle: "flow",
    arrayItemQuote: "double",
  },
};
