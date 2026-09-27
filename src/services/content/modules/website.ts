/**
 * website 网站导航模块（docs/后端新增Demo/05_daohang网站导航.md）
 * 路径：src/content/website/*.md；无正文；url/order 校验
 */
import type { ContentModuleDef } from "../../../types/content.js";

/** 导航条目 frontmatter 数据结构 */
export interface WebsiteData {
  name: string;
  url: string;
  icon?: string;
  category: string;
  order: number;
  description?: string;
}

export const websiteModule: ContentModuleDef = {
  id: "website",
  name: "网站导航",
  dir: "website",
  urlPrefix: "/website/",
  isSingleFile: false,
  hasBody: false,
  titleField: "name",
  fields: [
    { key: "name", label: "网站名称", type: "string", required: true },
    { key: "url", label: "跳转链接", type: "url", required: true, help: "完整 http/https 地址" },
    { key: "icon", label: "图标", type: "url", media: true, help: "http(s) 图片链接（如站点 favicon），前端按图片渲染" },
    { key: "category", label: "导航分类", type: "string", required: true, help: "用于分组展示" },
    { key: "order", label: "排序权重", type: "positiveInt", required: true, help: "数字越小展示越靠前" },
    { key: "description", label: "网站描述", type: "string" },
  ],
  // 与现有导航文件一致：全部无引号
  yamlFormat: { quote: "none", arrayStyle: "flow", arrayItemQuote: "none" },
};
