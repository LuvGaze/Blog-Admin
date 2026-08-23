# Blog Admin · 博客管理后台

博客项目（Astro 前端）的独立后端管理工具：通过浏览器对博客内容（Markdown/YAML）与站点配置（TypeScript）进行可视化增删改查，支持备份与恢复。

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

# 3. 启动开发服务（默认端口 3344）
pnpm dev
```

打开 `http://localhost:3344` 访问后台，使用 `.env` 中配置的 `ADMIN_PASSWORD` 登录。

### 环境变量（admin/.env）

<table>
  <thead>
    <tr><th>变量</th><th>说明</th><th>默认值</th></tr>
  </thead>
  <tbody>
    <tr><td><code>PORT</code></td><td>后台服务端口</td><td><code>3344</code></td></tr>
    <tr><td><code>ADMIN_PASSWORD</code></td><td>管理密码（登录鉴权）</td><td>无（必填）</td></tr>
    <tr><td><code>ADMIN_SECRET</code></td><td>Token 签名密钥，留空则每次启动随机生成</td><td>空</td></tr>
    <tr><td><code>BLOG_BASE_URL</code></td><td>博客站点地址（后台「预览」按钮跳转用）</td><td><code>http://localhost:4321</code></td></tr>
  </tbody>
</table>

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

<table>
  <thead>
    <tr><th>模块 ID</th><th>名称</th><th>目录</th><th>预览前缀</th><th>说明</th></tr>
  </thead>
  <tbody>
    <tr><td><code>books</code></td><td>书架</td><td><code>books/</code></td><td><code>/books/</code></td><td>书籍条目（category=book）</td></tr>
    <tr><td><code>games</code></td><td>游戏</td><td><code>games/</code></td><td><code>/games/</code></td><td>游戏条目（category=game）</td></tr>
    <tr><td><code>movies</code></td><td>影视</td><td><code>movies/</code></td><td><code>/movies/</code></td><td>影视条目（category=real）</td></tr>
    <tr><td><code>changelog</code></td><td>更新日志</td><td><code>changelog/</code></td><td><code>/changelog/</code></td><td>版本日志，列表按日期倒序</td></tr>
    <tr><td><code>website</code></td><td>网站导航</td><td><code>website/</code></td><td><code>/website/</code></td><td>友链/常用网站导航</td></tr>
    <tr><td><code>friends</code></td><td>友链</td><td><code>friends/</code></td><td><code>/friends/</code></td><td>友情链接</td></tr>
    <tr><td><code>gallery</code></td><td>相册</td><td><code>gallery/</code></td><td><code>/gallery/</code></td><td>相册集</td></tr>
    <tr><td><code>plans</code></td><td>日常规划</td><td><code>plans/</code></td><td><code>/life/routines/</code></td><td>规划条目</td></tr>
    <tr><td><code>posts</code></td><td>文章</td><td><code>posts/</code></td><td><code>/posts/</code></td><td>博客文章</td></tr>
    <tr><td><code>travel</code></td><td>足迹</td><td><code>travel/</code></td><td><code>/travel/</code></td><td>到访地点（visitCount 正整数校验）</td></tr>
    <tr><td><code>about</code></td><td>关于</td><td><code>spec/about.md</code></td><td><code>/about/</code></td><td>单文件正文</td></tr>
    <tr><td><code>notebooks</code></td><td>笔记本</td><td><code>notebooks/</code></td><td><code>/notebooks/</code></td><td>目录 + <code>_index.json</code> + 笔记（专用服务）</td></tr>
  </tbody>
</table>

新增/修改模块：在 `src/services/content/modules/` 下创建模块定义文件，并在 `registry.ts` 中注册即可。侧边栏模块顺序 = `registry.ts` 中 `contentModules` 数组顺序（notebooks 已包含在内），调整顺序只需移动数组元素。

## API 概览

<table>
  <thead>
    <tr><th>方法</th><th>路径</th><th>说明</th></tr>
  </thead>
  <tbody>
    <tr><td><code>POST</code></td><td><code>/api/auth/login</code></td><td>登录，返回 Bearer Token</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/health</code></td><td>健康检查（含博客地址信息）</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/modules</code></td><td>内容模块清单</td></tr>
    <tr><td><code>GET / POST</code></td><td><code>/api/content/:module</code></td><td>列表 / 新建条目</td></tr>
    <tr><td><code>GET / PUT / DELETE</code></td><td><code>/api/content/:module/:id</code></td><td>读取 / 保存 / 删除条目</td></tr>
    <tr><td><code>GET / POST</code></td><td><code>/api/content/:module/backups</code></td><td>备份列表 / 手动创建整模块备份</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/content/:module/restore</code></td><td>恢复备份（文件备份 / 目录快照）</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/config</code></td><td>配置目标清单</td></tr>
    <tr><td><code>GET / POST</code></td><td><code>/api/config/:id</code></td><td>读取 / 保存配置</td></tr>
  </tbody>
</table>

所有写操作与读取敏感接口均需请求头 `Authorization: Bearer <token>`。

## 备份与恢复

- **自动备份**：更新 / 删除条目时自动备份（新建不备份），默认保留最新 5 份。
- **手动备份**：后台「备份与恢复」弹窗顶部点击「立即备份」，或调用 `POST /api/content/:module/backups`，为整个模块创建目录快照。
- **备份类型**：文件备份 `原文件名_时间戳.bak.md`；目录快照 `目录名_时间戳.bak/`（整个模块 / 整个笔记本目录）。列表按时间倒序展示，并标记类型。
- **恢复**：后台点击「恢复」按钮，或调用 `POST /api/content/:module/restore`（body `{ backupName }`），覆盖还原同名源文件 / 整个源目录。恢复前请确认，操作会覆盖当前内容。
- **notebooks 特殊处理**：备份列表同时包含笔记本目录快照与单篇笔记文件备份；单篇笔记在笔记详情页通过「恢复笔记」还原到对应笔记本。
- 备份归档存放于 `admin/backup/content/{模块ID}/`，可手动清理。

## 注意事项

- 依赖博客项目目录结构：`admin/` 必须与博客项目根目录同级（`admin/../src/content`）。
- 修改内容后博客需重启 `astro dev` 或重新构建才能看到最新数据（Astro 内容集合缓存）。
- 备份默认存放在 `admin/backup/`，可手动清理。
- 本项目使用 `pnpm@9.14.4`，`pnpm-workspace.yaml` 需保留 `packages` 与 `onlyBuiltDependencies` 字段，否则依赖安装会失败。