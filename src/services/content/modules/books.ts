/**
 * books 书架模块（docs/后端新增Demo/01_books书架.md）
 * 路径：src/content/books/*.md；有正文；category 固定 book
 */
import type { ContentModuleDef } from "../../../types/content.js";
import { statusScoreSort } from "../statusSort.js";

/** 书架条目 frontmatter 数据结构 */
export interface BookData {
  title: string;
  category: "book";
  image?: string;
  score?: number;
  /** 1想读 2读过 3在读 4搁置 5抛弃 */
  status: number;
  comment?: string;
  tags?: string[];
}

const STATUS = [
  { value: 1, label: "想读" },
  { value: 2, label: "读过" },
  { value: 3, label: "在读" },
  { value: 4, label: "搁置" },
  { value: 5, label: "抛弃" },
];

export const booksModule: ContentModuleDef = {
  id: "books",
  name: "书架",
  dir: "books",
  urlPrefix: "/books/",
  isSingleFile: false,
  hasBody: true,
  titleField: "title",
  sortItems: statusScoreSort(),
  fields: [
    { key: "title", label: "书籍名称", type: "string", required: true },
    { key: "category", label: "分类标识", type: "string", hidden: true, fixed: "book", help: "固定为 book，禁止修改" },
    { key: "image", label: "封面图链接", type: "url", media: true, help: "仅支持在线 http/https 图片链接" },
    { key: "score", label: "评分", type: "number", help: "支持小数格式" },
    { key: "status", label: "阅读状态", type: "numberEnum", required: true, enum: STATUS },
    { key: "comment", label: "短评", type: "string", help: "一句话简介" },
    { key: "tags", label: "标签", type: "stringArray", help: "支持多标签新增、删除、修改" },
  ],
  // 与现有书架文件一致：title/comment 无引号、image(URL) 双引号、tags flow 无引号
  yamlFormat: { quote: "none", arrayStyle: "flow", arrayItemQuote: "none", overrides: { image: { quote: "double" } } },
  normalize: (values) => {
    values.category = "book";
    return { remove: [] };
  },
};
