/**
 * 友链模块：src/content/friends
 * 分组完全由文件夹层级决定：friends/<分组>/<友链>.md + 分组/_index.json
 * 字段与 content.config.ts 的 friends schema 对应（group/tags 已移除）。
 */
import type { ContentListItem, ContentModuleDef } from "../../../types/content.js";

export const friendsModule: ContentModuleDef = {
  id: "friends",
  name: "友链",
  dir: "friends",
  isSingleFile: false,
  hasBody: false,
  titleField: "title",
  urlPrefix: "/friends/",
  groupMeta: {
    fileName: "_index.json",
    titleField: "name",
    sortField: "sort",
    sortOrder: "desc",
    fields: [
      { key: "name", label: "分组标识", type: "string", required: true, help: "通常与文件夹同名，作为兜底显示名" },
      { key: "title", label: "分组标题", type: "string", help: "友链页展示的分组标题（支持 emoji）" },
      { key: "description", label: "分组说明", type: "textarea", help: "显示在分组标题下方" },
      { key: "sort", label: "分组排序", type: "number", defaultValue: 0, help: "数字越大越靠前" },
    ],
  },
  fields: [
    { key: "title", label: "站点名称", type: "string", required: true },
    { key: "imgurl", label: "头像地址", type: "url", required: true, media: true },
    { key: "desc", label: "站点描述", type: "textarea" },
    { key: "siteurl", label: "站点地址", type: "url", required: true },
    { key: "weight", label: "权重", type: "number", defaultValue: 0, help: "数字越大越靠前" },
    { key: "enabled", label: "启用", type: "boolean", defaultValue: true },
    { key: "added", label: "添加日期", type: "date", help: "用于「新朋友」排序，留空则不参与" },
    { key: "screenshot", label: "站点截图", type: "url", media: true, help: "卡片截图地址（图床 URL），留空自动回退到头像" },
  ],
  compareItems: (a: ContentListItem, b: ContentListItem) =>
    (Number(b.fields["weight"]) || 0) - (Number(a.fields["weight"]) || 0) ||
    String(a.fields["title"] ?? "").localeCompare(String(b.fields["title"] ?? ""), "zh-CN"),
  yamlFormat: {
    quote: "double",
    arrayStyle: "flow",
    arrayItemQuote: "double",
  },
};
