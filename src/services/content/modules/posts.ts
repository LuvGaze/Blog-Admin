/**
 * 文章模块：src/content/posts（集合 posts）
 * 字段与 src/content.config.ts 的 posts schema 一一对应。
 */
import type { ContentModuleDef, ContentListItem } from "../../../types/content.js";

const draftRank = (item: ContentListItem): number => {
  const f = item.fields;
  if (f["draft"] === true) return 0; // 草稿优先展示，便于继续编辑
  if (f["pinned"] === true) return 1;
  return 2;
};

export const postsModule: ContentModuleDef = {
  id: "posts",
  name: "文章",
  dir: "posts",
  isSingleFile: false,
  hasBody: true,
  titleField: "title",
  urlPrefix: "/posts/",
  sortOrder: "desc",
  sortKeys: ["published"],
  fields: [
    { key: "title", label: "标题", type: "string", required: true },
    { key: "published", label: "发布日期", type: "date", required: true },
    { key: "updated", label: "更新日期", type: "date", help: "留空则不显示更新时间" },
    { key: "draft", label: "草稿", type: "boolean", defaultValue: false },
    { key: "pinned", label: "置顶", type: "boolean", defaultValue: false },
    { key: "order", label: "排序权重", type: "number", defaultValue: 0, help: "数字越大越靠前（置顶文章仍排在普通文章之前）" },
    { key: "category", label: "分类", type: "string", help: "用于分类页与列表筛选，留空则不计入任何分类" },
    { key: "tags", label: "标签", type: "stringArray", help: "每行一个标签" },
    { key: "description", label: "摘要", type: "textarea", help: "列表页与 SEO 摘要；留空则使用正文开头" },
    { key: "image", label: "封面图", type: "string", media: true, defaultValue: "api", help: "图片 URL；填 api 表示使用随机封面" },
    { key: "lang", label: "语言", type: "string", help: "例如 zh-CN / en；留空使用站点默认" },
    { key: "author", label: "作者", type: "string", help: "留空使用站点默认作者" },
    { key: "sourceLink", label: "来源链接", type: "string", help: "转载文章的原文地址" },
    { key: "licenseName", label: "许可协议名称", type: "string", help: "例如 CC BY-NC-SA 4.0" },
    { key: "licenseUrl", label: "许可协议链接", type: "string", help: "许可协议的完整 URL" },
    { key: "comment", label: "允许评论", type: "boolean", defaultValue: true },
    { key: "password", label: "访问密码", type: "string", help: "留空表示公开；填写后文章正文加密" },
    { key: "passwordHint", label: "密码提示", type: "string", help: "留空则不显示提示" },
  ],
  normalize: (values, isNew) => {
    const remove: string[] = [];
    // 清空密码时同步移除提示，避免残留无效信息
    if (values["password"] === undefined || values["password"] === "") {
      if (values["passwordHint"] !== undefined && values["passwordHint"] !== "") values["passwordHint"] = "";
      remove.push("passwordHint", "password");
      void isNew;
    }
    return { remove };
  },
  sortItems: (items) =>
    [...items].sort((a, b) => {
      const ra = draftRank(a);
      const rb = draftRank(b);
      if (ra !== rb) return ra - rb;
      const ao = Number(a.fields["order"]) || 0;
      const bo = Number(b.fields["order"]) || 0;
      if (ao !== bo) return bo - ao;
      return String(b.fields["published"] ?? "").localeCompare(String(a.fields["published"] ?? ""));
    }),
  yamlFormat: {
    quote: "none",
    arrayStyle: "flow",
    arrayItemQuote: "none",
    overrides: {
      password: { quote: "double" },
      passwordHint: { quote: "double" },
    },
  },
};
