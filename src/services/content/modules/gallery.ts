/**
 * gallery 相册模块：src/content/gallery/*.md
 * 无正文；password 为空时移除 password/passwordHint 字段。
 */
import type { ContentModuleDef } from "../../../types/content.js";

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
    { key: "description", label: "相册简介", type: "textarea" },
    { key: "location", label: "拍摄地点", type: "string" },
    { key: "date", label: "相册时间", type: "date" },
    { key: "tags", label: "标签", type: "stringArray", help: "每行一个标签" },
    { key: "cover", label: "封面图", type: "string", media: true, help: "留空使用第一张图片" },
    { key: "images", label: "图片列表", type: "urlArray", required: true, media: true, help: "每行一个 http/https 图片链接" },
    { key: "order", label: "手动排序", type: "number", defaultValue: 0, help: "越大越靠前；相同则按日期从新到旧" },
    { key: "password", label: "访问密码", type: "string", help: "留空为公开相册；填写后为加密相册（明文存储，请勿使用高敏感密码）" },
    { key: "passwordHint", label: "密码提示", type: "string", help: "仅加密相册生效，公开相册不保留" },
  ],
  // 与现有相册文件一致：字符串/日期/tags 双引号 flow，图片列表 block 无引号
  yamlFormat: {
    quote: "double",
    arrayStyle: "flow",
    arrayItemQuote: "double",
    overrides: { date: { quote: "double" }, images: { quote: "none", arrayStyle: "block" } },
  },
  normalize: (values) => {
    const password = values["password"];
    if (password === undefined || password === null || String(password).trim() === "") {
      delete values["password"];
      delete values["passwordHint"];
      return { remove: ["password", "passwordHint"] };
    }
    const hint = values["passwordHint"];
    if (hint === undefined || hint === null || String(hint).trim() === "") {
      delete values["passwordHint"];
      return { remove: ["passwordHint"] };
    }
    return { remove: [] };
  },
};
