/**
 * about 关于我模块（docs/后端新增Demo/12_about关于我.md）
 * 路径：src/content/spec/about.md；单文件；无 frontmatter；仅 update / restore
 * 保存时若出现 YAML frontmatter 头部直接剔除
 */
import type { ContentModuleDef } from "../../../types/content.js";

export const aboutModule: ContentModuleDef = {
  id: "about",
  name: "关于我",
  dir: "spec",
  urlPrefix: "/about",
  isSingleFile: true,
  hasBody: true,
  noFrontmatter: true,
  titleField: "title",
  fields: [],
  fileName: () => "about.md",
};
