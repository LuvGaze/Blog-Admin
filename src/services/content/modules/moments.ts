/**
 * moments 朋友圈（说说）：src/content/moments/*.md
 * - published 为日期时间（YAML 时间戳，无引号），用 string 字段保留时分秒
 * - 文件名规则：YYYY-MM-DD-slug.md
 * - 站点列表按 pinned → published 倒序，order 不参与朋友圈排序
 */
import type { ContentModuleDef } from "../../../types/content.js";
import { safeName } from "../../../utils/fsx.js";
import { badRequest } from "../../../utils/errors.js";

export const momentsModule: ContentModuleDef = {
  id: "moments",
  name: "朋友圈",
  dir: "moments",
  urlPrefix: "/moments/",
  isSingleFile: false,
  hasBody: true,
  titleField: "published",
  sortOrder: "desc",
  fields: [
    { key: "published", label: "发布时间", type: "datetime", required: true, help: "精确到秒，如 2026-09-15 20:30:00（YAML 时间戳，不写引号）" },
    { key: "pinned", label: "置顶", type: "boolean", defaultValue: false, help: "置顶后将显示在朋友圈顶部区域" },
    { key: "author", label: "作者", type: "string", help: "留空使用站点默认作者（不会写入空字段）" },
    { key: "avatar", label: "作者头像", type: "string", help: "留空使用博客作者头像；可填 https:// 或 /assets/ 开头路径" },
    { key: "location", label: "位置", type: "string", help: "如：家中、公园" },
    { key: "tags", label: "标签", type: "stringArray", defaultValue: [], help: "每行一个标签" },
    { key: "images", label: "图片", type: "stringArray", help: "每行一个图片地址（站内路径或 https://）" },
  ],
  fileName: (values) => {
    const raw = String(values["published"] ?? "");
    const datePart = raw.slice(0, 10);
    const slugBase = String(values["location"] ?? "") || String(values["author"] ?? "") || "moment";
    return `${datePart || new Date().toISOString().slice(0, 10)}-${safeName(slugBase, "moment")}`;
  },
  normalize: (values) => {
    const published = String(values["published"] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?$/.test(published) || Number.isNaN(Date.parse(published.replace(" ", "T"))) ) {
      throw badRequest("发布时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss");
    }
    values["published"] = published;
    return { remove: [] };
  },
  sortItems: (items) =>
    [...items].sort((a, b) => {
      const pa = a.fields["pinned"] === true ? 1 : 0;
      const pb = b.fields["pinned"] === true ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return String(b.fields["published"] ?? "").localeCompare(String(a.fields["published"] ?? ""));
    }),
  // 与现有朋友圈文件一致：字符串双引号、tags 缩进列表（元素不加引号）、published 无引号时间戳
  yamlFormat: {
    quote: "double",
    arrayStyle: "block",
    arrayItemQuote: "none",
    overrides: { published: { quote: "none" } },
  },
};
