/**
 * gallery 相册模块（docs/后端新增Demo/07_gallery相册.md）
 * 路径：src/content/gallery/*.md；无正文；password 空 → 移除 password/passwordHint 字段
 */
import type { ContentModuleDef } from "../../../types/content.js";

/** 相册 frontmatter 数据结构 */
export interface GalleryData {
  name: string;
  description?: string;
  location?: string;
  date?: string;
  tags?: string[];
  password?: string;
  passwordHint?: string;
  images: string[];
}

export const galleryModule: ContentModuleDef = {
  id: "gallery",
  name: "相册",
  dir: "gallery",
  urlPrefix: "/gallery/",
  isSingleFile: false,
  hasBody: false,
  titleField: "name",
  sortOrder: "desc",
  sortKeys: ["date"],
  fields: [
    { key: "name", label: "相册名称", type: "string", required: true },
    { key: "description", label: "相册简介", type: "string" },
    { key: "location", label: "拍摄地点", type: "string" },
    { key: "date", label: "相册时间", type: "date" },
    { key: "tags", label: "标签", type: "stringArray" },
    {
      key: "password",
      label: "访问密码",
      type: "string",
      help: "不填为公开相册；填写后为加密相册（明文存储，请勿使用高敏感密码）",
    },
    { key: "passwordHint", label: "密码提示", type: "string", help: "仅加密相册生效，公开相册不保留" },
    { key: "images", label: "图片列表", type: "urlArray", required: true, media: true, help: "全部为在线 http/https 图片链接" },
  ],
  // 与现有相册文件一致：字符串/日期/tags 双引号 flow，图片列表 block 无引号
  yamlFormat: {
    quote: "double",
    arrayStyle: "flow",
    arrayItemQuote: "double",
    overrides: { date: { quote: "double" }, images: { quote: "none", arrayStyle: "block" } },
  },
  normalize: (values) => {
    const password = values.password;
    if (password === undefined || password === null || String(password).trim() === "") {
      // 公开相册：直接移除字段，不赋空字符串
      delete values.password;
      delete values.passwordHint;
      return { remove: ["password", "passwordHint"] };
    }
    // 加密相册：密码提示为空则移除
    const hint = values.passwordHint;
    if (hint === undefined || hint === null || String(hint).trim() === "") {
      delete values.passwordHint;
      return { remove: ["passwordHint"] };
    }
    return { remove: [] };
  },
};
