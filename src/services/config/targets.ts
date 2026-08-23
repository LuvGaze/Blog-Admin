/**
 * 17 个站点配置 target 定义（docs/后端设置Demo/01-17）
 * 每个 target 对应 src/config/ 下一个 .ts 配置文件
 * - group：侧边栏分组（组内顺序 = 本数组顺序，调整顺序只需移动数组元素）
 * - mediaPaths：媒体预览字段（[*] 通配数组索引），仅标记不做上传
 * - htmlFile：附属非 TS 资源（footer 的 FooterConfig.html，虚拟 keyPath __raw_html）
 * - fixedSkipped：固定跳过提示（函数/预设等）
 */
import type { ConfigTargetDef } from "../tsAstService.js";
import { notFound } from "../../utils/errors.js";

export const configTargets: ConfigTargetDef[] = [
  {
    id: "site",
    name: "站点配置",
    file: "siteConfig.ts",
    exportNames: ["siteConfig"],
    mediaPaths: ["navbar.logo.value", "favicon[*].src"],
    group: "基础",
  },
  {
    id: "sponsor",
    name: "赞助配置",
    file: "sponsorConfig.ts",
    exportNames: ["sponsorConfig"],
    mediaPaths: ["methods[*].qrCode", "sponsors[*].avatar"],
    group: "互动功能",
  },
  {
    id: "sidebar",
    name: "侧边栏布局",
    file: "sidebarConfig.ts",
    exportNames: ["sidebarLayoutConfig"],
    mediaPaths: ["rightComponents[*].specificConfig.ad.image.src"],
    group: "页面布局",
  },
  {
    id: "profile",
    name: "个人资料",
    file: "profileConfig.ts",
    exportNames: ["profileConfig"],
    mediaPaths: ["avatar"],
    group: "基础",
  },
  {
    id: "plantuml",
    name: "PlantUML配置",
    file: "plantumlConfig.ts",
    exportNames: ["plantumlConfig"],
    group: "内容与文章",
  },
  {
    id: "pio",
    name: "看板娘配置",
    file: "pioConfig.ts",
    exportNames: ["spineModelConfig", "live2dWidgetConfig"],
    multiExport: true,
    mediaPaths: ["spineModelConfig.model.path", "live2dWidgetConfig.model[*].path"],
    group: "外观美化",
  },
  {
    id: "navbar",
    name: "导航栏配置",
    file: "navBarConfig.ts",
    exportNames: ["navBarSearchConfig"],
    fixedSkipped: [
      { keyPath: "LinkPresets", reason: "链接预设对象集合，后台不编辑" },
      { keyPath: "navBarConfig", reason: "由 getDynamicNavBarConfig 函数动态生成，后台不编辑" },
      { keyPath: "getDynamicNavBarConfig", reason: "函数体逻辑，后台不编辑" },
    ],
    saveNote: "导航栏链接由 siteConfig.pages 开关动态生成，如需调整请在「站点配置」修改对应开关",
    group: "基础",
  },
  {
    id: "music",
    name: "音乐播放器配置",
    file: "musicConfig.ts",
    exportNames: ["musicPlayerConfig"],
    mediaPaths: ["local.playlist[*].cover"],
    group: "页面布局",
  },
  {
    id: "license",
    name: "版权许可配置",
    file: "licenseConfig.ts",
    exportNames: ["licenseConfig"],
    group: "基础",
  },
  {
    id: "footer",
    name: "页脚配置",
    file: "footerConfig.ts",
    exportNames: ["footerConfig"],
    htmlFile: "FooterConfig.html",
    saveNote: "页脚 HTML 内容直接编辑 FooterConfig.html，保存后需重新 build 生效",
    group: "页面布局",
  },
  {
    id: "expressiveCode",
    name: "代码块配置",
    file: "expressiveCodeConfig.ts",
    exportNames: ["expressiveCodeConfig"],
    saveNote: "代码块配置修改后必须重启 Astro 开发服务器才生效",
    group: "内容与文章",
  },
  {
    id: "sakura",
    name: "动画特效配置",
    file: "effectsConfig.ts",
    exportNames: ["sakuraConfig"],
    group: "外观美化",
  },
  {
    id: "coverImage",
    name: "文章封面配置",
    file: "coverImageConfig.ts",
    exportNames: ["coverImageConfig"],
    mediaPaths: ["randomCoverImage.fallback"],
    group: "内容与文章",
  },
  {
    id: "comment",
    name: "评论系统配置",
    file: "commentConfig.ts",
    exportNames: ["commentConfig"],
    group: "互动功能",
  },
  {
    id: "backgroundWallpaper",
    name: "背景壁纸配置",
    file: "backgroundWallpaper.ts",
    exportNames: ["backgroundWallpaper"],
    saveNote: "壁纸修改后刷新页面即可生效，无需重启服务",
    group: "外观美化",
  },
  {
    id: "announcement",
    name: "公告配置",
    file: "announcementConfig.ts",
    exportNames: ["announcementConfig"],
    group: "基础",
  },
  {
    id: "analytics",
    name: "统计分析配置",
    file: "analyticsConfig.ts",
    exportNames: ["analyticsConfig"],
    group: "互动功能",
  },
];

/** target 标识 → 定义；未知 target 抛 404 */
export function getConfigTarget(targetId: string): ConfigTargetDef {
  const def = configTargets.find((t) => t.id === targetId);
  if (!def) {
    throw notFound(`未知配置 target：${targetId}`);
  }
  return def;
}
