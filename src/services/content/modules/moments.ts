/**
 * moments 朋友圈（说说）模块
 * 路径：src/content/moments/*.md；有正文（朋友圈文案）；
 * - published 为日期时间（YAML 时间戳，无引号），用 string 字段保留时分秒
 * - 文件名规则：YYYY-MM-DD-slug.md（slug 取位置/作者，缺省 moment）
 */
import type { ContentModuleDef } from "../../../types/content.js";
import { safeName } from "../../../utils/fsx.js";

/** 朋友圈 frontmatter 数据结构 */
export interface MomentData {
  author: string;
  avatar: string;
  pinned: boolean;
  published: string;
  images: string[];
  tags: string[];
  location: string;
}

export const momentsModule: ContentModuleDef = {
  id: "moments",
  name: "朋友圈",
  dir: "moments",
  urlPrefix: "/moments/",
  isSingleFile: false,
  hasBody: true,
  titleField: "published",
  sortOrder: "desc",
  sortKeys: ["published"],
  fields: [
    { key: "published", label: "发布时间", type: "string", required: true, help: "格式：2026-09-15 20:30:00（YAML 时间戳，不写引号）" },
    { key: "pinned", label: "置顶", type: "boolean", defaultValue: false, help: "true 显示在朋友圈顶部置顶区域" },
    { key: "order", label: "手动排序", type: "number", required: false, help: "越大越靠前；不填则按发布时间从新到旧排" },
    { key: "author", label: "作者", type: "string", defaultValue: "", help: "默认 LuvGaze" },
    { key: "avatar", label: "作者头像", type: "string", required: false, help: "留空使用博客作者头像；可填 https:// 或 /assets/ 开头路径" },
    { key: "location", label: "位置", type: "string", required: false, help: "如：家中、公园" },
    { key: "tags", label: "标签", type: "stringArray", defaultValue: [], help: "如：日常、摄影" },
    { key: "images", label: "图片", type: "stringArray", required: false, help: "图片地址（/ 站内路径或 https:// 远程地址），每行一个" },
  ],
  fileName: (values) => {
    const raw = String(values.published ?? "");
    const datePart = raw.slice(0, 10);
    const slugBase = String(values.location ?? "") || String(values.author ?? "") || "moment";
    return `${datePart || new Date().toISOString().slice(0, 10)}-${safeName(slugBase, "moment")}`;
  },
  // 与现有朋友圈文件一致：字符串双引号、tags 缩进列表、published 无引号时间戳
  yamlFormat: {
    quote: "double",
    arrayStyle: "block",
    arrayItemQuote: "double",
    overrides: { published: { quote: "none" } },
  },
};
