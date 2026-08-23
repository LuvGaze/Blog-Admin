/**
 * posts 文章模块（docs/后端新增Demo/10_posts文章.md）
 * 路径：src/content/posts/*.md；有正文；
 * - image 留空自动写入 `api`（触发随机封面）
 * - 公开文章移除 password/passwordHint，强制 encrypted: false
 * - 加密文章保留 password（明文存储提示）
 */
import type { ContentModuleDef } from "../../../types/content.js";

/** 文章 frontmatter 数据结构 */
export interface PostData {
  title: string;
  published: string;
  pinned?: boolean;
  description?: string;
  tags?: string[];
  category?: string;
  draft?: boolean;
  image?: string;
  encrypted?: boolean;
  password?: string;
  passwordHint?: string;
}

export const postsModule: ContentModuleDef = {
  id: "posts",
  name: "文章",
  dir: "posts",
  urlPrefix: "/posts/",
  isSingleFile: false,
  hasBody: true,
  titleField: "title",
  fields: [
    { key: "title", label: "文章标题", type: "string", required: true },
    { key: "published", label: "发布日期", type: "date", required: true },
    { key: "pinned", label: "置顶", type: "boolean", defaultValue: false, help: "true 置顶展示" },
    { key: "description", label: "文章简介", type: "string" },
    { key: "tags", label: "标签", type: "stringArray" },
    { key: "category", label: "文章分类", type: "string" },
    { key: "draft", label: "草稿", type: "boolean", defaultValue: false, help: "true 草稿不对外展示，仅后台可见" },
    { key: "image", label: "封面标识", type: "string", media: true, help: "留空提交自动填充为 api（随机封面）" },
    { key: "encrypted", label: "加密标记", type: "boolean", defaultValue: false },
    {
      key: "password",
      label: "访问密码",
      type: "string",
      help: "非空开启加密；清空切换为公开文章（明文存储，请勿使用高敏感密码）",
    },
    { key: "passwordHint", label: "密码提示", type: "string", help: "仅加密文章生效，公开文章不保留" },
  ],
  // 与现有文章文件一致：字符串无引号、日期无引号（published 为 z.date() 严格校验）、tags flow 无引号
  yamlFormat: { quote: "none", arrayStyle: "flow", arrayItemQuote: "none" },
  normalize: (values) => {
    // image 默认逻辑：留空自动填充 api
    if (values.image === undefined || values.image === null || String(values.image).trim() === "") {
      values.image = "api";
    }
    const password = values.password;
    if (password === undefined || password === null || String(password).trim() === "") {
      // 公开文章：移除加密相关字段，encrypted 强制 false
      delete values.password;
      delete values.passwordHint;
      values.encrypted = false;
      return { remove: ["password", "passwordHint"] };
    }
    // 加密文章：密码提示为空则移除
    const hint = values.passwordHint;
    if (hint === undefined || hint === null || String(hint).trim() === "") {
      delete values.passwordHint;
      return { remove: ["passwordHint"] };
    }
    return { remove: [] };
  },
};
