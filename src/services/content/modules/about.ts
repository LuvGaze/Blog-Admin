/**
 * 关于页：src/content/spec/about.mdx（无 frontmatter）
 * MDX 中可使用 JSX/组件，后台仅按纯文本编辑正文。
 */
import type { ContentModuleDef } from "../../../types/content.js";

export const aboutModule: ContentModuleDef = {
  id: "about",
  name: "关于页",
  dir: "spec",
  isSingleFile: true,
  ext: ".mdx",
  fileName: () => "about.mdx",
  noFrontmatter: true,
  hasBody: true,
  titleField: "title",
  urlPrefix: "/about/",
  fields: [],
};
