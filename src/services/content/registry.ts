/**
 * 内容模块注册表：聚合全部 12 个内容模块，统一服务入口
 * 单/多文件 md 模块 → MultiFileContentService；notebooks → NotebooksService
 */
import type { ContentModuleDef } from "../../types/content.js";
import { notFound } from "../../utils/errors.js";
import { MultiFileContentService, type ContentService } from "./baseMultiFile.js";
import { NotebooksService, notebookFieldDef } from "./notebooksService.js";
import { aboutModule } from "./modules/about.js";
import { booksModule } from "./modules/books.js";
import { changelogModule } from "./modules/changelog.js";
import { websiteModule } from "./modules/website.js";
import { friendsModule } from "./modules/friends.js";
import { galleryModule } from "./modules/gallery.js";
import { gamesModule } from "./modules/games.js";
import { moviesModule } from "./modules/movies.js";
import { plansModule } from "./modules/plans.js";
import { postsModule } from "./modules/posts.js";
import { travelModule } from "./modules/travel.js";

/**
 * notebooks 特殊模块元数据（仅用于侧边栏排序与清单展示）
 * 实际读写走 NotebooksService，不实例化 MultiFileContentService
 */
export const notebooksModule: ContentModuleDef = {
  id: "notebooks",
  name: "笔记本",
  dir: "notebooks",
  isSingleFile: false,
  hasBody: true,
  titleField: "name",
  urlPrefix: "/notebooks/",
  fields: notebookFieldDef,
};

/** 全部内容模块元数据（含 notebooks；数组顺序 = 后台侧边栏顺序，调整顺序只需移动数组元素） */
export const contentModules: ContentModuleDef[] = [
  postsModule,      /** 文章 */
  galleryModule,    /** 相册 */
  notebooksModule,  /** 笔记 */
  booksModule,      /** 书架 */
  gamesModule,      /** 游戏 */
  moviesModule,     /** 影视 */
  friendsModule,    /** 友链 */
  plansModule,      /** 规划 */
  travelModule,     /** 旅行 */
  websiteModule,    /** 网站导航 */
  changelogModule,  /** 更新日志 */
  aboutModule,      /** 关于我 */
];

/** notebooks 特殊模块（目录 + _index.json + 笔记 md） */
export const notebooksService = new NotebooksService();

/** 已实例化的常规模块 service（懒加载缓存） */
const services = new Map<string, ContentService>();

/** 获取常规内容模块 service；未知模块抛 404 */
export function getContentService(moduleId: string): ContentService {
  if (isNotebooksModule(moduleId)) {
    throw notFound("notebooks 为特殊模块，请直接使用 notebooksService");
  }
  const def = contentModules.find((m) => m.id === moduleId);
  if (!def) {
    throw notFound(`未知内容模块：${moduleId}`);
  }
  let svc = services.get(moduleId);
  if (!svc) {
    svc = new MultiFileContentService(def);
    services.set(moduleId, svc);
  }
  return svc;
}

/** 判断是否为 notebooks 模块 */
export function isNotebooksModule(moduleId: string): boolean {
  return moduleId === notebooksService.id;
}

/** 模块清单（供前端渲染模块导航；顺序 = contentModules 数组顺序） */
export function listContentModules(): Array<{ id: string; name: string; isNotebooks: boolean; urlPrefix: string }> {
  return contentModules.map((m) => ({
    id: m.id,
    name: m.name,
    isNotebooks: m.id === notebooksService.id,
    urlPrefix: m.urlPrefix,
  }));
}
