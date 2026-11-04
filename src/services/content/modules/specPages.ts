/**
 * spec 页面：src/content/spec
 * friends.mdx / guestbook.md 带 frontmatter；schema 为空对象，因此字段按需编辑、其余键原样保留。
 */
import type { ContentModuleDef } from "../../../types/content.js";

export const friendsSpecModule: ContentModuleDef = {
  id: "specFriends",
  name: "友链页文案",
  dir: "spec",
  isSingleFile: true,
  ext: ".mdx",
  fileName: () => "friends.mdx",
  hasBody: true,
  titleField: "title",
  urlPrefix: "/friends/",
  fields: [
    { key: "title", label: "标题", type: "string", required: true },
    { key: "description", label: "描述", type: "textarea" },
  ],
  yamlFormat: { quote: "double", arrayStyle: "flow", arrayItemQuote: "double" },
};

export const guestbookSpecModule: ContentModuleDef = {
  id: "guestbook",
  name: "留言板文案",
  dir: "spec",
  isSingleFile: true,
  ext: ".md",
  fileName: () => "guestbook.md",
  hasBody: true,
  titleField: "title",
  urlPrefix: "/guestbook/",
  fields: [
    { key: "title", label: "标题", type: "string", required: true },
    { key: "description", label: "描述", type: "textarea" },
  ],
  yamlFormat: { quote: "double", arrayStyle: "flow", arrayItemQuote: "double" },
};
