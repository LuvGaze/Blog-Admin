/**
 * movies 影视模块（docs/后端新增Demo/03_movies影视.md）
 * 路径：src/content/movies/*.md；有正文；category 固定 real；subcategory 枚举
 */
import type { ContentModuleDef } from "../../../types/content.js";

/** 影视条目 frontmatter 数据结构 */
export interface MovieData {
  title: string;
  category: "real";
  subcategory: "movie" | "tv" | "anime" | "documentary";
  image?: string;
  score?: number;
  /** 1想看 2看过 3在看 4搁置 5抛弃 */
  status: number;
  comment?: string;
  tags?: string[];
}

const SUBCATEGORY = [
  { value: "movie", label: "电影" },
  { value: "tv", label: "电视剧" },
  { value: "anime", label: "动漫" },
  { value: "documentary", label: "纪录片" },
];

const STATUS = [
  { value: 1, label: "想看" },
  { value: 2, label: "看过" },
  { value: 3, label: "在看" },
  { value: 4, label: "搁置" },
  { value: 5, label: "抛弃" },
];

export const moviesModule: ContentModuleDef = {
  id: "movies",
  name: "影视",
  dir: "movies",
  urlPrefix: "/movies/",
  isSingleFile: false,
  hasBody: true,
  titleField: "title",
  fields: [
    { key: "title", label: "影视名称", type: "string", required: true },
    { key: "category", label: "一级分类", type: "string", hidden: true, fixed: "real", help: "固定为 real，禁止修改" },
    { key: "subcategory", label: "影视子分类", type: "string", required: true, enum: SUBCATEGORY },
    { key: "image", label: "封面图链接", type: "url", media: true, help: "仅支持在线 http/https 图片链接" },
    { key: "score", label: "评分", type: "number", help: "支持小数格式" },
    { key: "status", label: "观看状态", type: "numberEnum", required: true, enum: STATUS },
    { key: "comment", label: "短评", type: "string", help: "一句话简介" },
    { key: "tags", label: "标签", type: "stringArray", help: "支持多标签新增、删除、修改" },
  ],
  // 与现有影视文件一致：全部双引号、tags flow 双引号
  yamlFormat: { quote: "double", arrayStyle: "flow", arrayItemQuote: "double" },
  normalize: (values) => {
    values.category = "real";
    return { remove: [] };
  },
};
