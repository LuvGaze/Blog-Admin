# Blog Admin · 博客管理后台

> 项目专属博客 -> [Blog](https://github.com/LuvGaze/Blog)

Blog博客项目的独立后端管理工具：通过浏览器对博客内容（Markdown/YAML）与站点配置（TypeScript）进行可视化增删改查，支持备份与恢复。

> 服务运行在 `admin/` 目录下，直接读写上级博客项目 `src/content/` 与 `src/config/` 中的真实文件。

## 技术栈

- **运行时**：Node.js ≥ 18（推荐 20+）
- **包管理器**：pnpm（本仓库固定 `pnpm@9.14.4`）
- **服务端**：Express 4 + TypeScript，`tsx` 直接运行 TS
- **解析器**：`yaml-ast-parser`（YAML 结构编辑）、内置 TS AST 编辑器（配置项编辑）
- **前端**：原生 HTML/CSS/JS（无构建步骤），牛皮纸手绘主题

## 快速开始

```bash
# 1. 安装依赖（在 admin 目录下）
cd admin
pnpm install

# 2. 配置环境变量
cp .env.example .env   # 然后编辑 .env

# 3. 启动开发服务（默认端口 8899）
pnpm dev
```

打开 `http://localhost:8899` 访问后台，使用 `.env` 中配置的 `ADMIN_PASSWORD` 登录。

### 环境变量（admin/.env）

| 变量 | 说明 | 默认值                     |
| --- | --- |-------------------------|
| `PORT` | 后台服务端口 | `8899`                  |
| `ADMIN_PASSWORD` | 管理密码（登录鉴权） | 无（必填）                   |
| `ADMIN_SECRET` | Token 签名密钥，留空则每次启动随机生成 | 空                       |
| `BLOG_BASE_URL` | 博客站点地址（后台「预览」按钮跳转用） | `http://localhost:4321` |

> `ADMIN_PASSWORD` 未配置时优先读取项目根目录 `.env` 中的同名变量（兼容约定，只读不写）。

## 可用脚本

```bash
pnpm dev            # 开发模式（tsx watch 热重载）
pnpm start          # 直接启动
pnpm build          # tsc 编译到 dist/
pnpm start:prod     # 运行编译产物 node dist/server.js
pnpm type-check     # 仅类型检查
pnpm smoke          # 冒烟测试（scripts/smoke-test.mjs）
```

## 目录结构

```
admin/
├── public/                 # 前端静态资源（原生页面，无构建）
│   ├── index.html          # 单页入口：登录 / 内容管理 / 配置管理
│   ├── css/kraft.css       # 牛皮纸主题样式
│   ├── js/app.js           # 前端逻辑（API 调用、表单渲染、预览跳转）
│   ├── read.md             # 可选：未选择模块/配置时右侧面板渲染的欢迎内容（Markdown，内置渲染器）
│   └── read.html           # 可选：同上（HTML 版本；与 read.md 同名时优先渲染 read.md。经 iframe 独立加载，内部 <style>/<script> 不会污染后台全局）
├── src/
│   ├── app.ts              # Express 应用装配（静态资源 + API 路由）
│   ├── server.ts           # 启动入口
│   ├── config/             # 环境变量与路径常量
│   ├── controllers/        # auth / content / config 路由控制器
│   ├── middleware/auth.ts  # Bearer Token 鉴权中间件
│   ├── services/
│   │   ├── content/        # 内容模块：注册表 + 通用多文件服务 + notebooks 专用
│   │   │   ├── registry.ts       # 模块注册与 service 获取
│   │   │   ├── baseMultiFile.ts  # 通用 md/md json 模块服务（列表/读取/新建/保存/删除/备份）
│   │   │   ├── notebooksService.ts
│   │   │   └── modules/          # 各模块字段定义（books/games/movies/changelog/website/friends/gallery/plans/posts/travel/about）
│   │   ├── config/         # 配置目标注册（tsConfig / profileConfig / FooterConfig ...）
│   │   ├── tsAstService.ts # TS 配置文件的 AST 编辑
│   │   └── yamlService.ts  # YAML frontmatter 解析与归一化
│   ├── types/              # 内容模块与公共类型定义
│   ├── utils/              # 文件读写 / 备份 / 校验 / 日志 / 错误
│   └── config/env.ts       # 端口、密码、token、博客地址
├── scripts/smoke-test.mjs  # 冒烟测试
├── backup/                 # 备份归档（运行时自动创建）
├── .env.example
├── pnpm-workspace.yaml     # 固定 workspace 与 esbuild 构建许可
├── WORKPLAN.md             # 模块设计文档
└── package.json            # 脚本与依赖
```

## 内容模块

后台「内容管理」支持以下模块（数据源均为博客 `src/content/` 下的真实文件）：

| 模块 ID | 名称 | 目录 | 预览前缀 | 说明 |
| --- | --- | --- | --- | --- |
| books | 书架 | `books/` | `/books/` | 书籍条目（category=book） |
| games | 游戏 | `games/` | `/games/` | 游戏条目（category=game） |
| movies | 影视 | `movies/` | `/movies/` | 影视条目（category=real） |
| changelog | 更新日志 | `changelog/` | `/changelog/` | 版本日志，列表按日期倒序 |
| website | 网站导航 | `website/` | `/website/` | 友链/常用网站导航 |
| friends | 友链 | `friends/` | `/friends/` | 友情链接 |
| gallery | 相册 | `gallery/` | `/gallery/` | 相册集 |
| plans | 日常规划 | `plans/` | `/life/routines/` | 规划条目 |
| posts | 文章 | `posts/` | `/posts/` | 博客文章 |
| travel | 足迹 | `travel/` | `/travel/` | 到访地点（visitCount 正整数校验） |
| about | 关于 | `spec/about.md` | `/about/` | 单文件正文 |
| notebooks | 笔记本 | `notebooks/` | `/notebooks/` | 目录 + `_index.json` + 笔记（专用服务） |

新增/修改模块：在 `src/services/content/modules/` 下创建模块定义文件，并在 `registry.ts` 中注册即可。侧边栏模块顺序 = `registry.ts` 中 `contentModules` 数组顺序（notebooks 已包含在内），调整顺序只需移动数组元素。

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 登录，返回 Bearer Token |
| GET | `/api/health` | 健康检查（含博客地址信息） |
| GET | `/api/modules` | 内容模块清单 |
| GET/POST | `/api/content/:module` | 列表 / 新建条目 |
| GET/PUT/DELETE | `/api/content/:module/:id` | 读取 / 保存 / 删除条目 |
| GET/POST | `/api/content/:module/backups` | 备份列表 / 手动创建整模块备份 |
| POST | `/api/content/:module/restore` | 恢复备份（文件备份 / 目录快照） |
| GET | `/api/config` | 配置目标清单 |
| GET/POST | `/api/config/:id` | 读取 / 保存配置 |

所有写操作与读取敏感接口均需请求头 `Authorization: Bearer <token>`。

## 备份与恢复

- **自动备份**：更新 / 删除条目时自动备份（新建不备份），默认保留最新 5 份。
- **手动备份**：后台「备份与恢复」弹窗顶部点击「立即备份」，或调用 `POST /api/content/:module/backups`，为整个模块创建目录快照。
- **备份类型**：文件备份 `原文件名_时间戳.bak.md`；目录快照 `目录名_时间戳.bak/`（整个模块 / 整个笔记本目录）。列表按时间倒序展示，并标记类型。
- **恢复**：后台点击「恢复」按钮，或调用 `POST /api/content/:module/restore`（body `{ backupName }`），覆盖还原同名源文件 / 整个源目录。恢复前请确认，操作会覆盖当前内容。
- **notebooks 特殊处理**：备份列表同时包含笔记本目录快照与单篇笔记文件备份；单篇笔记在笔记详情页通过「恢复笔记」还原到对应笔记本。
- 备份归档存放于 `admin/backup/content/{模块ID}/`，可手动清理。

## 注意事项

- 依赖博客项目目录结构：`admin/` 应与博客项目根目录同级。
- 修改内容后博客需重启 `astro dev` 或重新构建才能看到最新数据（Astro 内容集合缓存）。
- 备份默认存放在 `admin/backup/`，可手动清理。
- 本项目使用 `pnpm@9.14.4`，`pnpm-workspace.yaml` 需保留 `packages` 与 `onlyBuiltDependencies` 字段，否则依赖安装会失败。
