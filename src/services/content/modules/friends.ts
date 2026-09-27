/**
 * friends 友联模块（docs/后端新增Demo/06_friends友联.md）
 * 路径：src/content/friends/*.md；无正文；imgurl/siteurl/weight/enabled 校验
 */
import type { ContentModuleDef } from "../../../types/content.js";

/** 友联条目 frontmatter 数据结构 */
export interface FriendData {
  title: string;
  imgurl: string;
  desc?: string;
  siteurl: string;
  tags?: string[];
  weight: number;
  enabled: boolean;
}

export const friendsModule: ContentModuleDef = {
  id: "friends",
  name: "友链",
  dir: "friends",
  urlPrefix: "/friends",
  isSingleFile: false,
  hasBody: false,
  titleField: "title",
  fields: [
    { key: "title", label: "站点名称", type: "string", required: true },
    { key: "imgurl", label: "头像链接", type: "url", required: true, media: true, help: "仅在线 http/https 资源" },
    { key: "desc", label: "站点简介", type: "string" },
    { key: "siteurl", label: "站点链接", type: "url", required: true },
    { key: "tags", label: "标签", type: "stringArray" },
    { key: "weight", label: "排序权重", type: "positiveInt", required: true, help: "数字越大排序越靠前" },
    { key: "enabled", label: "是否启用", type: "boolean", required: true, help: "false 时页面隐藏但数据保留" },
  ],
  // 与现有友链文件一致：全部双引号、tags flow 双引号
  yamlFormat: { quote: "double", arrayStyle: "flow", arrayItemQuote: "double" },
};
