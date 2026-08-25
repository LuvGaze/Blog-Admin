/* ============================================================
   博客管理后台前端（admin/public）
   - 登录鉴权：POST /api/auth/login → Bearer token（localStorage）
   - 内容管理：12 个内容模块，FieldDef 动态渲染表单（YAML 引号保留写回由后端保证）
   - 配置管理：17 个配置 target，TS-AST 字段按 keyPath 折叠渲染、数组增删拖拽、媒体预览
   - 备份恢复：模块级备份列表 + 恢复
   ============================================================ */
"use strict";

/* ─────────── 全局状态 ─────────── */
const state = {
  token: null,
  modules: [],            // GET /api/modules
  module: null,           // 当前内容模块元数据
  nb: null,               // 当前笔记本（详情视图）
  note: null,             // 当前正在编辑的笔记
  targets: [],            // GET /api/config
  target: null,           // 当前配置 target 读取结果
  changes: new Map(),     // keyPath -> {value, hasQuote}
};

/* ─────────── 工具函数 ─────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("#toast-root").appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

/* ─────────── API 封装 ─────────── */
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let res;
  try {
    res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new Error("网络请求失败，请确认后台服务已启动");
  }
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 响应 */ }
  if (res.status === 401 && !path.includes("/auth/")) {
    logout("登录已过期，请重新登录");
    throw new Error("登录已过期");
  }
  if (!res.ok) {
    throw new Error(data?.error || `请求失败（HTTP ${res.status}）`);
  }
  return data;
}

/* ─────────── 弹窗 ─────────── */
function openModal(title, bodyHtml, footHtml = "") {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHtml;
  $("#modal-foot").innerHTML = footHtml;
  $("#modal-mask").classList.remove("hidden");
}
function closeModal() {
  $("#modal-mask").classList.add("hidden");
}
function confirmModal(title, message, onOk) {
  openModal(
    title,
    `<p style="font-size:15px;line-height:1.9;">${message}</p>`,
    `<button class="btn btn-sm" data-close>取消</button>
     <button class="btn btn-sm btn-danger" data-ok>确定</button>`,
  );
  $("#modal-foot [data-close]").onclick = closeModal;
  $("#modal-foot [data-ok]").onclick = () => { closeModal(); onOk(); };
}

/* ─────────── 视图切换 ─────────── */
function showLogin(msg = "") {
  $("#view-main").classList.add("hidden");
  $("#view-login").classList.remove("hidden");
  $("#login-hint").textContent = msg;
}
function showMain() {
  $("#view-login").classList.add("hidden");
  $("#view-main").classList.remove("hidden");
}
function switchTab(name) {
  $$(".appbar-tabs a[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === name));
  $("#tab-content").classList.toggle("hidden", name !== "content");
  $("#tab-config").classList.toggle("hidden", name !== "config");
}
function logout(msg = "") {
  state.token = null;
  localStorage.removeItem("blog_admin_token");
  showLogin(msg);
}

/* ─────────── 登录 ─────────── */
async function doLogin(password) {
  const data = await api("/api/auth/login", { method: "POST", body: { password } });
  state.token = data.token;
  localStorage.setItem("blog_admin_token", JSON.stringify({ token: data.token, expiresAt: data.expiresAt }));
  showMain();
  toast("登录成功，欢迎回来 ✏️", "ok");
  initMain();
}

/* ─────────── 内容管理：模块导航 ─────────── */
async function loadModules() {
  const data = await api("/api/modules");
  state.modules = data.modules;
  const nav = $("#module-nav");
  nav.innerHTML = state.modules
    .map(
      (m, i) => `<button class="nav-item" data-module="${esc(m.id)}">
        <span class="no">${i + 1}</span><span>${esc(m.name)}</span>
      </button>`,
    )
    .join("");
  $$(".nav-item", nav).forEach((b) => (b.onclick = () => selectModule(b.dataset.module)));
  $("#module-count").textContent = `共 ${state.modules.length} 个`;
}

async function selectModule(id) {
  state.module = state.modules.find((m) => m.id === id) || null;
  state.nb = null;
  state.note = null;
  $$("#module-nav .nav-item").forEach((b) => b.classList.toggle("active", b.dataset.module === id));
  if (!state.module) return;
  await renderModuleList();
}

/* ─────────── 内容管理：列表 ─────────── */
function setPanelTitle(text) {
  $("#content-panel-title").textContent = text;
}
function setPanelButtons(showCreate, showBackups) {
  $("#btn-create").classList.toggle("hidden", !showCreate);
  $("#btn-backups").classList.toggle("hidden", !showBackups);
}

async function renderModuleList() {
  const m = state.module;
  setPanelTitle(`${m.name} · 列表`);
  setPanelButtons(!m.isSingleFile, true);
  $("#btn-create").onclick = openCreate;
  $("#btn-backups").onclick = openBackups;
  const data = await api(`/api/content/${m.id}`);
  const panel = $("#content-panel");
  if (m.isNotebooks) {
    panel.innerHTML = renderNotebooks(data);
    bindNotebookCards(panel);
    return;
  }
  if (!data.length) {
    panel.innerHTML = `<div class="empty-hint">这里空空如也 ~ 点击右上角「＋ 新建」添加第一篇</div>`;
    return;
  }
  panel.innerHTML = renderModuleCards(m, data);
  bindCardGrid(panel);
}

/* ─────────── 内容管理：模块专属卡片陈列 ─────────── */

/** 随机封面 API 列表（与 src/config/coverImageConfig.ts 保持一致），无图条目封面兜底 */
const RANDOM_COVER_APIS = [
  "https://t.alcy.cc/pc",
  "https://www.dmoe.cc/random.php",
  "https://uapis.cn/api/v1/random/image?category=acg&type=pc",
  "https://t.alcy.cc/fj",
];

/** 状态文本映射（页面显示文字，md 文件仍存 1~5 数字） */
const CARD_STATUS_TEXT = {
  movies: { 1: "想看", 2: "看过", 3: "在看", 4: "搁置", 5: "抛弃" },
  games: { 1: "想玩", 2: "玩过", 3: "在玩", 4: "搁置", 5: "抛弃" },
  books: { 1: "想读", 2: "读过", 3: "在读", 4: "搁置", 5: "抛弃" },
};

/** 更新日志类型文本 */
const CHANGELOG_TYPE_TEXT = {
  feature: "新增功能",
  fix: "问题修复",
  optimize: "性能优化",
  docs: "文档更新",
  refactor: "代码重构",
};

/** 影视子分类文本 */
const MOVIE_SUBCATEGORY_TEXT = {
  movie: "电影",
  tv: "电视剧",
  anime: "动漫",
  documentary: "纪录片",
};

/** 条目封面 URL：无图 / image="api" 返回空（由 coverHtml 用随机封面 API 兜底） */
function itemCover(m, it) {
  const f = it.fields || {};
  if (m.id === "gallery") return Array.isArray(f.images) && f.images[0] ? f.images[0] : "";
  if (m.id === "friends") return typeof f.imgurl === "string" ? f.imgurl : "";
  const img = f.image;
  if (typeof img === "string" && img.trim() && img.trim() !== "api") return img.trim();
  return "";
}

/** 封面容器：有图显示图；无图或加载失败时露出模块专属 emoji 占位 */
function coverHtml(m, it, cls) {
  const src = itemCover(m, it) || RANDOM_COVER_APIS[0];
  return `<div class="cover ${cls}"><img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()"></div>`;
}

/** 卡片通用操作按钮 */
function cardActions(it) {
  return `<div class="card-actions">
    <button class="btn btn-sm mini" data-preview="${esc(it.id)}">预览</button>
    <button class="btn btn-sm btn-info" data-edit="${esc(it.id)}">编辑</button>
    <button class="btn btn-sm btn-danger" data-del="${esc(it.id)}">删除</button>
  </div>`;
}

function renderModuleCards(m, data) {
  switch (m.id) {
    case "posts": return renderPostCards(data);
    case "gallery": return renderGalleryCards(data);
    case "books": return renderBookCards(data);
    case "games": return renderGameCards(data);
    case "movies": return renderMovieCards(data);
    case "friends": return renderFriendCards(data);
    case "plans": return renderPlanCards(data);
    case "travel": return renderTravelCards(data);
    case "website": return renderWebsiteCards(data);
    case "changelog": return renderChangelogCards(data);
    case "about": return renderAboutCard(data);
    default: return renderFallbackList(data);
  }
}

/** 文章：横版信纸卡片，置顶/加密/草稿徽章；排序 草稿 > 置顶 > 其他，同类按发布日期倒序 */
function postPriority(it) {
  const f = it.fields || {};
  if (f.draft) return 0;
  if (f.pinned) return 1;
  return 2;
}

function renderPostCards(data) {
  const ordered = data
    .slice()
    .sort((a, b) => {
      const p = postPriority(a) - postPriority(b);
      if (p !== 0) return p;
      return String(b.fields?.published || "").localeCompare(String(a.fields?.published || ""));
    });
  return `<div class="mod-grid post-grid">${ordered
    .map((it) => {
      const f = it.fields || {};
      const badges = [];
      if (f.pinned) badges.push(`<span class="tag tag-pin">📌 置顶</span>`);
      // 加密文章可能在 frontmatter 中只写 password（未写 encrypted: true），两者都判断
      if (f.encrypted || (f.password && String(f.password).trim() !== "")) badges.push(`<span class="tag tag-lock">🔒 加密</span>`);
      if (f.draft) badges.push(`<span class="tag tag-draft">🕸 草稿</span>`);
      const meta = [f.published ? `📅 ${esc(String(f.published))}` : ""].filter(Boolean);
      return `<div class="post-card" data-open="${esc(it.id)}">
        ${coverHtml({ id: "posts" }, it, "cover-post")}
        <div class="pc-body">
          <div class="pc-title">${esc(it.title)}${it.error ? `<span class="badge">⚠</span>` : ""}</div>
          <div class="pc-meta">${meta.join(" · ")}${f.category ? ` · <span class="tag tag-cat">${esc(f.category)}</span>` : ""}</div>
          ${f.description ? `<div class="pc-desc">${esc(f.description)}</div>` : ""}
          ${badges.length ? `<div class="pc-badges">${badges.join("")}</div>` : ""}
        </div>
        ${cardActions(it)}
      </div>`;
    })
    .join("")}</div>`;
}

/** 相册：黑框相纸卡片 */
function renderGalleryCards(data) {
  return `<div class="mod-grid gallery-grid">${data
    .map((it) => {
      const f = it.fields || {};
      const meta = [`${Array.isArray(f.images) ? f.images.length : 0} 张图`];
      if (f.date) meta.push(`📅 ${esc(String(f.date))}`);
      if (f.location) meta.push(`📍 ${esc(f.location)}`);
      return `<div class="gallery-card" data-open="${esc(it.id)}">
        ${coverHtml({ id: "gallery" }, it, "cover-sq")}
        <div class="gc-name">${esc(it.title)}${f.password ? ` <span class="tag tag-lock">🔒</span>` : ""}</div>
        <div class="gc-meta">${meta.join(" · ")}</div>
        ${cardActions(it)}
      </div>`;
    })
    .join("")}</div>`;
}

/** 书架：书本竖版卡片，书脊压边 */
function renderBookCards(data) {
  const sm = CARD_STATUS_TEXT.books;
  return `<div class="mod-grid book-grid">${data
    .map((it) => {
      const f = it.fields || {};
      const meta = [];
      if (f.status !== undefined && f.status !== null && sm[f.status]) meta.push(`<span class="card-badge">${sm[f.status]}</span>`);
      if (f.score !== undefined && f.score !== null && f.score !== "") meta.push(`⭐ ${esc(f.score)}`);
      return `<div class="book-card" data-open="${esc(it.id)}">
        ${coverHtml({ id: "books" }, it, "cover-book")}
        <div class="bc-title">${esc(it.title)}${it.error ? `<span class="badge">⚠</span>` : ""}</div>
        <div class="bc-meta">${meta.join(" · ")}</div>
        ${cardActions(it)}
      </div>`;
    })
    .join("")}</div>`;
}

/** 游戏：复古卡带风格 */
function renderGameCards(data) {
  const sm = CARD_STATUS_TEXT.games;
  return `<div class="mod-grid game-grid">${data
    .map((it) => {
      const f = it.fields || {};
      const meta = [];
      if (f.status !== undefined && f.status !== null && sm[f.status]) meta.push(`<span class="card-badge">${sm[f.status]}</span>`);
      if (f.score !== undefined && f.score !== null && f.score !== "") meta.push(`⭐ ${esc(f.score)}`);
      return `<div class="game-card" data-open="${esc(it.id)}">
        ${coverHtml({ id: "games" }, it, "cover-sq")}
        <div class="gmc-title">${esc(it.title)}${it.error ? `<span class="badge">⚠</span>` : ""}</div>
        <div class="gmc-meta">${meta.join(" · ")}</div>
        ${cardActions(it)}
      </div>`;
    })
    .join("")}</div>`;
}

/** 影视：胶片海报风格，顶部显示子分类 */
function renderMovieCards(data) {
  const sm = CARD_STATUS_TEXT.movies;
  return `<div class="mod-grid movie-grid">${data
    .map((it) => {
      const f = it.fields || {};
      const meta = [];
      if (f.status !== undefined && f.status !== null && sm[f.status]) meta.push(`<span class="card-badge">${sm[f.status]}</span>`);
      if (f.score !== undefined && f.score !== null && f.score !== "") meta.push(`⭐ ${esc(f.score)}`);
      return `<div class="movie-card" data-open="${esc(it.id)}">
        <div class="mvc-type">${f.subcategory ? esc(MOVIE_SUBCATEGORY_TEXT[f.subcategory] || f.subcategory) : "影视"}</div>
        ${coverHtml({ id: "movies" }, it, "cover-sq")}
        <div class="mvc-title">${esc(it.title)}${it.error ? `<span class="badge">⚠</span>` : ""}</div>
        <div class="mvc-meta">${meta.join(" · ")}</div>
        ${cardActions(it)}
      </div>`;
    })
    .join("")}</div>`;
}

/** 友链：名片风格，圆形头像；按权重降序（越大越靠前） */
function renderFriendCards(data) {
  const ordered = data.slice().sort((a, b) => (b.fields?.weight ?? 0) - (a.fields?.weight ?? 0));
  return `<div class="mod-grid friend-grid">${ordered
    .map((it) => {
      const f = it.fields || {};
      const enabled = f.enabled !== false;
      return `<div class="friend-card" data-open="${esc(it.id)}">
        <div class="fc-avatar">${itemCover({ id: "friends" }, it)
          ? `<img src="${esc(itemCover({ id: "friends" }, it))}" alt="" loading="lazy" onerror="this.remove()">`
          : ""}</div>
        <div class="fc-name">${esc(it.title)}${it.error ? `<span class="badge">⚠</span>` : ""}</div>
        <div class="fc-desc">${f.desc ? esc(f.desc) : "（暂无简介）"}</div>
        <div class="fc-meta">${enabled ? '<span class="card-badge ok">✅ 启用</span>' : '<span class="card-badge off">⏸ 停用</span>'}${f.weight !== undefined ? ` · 权重 ${esc(f.weight)}` : ""}</div>
        ${cardActions(it)}
      </div>`;
    })
    .join("")}</div>`;
}

/** 规划：胶带便签纸卡片 */
function renderPlanCards(data) {
  return `<div class="mod-grid plan-grid">${data
    .map((it) => {
      const f = it.fields || {};
      return `<div class="plan-card" data-open="${esc(it.id)}">
        <div class="plc-icon">${f.cover ? `<img src="${esc(f.cover)}" alt="" loading="lazy" onerror="this.remove()">` : "📋"}</div>
        <div class="plc-name">${esc(it.title)}${it.error ? `<span class="badge">⚠</span>` : ""}</div>
        ${f.description ? `<div class="plc-desc">${esc(f.description)}</div>` : ""}
        <div class="plc-meta">${f.time ? `🕐 ${esc(f.time)}` : ""}${f.updated ? ` · 更新 ${esc(f.updated)}` : ""}</div>
        ${cardActions(it)}
      </div>`;
    })
    .join("")}</div>`;
}

/** 足迹：旅行明信片风格，邮戳元素 */
function renderTravelCards(data) {
  return `<div class="mod-grid travel-grid">${data
    .map((it) => {
      const f = it.fields || {};
      return `<div class="travel-card" data-open="${esc(it.id)}">
        <div class="tvc-stamp">✈</div>
        <div class="tvc-place">${esc(it.title)}${it.error ? `<span class="badge">⚠</span>` : ""}</div>
        <div class="tvc-loc">📍 ${f.province ? esc(f.province) : "—"}${f.city ? ` · ${esc(f.city)}` : ""}</div>
        <div class="tvc-meta">${f.visitCount !== undefined ? `到访 ${esc(f.visitCount)} 次` : ""}${f.date ? ` · 📅 ${esc(String(f.date))}` : ""}</div>
        ${cardActions(it)}
      </div>`;
    })
    .join("")}</div>`;
}

/** 网站导航：浏览器书签卡片 */
function renderWebsiteCards(data) {
  return `<div class="mod-grid site-grid">${data
    .map((it) => {
      const f = it.fields || {};
      // icon 字段：填 http(s) 图片链接时直接渲染图片；否则显示首字符（material-symbols 图标名后台渲染不出）
      const iconRaw = f.icon ? String(f.icon).trim() : "";
      const iconUrl = /^https?:\/\//i.test(iconRaw) ? iconRaw : "";
      const iconTxt = iconUrl ? "" : (iconRaw && !iconRaw.includes(":") && iconRaw.length <= 4 ? iconRaw : (it.title ? it.title[0] : "🔗"));
      return `<div class="site-card" data-open="${esc(it.id)}">
        <div class="wc-top"><div class="wc-icon">${iconUrl ? `<img src="${esc(iconUrl)}" alt="" loading="lazy" onerror="this.remove()">` : esc(iconTxt)}</div>${f.category ? `<span class="tag tag-cat">${esc(f.category)}</span>` : ""}</div>
        <div class="wc-name">${esc(it.title)}${it.error ? `<span class="badge">⚠</span>` : ""}</div>
        ${f.description ? `<div class="wc-desc">${esc(f.description)}</div>` : ""}
        <div class="wc-meta">${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(f.url.replace(/^https?:\/\//, ""))}</a>` : ""}${f.order !== undefined ? ` · 排序 ${esc(f.order)}` : ""}</div>
        ${cardActions(it)}
      </div>`;
    })
    .join("")}</div>`;
}

/** 更新日志：版本时间线卡片 */
function renderChangelogCards(data) {
  return `<div class="mod-grid changelog-grid">${data
    .map((it) => {
      const f = it.fields || {};
      return `<div class="changelog-card" data-open="${esc(it.id)}">
        <div class="clc-version">${esc(it.title)}</div>
        ${f.type && CHANGELOG_TYPE_TEXT[f.type] ? `<span class="clc-type">${CHANGELOG_TYPE_TEXT[f.type]}</span>` : ""}
        ${f.description ? `<div class="clc-desc">${esc(f.description)}</div>` : ""}
        <div class="clc-meta">${f.date ? `📅 ${esc(String(f.date))}` : ""}${f.time ? ` ${esc(f.time)}` : ""}</div>
        ${cardActions(it)}
      </div>`;
    })
    .join("")}</div>`;
}

/** 关于我：单文件专属大卡片 */
function renderAboutCard(data) {
  const it = data[0];
  return `<div class="about-card" data-open="${it ? esc(it.id) : ""}">
    <div class="ac-icon">👋</div>
    <div class="ac-title">关于我</div>
    <div class="ac-desc">页面内容为自由 Markdown，无 Frontmatter 字段，直接编辑正文即可。</div>
    <div class="card-actions">
      <button class="btn btn-sm btn-info" data-edit="${it ? esc(it.id) : ""}">✏️ 编辑内容</button>
    </div>
  </div>`;
}

/** 回退：通用文字列表 */
function renderFallbackList(data) {
  return `<div class="list-card">
    <div class="list-head"><span>标题</span><span>文件名</span><span>操作</span></div>
    ${data
    .map(
      (it) => `<div class="list-item">
        <div class="li-main" data-open="${esc(it.id)}">
          <div class="li-title">${esc(it.title)}${it.error ? `<span class="badge">⚠ 解析异常</span>` : ""}</div>
        </div>
        <div class="li-file">${esc(it.filename)}</div>
        <div class="li-actions">
          <button class="btn btn-sm mini" data-preview="${esc(it.id)}">预览</button>
          <button class="btn btn-sm btn-info" data-edit="${esc(it.id)}">编辑</button>
          <button class="btn btn-sm btn-danger" data-del="${esc(it.id)}">删除</button>
        </div>
      </div>`,
    )
    .join("")}</div>`;
}

function bindCardGrid(panel) {
  panel.querySelectorAll("[data-open]").forEach((el) =>
    (el.onclick = (e) => {
      if (e.target.closest("button, a")) return;
      openEdit(el.dataset.open);
    }),
  );
  panel.querySelectorAll("[data-preview]").forEach((el) =>
    (el.onclick = (e) => {
      e.stopPropagation();
      window.open(previewUrl(el.dataset.preview), "_blank");
    }),
  );
  panel.querySelectorAll("[data-edit]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); openEdit(el.dataset.edit); }));
  panel.querySelectorAll("[data-del]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); deleteItem(el.dataset.del); }));
}

/* ─────────── 内容管理：表单 ─────────── */
/** 博客预览 URL：单页型模块直接打开聚合页；目录型拼接条目 slug（统一以 / 结尾）；笔记带笔记本 ID */
function previewUrl(itemId, nbId) {
  const base = state.blogBase || "http://localhost:4321";
  if (nbId) {
    const noteSlug = encodeURIComponent(String(itemId).replace(/\.md$/i, ""));
    return `${base}/notebooks/${encodeURIComponent(nbId)}/${noteSlug}/`;
  }
  const prefix = state.module?.urlPrefix || "/";
  const itemSlug = encodeURIComponent(String(itemId).replace(/\.(md|mdx)$/i, ""));
  if (prefix.endsWith("/")) {
    return `${base}${prefix}${itemSlug}/`;
  }
  // 无尾斜杠的单页型前缀：补一个 / 保证可访问
  return `${base}${prefix}/`;
}

/** 当天日期（YYYY-MM-DD，本地时区），用于新建内容时日期字段的默认值 */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fieldControlHtml(field, value, opts = {}) {
  const v = value === undefined || value === null ? "" : value;
  if (field.enum && field.enum.length) {
    const optsHtml = field.enum
      .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? "selected" : ""}>${esc(o.label)}</option>`)
      .join("");
    return `<select data-fkey="${esc(field.key)}">${optsHtml}</select>`;
  }
  switch (field.type) {
    case "number":
      return `<input type="number" step="any" data-fkey="${esc(field.key)}" value="${esc(v)}">`;
    case "positiveInt":
      return `<input type="number" min="0" step="1" data-fkey="${esc(field.key)}" value="${esc(v)}">`;
    case "boolean":
      return `<label style="display:flex;align-items:center;gap:10px;"><input type="checkbox" data-fkey="${esc(field.key)}" ${v === true ? "checked" : ""}> ${v === true ? "是" : "否"}</label>`;
    case "date":
      return `<input type="date" data-fkey="${esc(field.key)}" value="${esc(v)}">`;
    case "time":
      return `<input type="time" data-fkey="${esc(field.key)}" value="${esc(v)}">`;
    case "stringArray":
    case "urlArray":
      return arrayEditorHtml(field.key, Array.isArray(v) ? v : [], field.type === "urlArray");
    case "url":
    case "string":
    default:
      return `<input type="text" data-fkey="${esc(field.key)}" value="${esc(v)}">`;
  }
}

function arrayEditorHtml(key, items, isUrl) {
  const rows = items
    .map(
      (it, i) => `<div class="array-row">
        ${isUrl && /^https?:\/\//i.test(it) ? `<img class="arr-thumb" src="${esc(it)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
        <input type="text" data-arrkey="${esc(key)}" data-arri="${i}" value="${esc(it)}" placeholder="${isUrl ? "http(s)://..." : "文本项"}">
        <button type="button" class="btn btn-sm btn-danger mini" data-arr-del="${i}" data-arrkey2="${esc(key)}">✕</button>
        <button type="button" class="btn btn-sm mini" data-arr-up="${i}" data-arrkey2="${esc(key)}">↑</button>
        <button type="button" class="btn btn-sm mini" data-arr-down="${i}" data-arrkey2="${esc(key)}">↓</button>
      </div>`,
    )
    .join("");
  return `<div class="array-editor" data-arr-root="${esc(key)}" data-is-url="${isUrl ? "1" : "0"}">
    ${rows || `<div class="array-hint">（空数组）</div>`}
    <button type="button" class="btn btn-sm btn-info array-add" data-arr-add="${esc(key)}">＋ 添加一项</button>
  </div>`;
}

function renderContentForm(detail, isNew) {
  const m = state.module;
  const rows = (m.fields || [])
    .map((f) => {
      if (f.hidden) return "";
      const v = detail ? detail.fields[f.key] : undefined;
      if (f.fixed !== undefined && !isNew && f.fixed === v) {
        return `<div class="form-row"><div class="row-head"><label>${esc(f.label)}</label></div>
          <div class="readonly-row"><span class="fixed-val">${esc(v)}</span><span class="fixed-tag">固定值</span></div></div>`;
      }
      const req = f.required ? `<span class="req">*</span>` : "";
      const help = f.help ? `<span class="help">${esc(f.help)}</span>` : "";
      let initialValue = v;
      if (isNew) {
        if (f.defaultValue !== undefined) {
          initialValue = f.defaultValue;
        } else if (f.type === "date" && !v) {
          // 新建时日期字段默认填入当天，避免浏览器显示 yyyy/mm/日 占位符
          initialValue = todayStr();
        }
      }
      let control = fieldControlHtml(f, initialValue);
      if (f.type === "url" && f.media && typeof v === "string" && v) {
        control += mediaPreviewHtml(v);
      }
      return `<div class="form-row" data-field-row="${esc(f.key)}">
        <div class="row-head"><label>${esc(f.label)}${req}</label>${help}</div>
        ${control}
      </div>`;
    })
    .join("");

  let bodyEditor = "";
  if (m.hasBody) {
    const bodyVal = detail ? detail.body : "";
    bodyEditor = `<div class="form-row">
      <div class="row-head"><label>${m.noFrontmatter ? "正文" : "正文（Markdown）"}</label>
      <span class="help">${m.noFrontmatter ? "本模块无 frontmatter，全部内容即正文" : "保存时 YAML 引号风格原样保留"}</span></div>
      <textarea class="body-editor" data-body>${esc(bodyVal)}</textarea>
    </div>`;
  }

  let unknownTip = "";
  if (detail && detail.unknownKeys && detail.unknownKeys.length) {
    unknownTip = `<div class="unknown-tip">⚠ 文件包含未定义字段（只读，不会被修改）：${detail.unknownKeys.map((k) => `<code>${esc(k)}</code>`).join("")}</div>`;
  }
  let errTip = "";
  if (detail && detail.error) {
    errTip = `<div class="error-tip">⚠ ${esc(detail.error)} — 文件解析失败，保存将按模板重建 frontmatter</div>`;
  }

  return `<form class="form" id="content-form">
    ${errTip}${unknownTip}${rows}${bodyEditor}
    <div class="form-foot">
      <button type="submit" class="btn btn-primary">💾 保存</button>
      <button type="button" class="btn" data-cancel>返回列表</button>
    </div>
  </form>`;
}

function bindArrayEditor(formEl) {
  formEl.querySelectorAll("[data-arr-add]").forEach((b) =>
    (b.onclick = () => {
      const key = b.dataset.arrAdd;
      const root = formEl.querySelector(`[data-arr-root="${CSS.escape(key)}"]`);
      const n = root.querySelectorAll(".array-row").length;
      const isUrl = root.dataset.isUrl === "1";
      const row = document.createElement("div");
      row.className = "array-row";
      row.innerHTML = `${isUrl ? `<img class="arr-thumb" alt="" hidden>` : ""}<input type="text" data-arrkey="${esc(key)}" data-arri="${n}" placeholder="${isUrl ? "http(s)://..." : "文本项"}">
        <button type="button" class="btn btn-sm btn-danger mini" data-arr-del="${n}" data-arrkey2="${esc(key)}">✕</button>
        <button type="button" class="btn btn-sm mini" data-arr-up="${n}" data-arrkey2="${esc(key)}">↑</button>
        <button type="button" class="btn btn-sm mini" data-arr-down="${n}" data-arrkey2="${esc(key)}">↓</button>`;
      root.insertBefore(row, root.querySelector(".array-add"));
      bindArrayEditor(formEl);
      row.querySelector("input").focus();
    }),
  );
  // url 数组：输入 URL 时实时预览缩略图（赋值 oninput 避免重复绑定）
  formEl.querySelectorAll('[data-arr-root][data-is-url="1"]').forEach((root) => {
    root.querySelectorAll(".array-row").forEach((row) => {
      const inp = row.querySelector("input");
      inp.oninput = () => {
        let thumb = row.querySelector(".arr-thumb");
        const v = inp.value.trim();
        if (/^https?:\/\//i.test(v)) {
          if (!thumb) {
            thumb = document.createElement("img");
            thumb.className = "arr-thumb";
            thumb.alt = "";
            thumb.loading = "lazy";
            row.insertBefore(thumb, inp);
          }
          thumb.hidden = false;
          thumb.src = v;
          thumb.onerror = () => { thumb.hidden = true; };
        } else if (thumb) {
          thumb.hidden = true;
        }
      };
    });
  });
  formEl.querySelectorAll("[data-arr-del]").forEach((b) =>
    (b.onclick = () => {
      const key = b.dataset.arrkey2;
      const root = formEl.querySelector(`[data-arr-root="${CSS.escape(key)}"]`);
      root.querySelectorAll(".array-row")[Number(b.dataset.arrDel)]?.remove();
      reindexArray(root);
    }),
  );
  formEl.querySelectorAll("[data-arr-up]").forEach((b) =>
    (b.onclick = () => {
      const key = b.dataset.arrkey2;
      const root = formEl.querySelector(`[data-arr-root="${CSS.escape(key)}"]`);
      const rows = [...root.querySelectorAll(".array-row")];
      const i = Number(b.dataset.arrUp);
      if (i > 0 && rows[i]) {
        root.insertBefore(rows[i], rows[i - 1]);
        reindexArray(root);
      }
    }),
  );
  formEl.querySelectorAll("[data-arr-down]").forEach((b) =>
    (b.onclick = () => {
      const key = b.dataset.arrkey2;
      const root = formEl.querySelector(`[data-arr-root="${CSS.escape(key)}"]`);
      const rows = [...root.querySelectorAll(".array-row")];
      const i = Number(b.dataset.arrDown);
      if (i < rows.length - 1 && rows[i]) {
        root.insertBefore(rows[i + 1], rows[i]);
        reindexArray(root);
      }
    }),
  );
}
function reindexArray(root) {
  root.querySelectorAll(".array-row").forEach((row, i) => {
    row.querySelector("input").dataset.arri = String(i);
    const [del, up, down] = row.querySelectorAll("button");
    del.dataset.arrDel = String(i);
    up.dataset.arrUp = String(i);
    down.dataset.arrDown = String(i);
  });
  bindArrayEditor(root.closest("form"));
}

function collectFormData(formEl) {
  const data = {};
  formEl.querySelectorAll("[data-fkey]").forEach((el) => {
    const fd = (state.module?.fields || []).find((f) => f.key === el.dataset.fkey);
    if (el.type === "checkbox") data[el.dataset.fkey] = el.checked;
    else if (el.type === "number") data[el.dataset.fkey] = el.value === "" ? "" : Number(el.value);
    else {
      // 枚举下拉：选项值全为数字时（如 status 1~5）写回数字，而不是字符串
      const numEnum =
        fd?.enum && fd.enum.length && fd.enum.every((o) => typeof o.value === "number");
      data[el.dataset.fkey] = numEnum ? Number(el.value) : el.value;
    }
  });
  const arrs = {};
  formEl.querySelectorAll("[data-arrkey]").forEach((el) => {
    const k = el.dataset.arrkey;
    (arrs[k] ??= [])[Number(el.dataset.arri)] = el.value;
  });
  for (const [k, arr] of Object.entries(arrs)) {
    const fd = (state.module?.fields || []).find((f) => f.key === k);
    data[k] = arr
      .filter((v) => v !== undefined && String(v).trim() !== "")
      .map((v) => (fd && (fd.type === "number" || fd.type === "positiveInt") ? Number(v) : v));
  }
  const bodyEl = formEl.querySelector("[data-body]");
  return { data, body: bodyEl ? bodyEl.value : undefined };
}

async function openCreate() {
  setPanelTitle(`${state.module.name} · 新建`);
  const panel = $("#content-panel");
  panel.innerHTML = renderContentForm(null, true);
  const form = $("#content-form");
  bindArrayEditor(form);
  form.querySelector("[data-cancel]").onclick = renderModuleList;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { data, body } = collectFormData(form);
    try {
      const r = await api(`/api/content/${state.module.id}`, { method: "POST", body: { data, body } });
      toast(`已创建 ${r.filename}`, "ok");
      await renderModuleList();
    } catch (err) {
      toast(err.message, "err");
    }
  };
}

async function openEdit(id) {
  try {
    const detail = await api(`/api/content/${state.module.id}/${id}`);
    setPanelTitle(`${state.module.name} · ${detail.filename}`);
    const panel = $("#content-panel");
    panel.innerHTML = renderContentForm(detail, false);
    const form = $("#content-form");
    bindArrayEditor(form);
    form.querySelector("[data-cancel]").onclick = renderModuleList;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const { data, body } = collectFormData(form);
      try {
        await api(`/api/content/${state.module.id}/${id}`, { method: "PUT", body: { data, body } });
        toast("保存成功（YAML 引号风格已保留）", "ok");
        await renderModuleList();
      } catch (err) {
        toast(err.message, "err");
      }
    };
  } catch (err) {
    toast(err.message, "err");
  }
}

async function deleteItem(id) {
  confirmModal("删除确认", `确定删除「${id}」吗？<br>删除前会自动备份，可在「备份与恢复」中还原。`, async () => {
    try {
      await api(`/api/content/${state.module.id}/${id}`, { method: "DELETE" });
      toast("已删除（已自动备份）", "ok");
      await renderModuleList();
    } catch (err) {
      toast(err.message, "err");
    }
  });
}

/* ─────────── 内容管理：备份与恢复 ─────────── */
async function openBackups() {
  try {
    const list = await api(`/api/content/${state.module.id}/backups`);
    const body = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <button class="btn btn-sm btn-info" id="backup-now">立即备份</button>
        <span style="font-size:12.5px;color:#9a7a52;">新建不备份，更新/删除时自动备份，滚动保留 5 份</span>
      </div>${
        list.length
          ? `<div class="backup-list">${list
              .map(
                (b) => `<div class="backup-item">
          <div>
            <div class="bi-name">${esc(b.name)}${b.isDirSnapshot ? `<span class="tag tag-dir">目录快照</span>` : `<span class="tag tag-file">文件</span>`}</div>
            <div class="bi-meta">${esc(b.time)} · ${fmtSize(b.size)}</div>
          </div>
          <div class="bi-actions">
            <button class="btn btn-sm btn-info" data-restore="${esc(b.name)}">恢复</button>
          </div>
        </div>`,
              )
              .join("")}</div>
       <p style="font-size:12.5px;color:#9a7a52;margin-top:10px;">恢复会覆盖同名源文件，操作前建议先自行备份。</p>`
          : `<div class="empty-hint">暂无备份，点击上方「立即备份」创建第一份</div>`
      }`;
    openModal("备份与恢复", body);
    $("#modal-body #backup-now").onclick = async () => {
      try {
        await api(`/api/content/${state.module.id}/backups`, { method: "POST" });
        toast("备份已创建", "ok");
        await openBackups();
      } catch (err) {
        toast(err.message, "err");
      }
    };
    $$("#modal-body [data-restore]").forEach((b) =>
      (b.onclick = () => {
        confirmModal("恢复确认", `确定用备份「${b.dataset.restore}」覆盖恢复吗？`, async () => {
          try {
            await api(`/api/content/${state.module.id}/restore`, { method: "POST", body: { backupName: b.dataset.restore } });
            toast("恢复成功", "ok");
            closeModal();
            await renderModuleList();
          } catch (err) {
            toast(err.message, "err");
          }
        });
      }),
    );
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ─────────── 内容管理：notebooks 笔记本（两级） ─────────── */
function renderNotebooks(list) {
  if (!list.length) {
    return `<div class="empty-hint">还没有笔记本 ~ 点击右上角「＋ 新建」创建第一本</div>`;
  }
  return `<div class="notebook-grid">${list
    .map(
      (nb) => `<div class="note-card" data-nb="${esc(nb.id)}">
        ${nb.cover ? `<img class="nc-cover" src="${esc(nb.cover)}" alt="cover" loading="lazy" onerror="this.remove()">` : ""}
        <div class="nc-name">${esc(nb.name)}${nb.error ? `<span class="badge">⚠ ${esc(nb.error)}</span>` : ""}</div>
        ${nb.summary ? `<div class="nc-summary">${esc(nb.summary)}</div>` : ""}
        <div class="nc-meta">${nb.noteCount} 篇笔记
          <button class="btn btn-sm mini nc-preview" data-preview="${esc(nb.id)}">预览</button>
        </div>
      </div>`,
    )
    .join("")}</div>`;
}

function bindNotebookCards(panel) {
  panel.querySelectorAll("[data-nb]").forEach((el) => (el.onclick = () => openNotebook(el.dataset.nb)));
  // 笔记本卡片「预览」= 直接打开该笔记本首页（/notebooks/{id}）
  panel.querySelectorAll("[data-preview]").forEach((el) =>
    (el.onclick = (e) => {
      e.stopPropagation();
      const base = state.blogBase || "http://localhost:4321";
      window.open(`${base}/notebooks/${encodeURIComponent(el.dataset.preview)}/`, "_blank");
    }),
  );
}

async function openNotebook(id) {
  try {
    const nb = await api(`/api/content/notebooks/${id}`);
    state.nb = nb;
    setPanelTitle(`笔记本 · ${nb.name}`);
    const m = state.module;

    // 笔记本表单（_index.json）：元信息在 API 返回顶层（name/cover/summary）
    const nbRows = (m.fields || [])
      .map((f) => {
        const v = nb[f.key] !== undefined ? nb[f.key] : undefined;
        const req = f.required ? `<span class="req">*</span>` : "";
        const help = f.help ? `<span class="help">${esc(f.help)}</span>` : "";
        let control = fieldControlHtml(f, v);
        if (f.type === "url" && f.media && typeof v === "string" && v) control += mediaPreviewHtml(v);
        return `<div class="form-row"><div class="row-head"><label>${esc(f.label)}${req}</label>${help}</div>${control}</div>`;
      })
      .join("");

    const errTip = nb.error ? `<div class="error-tip">⚠ ${esc(nb.error)}</div>` : "";
    const unknownTip =
      nb.unknownKeys && nb.unknownKeys.length
        ? `<div class="unknown-tip">⚠ _index.json 含未定义字段（只读）：${nb.unknownKeys.map((k) => `<code>${esc(k)}</code>`).join("")}</div>`
        : "";

    const notesRows = (nb.notes || [])
      .map(
        (n) => `<div class="list-item">
          <div class="li-main" data-note-open="${esc(n.id)}">
            <div class="li-title">${esc(n.title)}${n.error ? `<span class="badge">⚠ 解析异常</span>` : ""}</div>
          </div>
          <div class="li-file">${esc(n.filename)}${n.date ? ` · ${esc(n.date)}` : ""}</div>
          <div class="li-actions">
            <button class="btn btn-sm mini" data-preview="${esc(n.id)}" data-preview-nb="${esc(nb.id)}">预览</button>
            <button class="btn btn-sm btn-info" data-note-edit="${esc(n.id)}">编辑</button>
            <button class="btn btn-sm btn-danger" data-note-del="${esc(n.id)}">删除</button>
          </div>
        </div>`,
      )
      .join("");

    const panel = $("#content-panel");
    panel.innerHTML = `
      <div class="form" id="nb-form">
        ${errTip}${unknownTip}
        <div class="panel open" style="margin-bottom:18px;">
          <div class="panel-head" data-toggle><span class="p-title">📓 笔记本信息（_index.json）</span><span class="p-arrow">▶</span></div>
          <div class="panel-body">${nbRows || `<div class="empty-hint">无字段</div>`}
            <div class="form-foot">
              <button type="button" class="btn btn-primary" data-nb-save>💾 保存笔记本信息</button>
              <button type="button" class="btn btn-sm btn-info" data-nb-restore-note>♻ 恢复某篇笔记</button>
              <button type="button" class="btn btn-sm btn-danger" data-nb-del>删除整本</button>
            </div>
          </div>
        </div>
        <div class="panel-head-row">
          <h3 class="panel-title" style="font-size:19px;">📝 笔记列表（${nb.noteCount}篇笔记）</h3>
          <button class="btn btn-sm btn-primary" data-note-create>＋ 新建笔记</button>
        </div>
        <div class="list-card">${notesRows ? `<div class="list-head"><span>标题</span><span>文件名</span><span>操作</span></div>${notesRows}` : `<div class="empty-hint">这本笔记本还没有笔记</div>`}</div>
      </div>`;

    const nbForm = $("#nb-form");
    bindArrayEditor(nbForm);
    nbForm.querySelectorAll("[data-toggle]").forEach((h) =>
      (h.onclick = () => h.closest(".panel").classList.toggle("collapsed")),
    );
    nbForm.querySelector("[data-nb-save]").onclick = async () => {
      const { data } = collectFormData(nbForm);
      try {
        await api(`/api/content/notebooks/${nb.id}`, { method: "PUT", body: { data } });
        toast("笔记本信息已保存", "ok");
        await openNotebook(nb.id);
      } catch (err) {
        toast(err.message, "err");
      }
    };
    nbForm.querySelector("[data-nb-del]").onclick = () =>
      confirmModal("删除整本", `确定删除笔记本「${nb.name}」吗？<br>整目录会快照备份，可在「备份与恢复」中还原。`, async () => {
        try {
          await api(`/api/content/notebooks/${nb.id}`, { method: "DELETE" });
          toast("已删除（目录快照已备份）", "ok");
          state.nb = null;
          await renderModuleList();
        } catch (err) {
          toast(err.message, "err");
        }
      });
    nbForm.querySelector("[data-nb-restore-note]").onclick = () => openNoteRestore(nb.id);
    nbForm.querySelector("[data-note-create]").onclick = () => openNoteForm(nb.id, null);
    nbForm.querySelectorAll("[data-note-open]").forEach((el) => (el.onclick = () => openNoteForm(nb.id, el.dataset.noteOpen, true)));
    nbForm.querySelectorAll("[data-note-edit]").forEach((el) => (el.onclick = () => openNoteForm(nb.id, el.dataset.noteEdit, true)));
    nbForm.querySelectorAll("[data-preview]").forEach((el) =>
      (el.onclick = (e) => {
        e.stopPropagation();
        window.open(previewUrl(el.dataset.preview, el.dataset.previewNb), "_blank");
      }),
    );
    nbForm.querySelectorAll("[data-note-del]").forEach((el) =>
      (el.onclick = () =>
        confirmModal("删除笔记", `确定删除笔记「${el.dataset.noteDel}」吗？<br>删除前会自动备份。`, async () => {
          try {
            await api(`/api/content/notebooks/${nb.id}/notes/${el.dataset.noteDel}`, { method: "DELETE" });
            toast("已删除（已自动备份）", "ok");
            await openNotebook(nb.id);
          } catch (err) {
            toast(err.message, "err");
          }
        })),
    );
  } catch (err) {
    toast(err.message, "err");
  }
}

/** 笔记编辑/新建表单（noteFieldDef + body） */
async function openNoteForm(notebookId, noteId, isEdit = false) {
  const nb = state.nb;
  let detail = null;
  if (isEdit) {
    try {
      detail = await api(`/api/content/notebooks/${notebookId}/notes/${noteId}`);
    } catch (err) {
      toast(err.message, "err");
      return;
    }
  }
  const fields = state.module.noteFields || [];
  const rows = fields
    .map((f) => {
      let v = detail ? detail.fields[f.key] : undefined;
      // 新建笔记时日期字段默认填入当天，避免浏览器显示 yyyy/mm/日 占位符
      if (!isEdit && f.type === "date" && !v) v = todayStr();
      const req = f.required ? `<span class="req">*</span>` : "";
      const help = f.help ? `<span class="help">${esc(f.help)}</span>` : "";
      let control = fieldControlHtml(f, v);
      if (f.type === "url" && f.media && typeof v === "string" && v) control += mediaPreviewHtml(v);
      return `<div class="form-row"><div class="row-head"><label>${esc(f.label)}${req}</label>${help}</div>${control}</div>`;
    })
    .join("");
  const errTip = detail?.error ? `<div class="error-tip">⚠ ${esc(detail.error)}</div>` : "";
  const unknownTip =
    detail?.unknownKeys?.length
      ? `<div class="unknown-tip">⚠ 笔记含未定义字段（只读）：${detail.unknownKeys.map((k) => `<code>${esc(k)}</code>`).join("")}</div>`
      : "";

  setPanelTitle(`${isEdit ? "编辑" : "新建"}笔记 · ${nb.name}`);
  const panel = $("#content-panel");
  panel.innerHTML = `<form class="form" id="note-form">
    ${errTip}${unknownTip}
    ${rows || ""}
    <div class="form-row">
      <div class="row-head"><label>笔记正文（Markdown）</label><span class="help">YAML 引号风格原样保留</span></div>
      <textarea class="body-editor" data-body>${esc(detail ? detail.body : "")}</textarea>
    </div>
    <div class="form-foot">
      <button type="submit" class="btn btn-primary">💾 保存笔记</button>
      <button type="button" class="btn" data-back>返回笔记本</button>
    </div>
  </form>`;
  const form = $("#note-form");
  bindArrayEditor(form);
  form.querySelector("[data-back]").onclick = () => openNotebook(nb.id);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { data, body } = collectFormData(form);
    try {
      if (isEdit) {
        await api(`/api/content/notebooks/${notebookId}/notes/${noteId}`, { method: "PUT", body: { data, body } });
        toast("笔记已保存", "ok");
      } else {
        const r = await api(`/api/content/notebooks/${notebookId}/notes`, { method: "POST", body: { data, body } });
        toast(`笔记已创建 ${r.filename}`, "ok");
      }
      await openNotebook(notebookId);
    } catch (err) {
      toast(err.message, "err");
    }
  };
}

/** 恢复单篇笔记 md（备份名 → 目标文件名 = 备份 origin） */
async function openNoteRestore(notebookId) {
  try {
    const list = await api(`/api/content/notebooks/backups`);
    const files = list.filter((b) => !b.isDirSnapshot);
    if (!files.length) {
      openModal("恢复笔记", `<div class="empty-hint">暂无笔记文件备份</div>`);
      return;
    }
    openModal(
      "恢复笔记到当前笔记本",
      `<div class="backup-list">${files
        .map(
          (b) => `<div class="backup-item">
            <div><div class="bi-name">${esc(b.name)}</div><div class="bi-meta">${esc(b.time)} · ${fmtSize(b.size)}</div></div>
            <div class="bi-actions"><button class="btn btn-sm btn-info" data-r="${esc(b.name)}">恢复</button></div>
          </div>`,
        )
        .join("")}</div>
       <p style="font-size:12.5px;color:#9a7a52;margin-top:10px;">恢复后将以此备份的原始文件名覆盖当前笔记本中的同名笔记。</p>`,
    );
    $$("#modal-body [data-r]").forEach((b) =>
      (b.onclick = () => {
        confirmModal("恢复确认", `确定用「${b.dataset.r}」恢复吗？`, async () => {
          try {
            await api(`/api/content/notebooks/${notebookId}/notes/placeholder/restore`, {
              method: "POST",
              body: { backupName: b.dataset.r },
            });
            toast("笔记恢复成功", "ok");
            closeModal();
            await openNotebook(notebookId);
          } catch (err) {
            toast(err.message, "err");
          }
        });
      }),
    );
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ─────────── 配置管理：target 导航 ─────────── */
/** 配置侧边栏分组顺序（未收录分组排最后） */
const CFG_GROUP_ORDER = ["基础", "页面布局", "内容与文章", "互动功能", "外观美化"];

async function loadTargets() {
  const data = await api("/api/config");
  state.targets = data.targets;
  const nav = $("#target-nav");
  // 按 group 分组渲染（组内顺序 = targets.ts 数组顺序）
  const grouped = new Map();
  for (const t of state.targets) {
    const g = t.group || "其他";
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g).push(t);
  }
  const order = [...CFG_GROUP_ORDER, ...[...grouped.keys()].filter((g) => !CFG_GROUP_ORDER.includes(g))];
  let seq = 0;
  nav.innerHTML = order
    .filter((g) => grouped.has(g))
    .map(
      (g) => `<div class="nav-group">
        <div class="nav-group-title">${esc(g)}</div>
        ${grouped
          .get(g)
          .map((t) => `<button class="nav-item" data-target="${esc(t.id)}">
            <span class="no">${++seq}</span><span>${esc(t.name)}</span>
          </button>`)
          .join("")}
      </div>`,
    )
    .join("");
  $$(".nav-item", nav).forEach((b) => (b.onclick = () => selectTarget(b.dataset.target)));
  $("#target-count").textContent = `共 ${state.targets.length} 个`;
}

async function selectTarget(id) {
  try {
    $$("#target-nav .nav-item").forEach((b) => b.classList.toggle("active", b.dataset.target === id));
    const read = await api(`/api/config/${id}`);
    state.target = read;
    state.changes.clear();
    $("#config-panel-title").textContent = `${read.name} · 配置`;
    $("#btn-save-config").classList.remove("hidden");
    renderConfigPanel(read);
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ─────────── 配置管理：字段分组与渲染 ─────────── */
function parseSegs(keyPath) {
  const segs = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(keyPath)) !== null) segs.push(m[1] !== undefined ? { prop: m[1] } : { idx: Number(m[2]) });
  return segs;
}

/** 分组：顶层单段字段 / 嵌套分组 / 对象数组元素字段（含深层如 local.playlist[0].name） */
function groupFields(fields) {
  const top = [];
  const groups = new Map(); // 组名 -> { nested: [], elems: Map<elemKey, {entries}> }
  let rawHtml = null;
  for (const f of fields) {
    if (f.keyPath === "__raw_html") {
      rawHtml = f;
      continue;
    }
    const segs = parseSegs(f.keyPath);
    if (segs.length === 1) {
      top.push(f);
      continue;
    }
    const gname = segs[0].prop;
    if (!groups.has(gname)) groups.set(gname, { nested: [], elems: new Map() });
    const g = groups.get(gname);
    // 找第一个 [索引] 段：对象数组元素字段（如 local.playlist[0].name）
    const idxPos = segs.findIndex((s) => s.idx !== undefined);
    if (idxPos > 0) {
      const prefix = segs.slice(1, idxPos).map((s) => s.prop).join(".");
      const elemKey = `${prefix}[${segs[idxPos].idx}]`;
      if (!g.elems.has(elemKey)) g.elems.set(elemKey, { entries: [] });
      g.elems.get(elemKey).entries.push(f);
    } else {
      g.nested.push(f);
    }
  }
  return { top, groups, rawHtml };
}

/** 配置字段中英文对照：keyPath 逐段翻译（未收录词保留英文） */
const CFG_WORD_ZH = {
  title: "标题", subtitle: "副标题", name: "名称", description: "描述", type: "类型", path: "路径",
  src: "地址", url: "链接", link: "链接", links: "链接列表", color: "颜色", backgroundColor: "背景色",
  themeColor: "主题色", theme: "主题", hue: "色调", fixed: "固定值", defaultMode: "默认模式",
  pageWidth: "页面宽度", card: "卡片", border: "边框", followTheme: "跟随主题", favicon: "站点图标",
  sizes: "尺寸", navbar: "导航栏", logo: "标志", alt: "替代文本", width: "宽度", full: "占满整行",
  menuAlign: "菜单对齐", stickyNavbar: "吸顶导航", siteStartDate: "建站日期", timezone: "时区",
  pages: "页面开关", friends: "友链", sponsor: "赞助", guestbook: "留言板", bangumi: "番剧",
  gallery: "相册", anime: "动漫", books: "书架", movies: "影视", games: "游戏",
  musicPage: "音乐页面", changelog: "更新日志", routines: "日常规划", places: "足迹", notebooks: "笔记本",
  categoryBar: "分类栏", foldArticle: "折叠文章", postListLayout: "文章列表布局", showTags: "显示标签",
  descriptionLines: "简介行数", allowSwitch: "允许切换布局", grid: "网格", masonry: "瀑布流",
  columnWidth: "列宽", post: "文章", rehypeCallouts: "提示框", showLastModified: "显示修改时间",
  outdatedThreshold: "过期阈值", sharePoster: "分享海报", generateOgImages: "生成 OG 图",
  userId: "用户 ID", mode: "模式", apiUrl: "接口地址", subjectBaseUrl: "条目地址",
  categoryOrder: "分类顺序", bilibili: "哔哩哔哩", uid: "UID", postsPerPage: "每页文章数",
  imageOptimization: "图片优化", formats: "格式", quality: "质量", noReferrerDomains: "免引荐域名",
  usage: "使用说明", showSponsorsList: "显示赞助名单", showComment: "显示评论",
  showButtonInPost: "文章内显示按钮", methods: "赞助方式", icon: "图标", qrCode: "收款码",
  enabled: "启用", sponsors: "赞助者", avatar: "头像", amount: "金额", date: "日期", enable: "启用",
  position: "位置", tabletSidebar: "平板侧边栏", hideSidebarOnPostPage: "文章页隐藏侧边栏",
  showBothSidebarsOnPostPage: "文章页显示双栏", leftComponents: "左侧组件", rightComponents: "右侧组件",
  showOnPostPage: "文章页显示", showTitle: "显示标题", hideOnNonPostPage: "非文章页隐藏",
  specificConfig: "专属配置", collapseThreshold: "折叠阈值", siteInfo: "站点信息",
  unknownBuildPlatform: "未知构建平台", calendar: "日历", showHeatmap: "热力图", ad: "广告",
  image: "图片", external: "新窗口打开", closable: "可关闭", padding: "内边距", all: "全部",
  content: "内容", text: "文本", mobileBottomComponents: "移动端底部组件", bio: "个人简介",
  showName: "显示名称", server: "服务器", lightTheme: "浅色主题", darkTheme: "深色主题",
  spineModelConfig: "骨骼模型配置", model: "模型", scale: "缩放", x: "X 偏移", y: "Y 偏移",
  corner: "角落", offsetX: "水平偏移", offsetY: "垂直偏移", size: "尺寸", height: "高度",
  interactive: "交互", clickAnimations: "点击动画", clickMessages: "点击消息",
  messageDisplayTime: "消息显示时长", idleAnimations: "待机动画", idleInterval: "待机间隔",
  responsive: "响应式", hideOnMobile: "移动端隐藏", mobileBreakpoint: "移动端断点", zIndex: "层级",
  opacity: "透明度", live2dWidgetConfig: "看板娘配置", volume: "音量", primaryColor: "主色",
  transitionDuration: "过渡时长", transitionType: "过渡效果", menus: "菜单", items: "菜单项",
  label: "标签", action: "动作", align: "对齐", tips: "提示", welcomeMessage: "欢迎语",
  messages: "消息列表", duration: "时长", interval: "间隔", offset: "偏移", showInNavbar: "导航栏显示",
  playMode: "播放模式", showLyrics: "显示歌词", playlists: "播放列表", playlistId: "歌单 ID",
  currentPlaylistId: "当前歌单 ID", meting: "歌单接口", fallbackApis: "备用接口", local: "本地",
  playlist: "本地歌单", artist: "歌手", lrc: "歌词", pluginCollapsible: "折叠插件",
  lineThreshold: "行数阈值", previewLines: "预览行数", defaultCollapsed: "默认折叠",
  pluginLanguageBadge: "语言徽章", switchable: "可切换", sakuraNum: "樱花数量", min: "最小", max: "最大",
  vertical: "垂直", rotation: "旋转", fadeSpeed: "淡入速度", enableInPost: "文章内启用",
  randomCoverImage: "随机封面", apis: "接口列表", fallback: "备用图", showLoading: "加载提示",
  twikoo: "Twikoo 评论", envId: "环境 ID", lang: "语言", visitorCount: "访问统计", jsUrl: "JS 地址",
  cssUrl: "CSS 地址", waline: "Waline 评论", serverURL: "服务地址", emoji: "表情", login: "登录方式",
  artalk: "Artalk 评论", locale: "语言地区", giscus: "Giscus 评论", repo: "仓库", repoId: "仓库 ID",
  category: "分类", categoryId: "分类 ID", mapping: "映射", strict: "严格模式",
  reactionsEnabled: "表情回应", emitMetadata: "元数据", inputPosition: "输入位置", loading: "加载方式",
  disqus: "Disqus 评论", shortname: "站点名", playerEnable: "播放器启用", desktop: "桌面端",
  mobile: "移动端", playerUrl: "播放地址", common: "通用", dimOpacity: "暗化透明度",
  playerMode: "播放器模式", homeText: "首页文字", titleSize: "标题字号", subtitleSize: "副标题字号",
  typewriter: "打字机", speed: "速度", deleteSpeed: "删除速度", pauseTime: "暂停时长",
  transparentMode: "透明模式", enableBlur: "模糊开关", blur: "模糊强度", waves: "波浪", gradient: "渐变",
  carousel: "轮播", transitionEffect: "过渡效果", banner: "横幅", overlay: "遮罩层",
  cardOpacity: "卡片透明度", fullscreen: "全屏", googleAnalyticsId: "Google 统计 ID",
  enablePythonMarkdownAdmonitions: "Python 提醒语法", show: "显示", hide: "隐藏", body: "正文",
  stats: "站点统计", showPostCount: "显示文章数", showCategoryCount: "显示分类数",
  showTagCount: "显示标签数", showTotalWords: "显示总字数", showRunningDays: "显示运行时长",
  showLastUpdate: "显示最后活动", province: "省份", city: "城市", district: "区县",
  visitCount: "到访次数", cover: "封面", keywords: "关键词", author: "作者",
  sourceLink: "原文链接", licenseName: "许可名称", licenseUrl: "许可链接", comment: "评论",
  password: "访问密码", passwordHint: "密码提示", imgurl: "头像", siteurl: "站点链接",
  weight: "权重", tags: "标签", published: "发布日期", updated: "更新时间", draft: "草稿",
  pinned: "置顶", categoryId: "分类 ID", featured: "推荐", order: "排序值",
};

/** 配置字段中文标签：逐段翻译 keyPath（未收录词保留英文，camelCase 拆分兜底） */
function cfgLabelZh(keyPath) {
  return parseSegs(keyPath)
    .map((s) => {
      if (s.idx !== undefined) return `第 ${s.idx + 1} 项`;
      const w = s.prop;
      if (CFG_WORD_ZH[w]) return CFG_WORD_ZH[w];
      const parts = w.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/);
      return parts.map((p) => CFG_WORD_ZH[p.toLowerCase()] || p).join(" ");
    })
    .join(" · ");
}

/** 侧边栏组件 type 值 → 中文名 */
const CFG_WIDGET_ZH = {
  profile: "个人资料", announcement: "公告", categories: "分类", tags: "标签",
  sidebarToc: "侧边目录", advertisement: "广告", stats: "站点统计", calendar: "日历",
  music: "音乐播放器", siteInfo: "站点信息", umamiStats: "Umami 统计", changelog: "更新日志",
};

/**
 * 对象数组元素标题：优先用组件 type 的中文名或名称类字段的值，
 * 让用户不点开也能知道「第 N 项」到底是什么（如「站点统计」「广告（第 1 个）」）。
 */
function elemLabelZh(elemKey, entries) {
  const idx = parseSegs(elemKey).find((s) => s.idx !== undefined);
  const idxText = idx ? `（第 ${idx.idx + 1} 个）` : "";
  const typeEntry = entries.find((e) => e.keyPath.endsWith(".type") && typeof e.value === "string");
  if (typeEntry) {
    const zh = CFG_WIDGET_ZH[typeEntry.value];
    if (zh) return `${zh} ${idxText}`.trim();
  }
  for (const suffix of [".label", ".name", ".title", ".url", ".content"]) {
    const e = entries.find((en) => en.keyPath.endsWith(suffix) && typeof en.value === "string" && en.value.trim() !== "");
    if (e) return `${e.value} ${idxText}`.trim();
  }
  return cfgLabelZh(elemKey);
}

/** 配置字段单行：中文标签 + 英文 keyPath 小字 */
function configFieldRow(entry, labelOverride) {
  const label = labelOverride || cfgLabelZh(entry.keyPath);
  return `<div class="form-row" data-cfg-row="${esc(entry.keyPath)}">
    <div class="row-head"><label>${esc(label)}</label><span class="kpath">${esc(entry.keyPath)}</span></div>
    ${configControlHtml(entry)}
  </div>`;
}

function configControlHtml(entry) {
  const { keyPath, value, isMedia } = entry;
  let control = "";
  if (typeof value === "boolean") {
    control = `<label style="display:flex;align-items:center;gap:10px;">
      <input type="checkbox" data-cfg="${esc(keyPath)}" ${value ? "checked" : ""}> ${value ? "是" : "否"}</label>`;
  } else if (typeof value === "number") {
    control = `<input type="number" step="any" data-cfg="${esc(keyPath)}" value="${esc(value)}">`;
  } else if (typeof value === "string") {
    control = `<input type="text" data-cfg="${esc(keyPath)}" value="${esc(value)}">`;
  } else if (value === null) {
    control = `<div class="readonly-row"><span class="fixed-val">null</span><span class="fixed-tag">空值字段，如需修改请到源码</span></div>`;
  } else {
    control = `<div class="readonly-row"><span class="fixed-val">${esc(JSON.stringify(value))}</span><span class="fixed-tag">只读结构</span></div>`;
  }
  if (isMedia && typeof value === "string") control += mediaPreviewHtml(value);
  return control;
}

const VIDEO_RE = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i;
function mediaPreviewHtml(value) {
  if (typeof value !== "string" || value === "") return "";
  if (/^https?:\/\//i.test(value)) {
    // 仅明确视频扩展名才用 <video>；其余一律按图片（很多图床/API 链接无扩展名）
    if (VIDEO_RE.test(value)) {
      return `<div class="media-preview"><video src="${esc(value)}" controls preload="metadata"></video></div>`;
    }
    return `<div class="media-preview"><img src="${esc(value)}" alt="媒体预览" loading="lazy" onerror="this.outerHTML='<div class=media-hint>图片加载失败</div>'"></div>`;
  }
  return `<div class="media-hint">相对路径资源（${esc(value)}）无法在后台预览，请到博客站点查看</div>`;
}

/** 标量数组编辑器（整体提交） */
function configArrayEditor(entry) {
  const { keyPath, value } = entry;
  const items = Array.isArray(value) ? value : [];
  const rows = items
    .map(
      (it, i) => `<div class="array-row">
        <input type="text" data-cfgarr="${esc(keyPath)}" data-cfgarr-i="${i}" value="${esc(typeof it === "string" ? it : "")}">
        <button type="button" class="btn btn-sm btn-danger mini" data-cfgarr-del="${i}" data-cfgarr-key="${esc(keyPath)}">✕</button>
        <button type="button" class="btn btn-sm mini" data-cfgarr-up="${i}" data-cfgarr-key="${esc(keyPath)}">↑</button>
        <button type="button" class="btn btn-sm mini" data-cfgarr-down="${i}" data-cfgarr-key="${esc(keyPath)}">↓</button>
      </div>`,
    )
    .join("");
  return `<div class="form-row">
    <div class="row-head"><label>${esc(cfgLabelZh(keyPath))}</label><span class="kpath">${esc(keyPath)}</span></div>
    <div class="array-editor" data-cfgarr-root="${esc(keyPath)}">
      ${rows || `<div class="array-hint">（空数组）</div>`}
      <button type="button" class="btn btn-sm btn-info array-add" data-cfgarr-add="${esc(keyPath)}">＋ 添加一项</button>
    </div>
  </div>`;
}

function emitConfigArrayChange(keyPath) {
  const root = document.querySelector(`[data-cfgarr-root="${CSS.escape(keyPath)}"]`);
  const arr = [];
  root.querySelectorAll("[data-cfgarr]").forEach((el) => {
    const v = el.value;
    if (v !== "") arr[Number(el.dataset.cfgarrI)] = v;
  });
  state.changes.set(keyPath, { value: arr.filter((v) => v !== undefined) });
  refreshConfigSaveCount();
}

function bindConfigArrayEditor(container) {
  container.querySelectorAll("[data-cfgarr-add]").forEach((b) =>
    (b.onclick = () => {
      const key = b.dataset.cfgarrAdd;
      const root = container.querySelector(`[data-cfgarr-root="${CSS.escape(key)}"]`);
      const n = root.querySelectorAll(".array-row").length;
      const row = document.createElement("div");
      row.className = "array-row";
      row.innerHTML = `<input type="text" data-cfgarr="${esc(key)}" data-cfgarr-i="${n}" value="">
        <button type="button" class="btn btn-sm btn-danger mini" data-cfgarr-del="${n}" data-cfgarr-key="${esc(key)}">✕</button>
        <button type="button" class="btn btn-sm mini" data-cfgarr-up="${n}" data-cfgarr-key="${esc(key)}">↑</button>
        <button type="button" class="btn btn-sm mini" data-cfgarr-down="${n}" data-cfgarr-key="${esc(key)}">↓</button>`;
      root.insertBefore(row, root.querySelector(".array-add"));
      bindConfigArrayEditor(container);
      row.querySelector("input").focus();
      emitConfigArrayChange(key);
    }),
  );
  container.querySelectorAll("[data-cfgarr-del]").forEach((b) =>
    (b.onclick = () => {
      const key = b.dataset.cfgarrKey;
      const root = container.querySelector(`[data-cfgarr-root="${CSS.escape(key)}"]`);
      root.querySelectorAll(".array-row")[Number(b.dataset.cfgarrDel)]?.remove();
      reindexConfigArray(root);
      emitConfigArrayChange(key);
    }),
  );
  container.querySelectorAll("[data-cfgarr-up]").forEach((b) =>
    (b.onclick = () => {
      const key = b.dataset.cfgarrKey;
      const root = container.querySelector(`[data-cfgarr-root="${CSS.escape(key)}"]`);
      const rows = [...root.querySelectorAll(".array-row")];
      const i = Number(b.dataset.cfgarrUp);
      if (i > 0 && rows[i]) {
        root.insertBefore(rows[i], rows[i - 1]);
        reindexConfigArray(root);
        emitConfigArrayChange(key);
      }
    }),
  );
  container.querySelectorAll("[data-cfgarr-down]").forEach((b) =>
    (b.onclick = () => {
      const key = b.dataset.cfgarrKey;
      const root = container.querySelector(`[data-cfgarr-root="${CSS.escape(key)}"]`);
      const rows = [...root.querySelectorAll(".array-row")];
      const i = Number(b.dataset.cfgarrDown);
      if (i < rows.length - 1 && rows[i]) {
        root.insertBefore(rows[i + 1], rows[i]);
        reindexConfigArray(root);
        emitConfigArrayChange(key);
      }
    }),
  );
  container.querySelectorAll("[data-cfgarr]").forEach((el) =>
    (el.oninput = () => emitConfigArrayChange(el.dataset.cfgarr)),
  );
}
function reindexConfigArray(root) {
  root.querySelectorAll(".array-row").forEach((row, i) => {
    row.querySelector("input").dataset.cfgarrI = String(i);
    const [del, up, down] = row.querySelectorAll("button");
    del.dataset.cfgarrDel = String(i);
    up.dataset.cfgarrUp = String(i);
    down.dataset.cfgarrDown = String(i);
  });
}

/** 对象数组编辑器：元素卡片 + 增删拖拽（操作即时保存，保持字段一致） */
function configObjArrayEditor(entry) {
  const { keyPath, value } = entry;
  const items = Array.isArray(value) ? value : [];
  const elems = items
    .map((it, i) => {
      const o = it && typeof it === "object" ? it : {};
      const first = Object.values(o).find((v) => typeof v === "string" && v) || "";
      const summary = first ? `${esc(first)}` : `{ ${Object.keys(o).join(", ") || "空对象"} }`;
      return `<div class="obj-elem">
        <div class="oe-summary">${i + 1}. ${summary}</div>
        <div class="oe-actions">
          <button type="button" class="btn btn-sm mini" data-obj-up="${i}" data-obj-key="${esc(keyPath)}">↑</button>
          <button type="button" class="btn btn-sm mini" data-obj-down="${i}" data-obj-key="${esc(keyPath)}">↓</button>
          <button type="button" class="btn btn-sm btn-danger mini" data-obj-del="${i}" data-obj-key="${esc(keyPath)}">✕</button>
        </div>
      </div>`;
    })
    .join("");
  return `<div class="form-row">
    <div class="row-head"><label>${esc(cfgLabelZh(keyPath))}</label><span class="kpath">${esc(keyPath)}</span></div>
    <div class="obj-array" data-obj-root="${esc(keyPath)}">
      ${elems || `<div class="array-hint">（空数组）</div>`}
      <button type="button" class="btn btn-sm btn-info array-add" data-obj-add="${esc(keyPath)}">＋ 添加元素</button>
    </div>
  </div>`;
}

/** 剔除对象中的 undefined 占位（常量引用字段），避免整体写回变成 null */
function cleanObj(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v;
  return r;
}

function bindConfigObjArray(container) {
  container.querySelectorAll("[data-obj-root]").forEach((rootEl) => {
    const key = rootEl.dataset.objRoot;
    const getCurrent = () => {
      const entry = state.target.fields.find((f) => f.keyPath === key);
      return Array.isArray(entry?.value) ? entry.value.map((o) => (o && typeof o === "object" ? cleanObj(o) : {})) : [];
    };
    rootEl.querySelectorAll("[data-obj-add]").forEach((b) =>
      (b.onclick = () => {
        const arr = getCurrent();
        arr.push({});
        persistObjArray(key, arr, "已添加元素");
      }),
    );
    rootEl.querySelectorAll("[data-obj-del]").forEach((b) =>
      (b.onclick = () => {
        const arr = getCurrent();
        arr.splice(Number(b.dataset.objDel), 1);
        persistObjArray(key, arr, "已删除元素");
      }),
    );
    rootEl.querySelectorAll("[data-obj-up]").forEach((b) =>
      (b.onclick = () => {
        const arr = getCurrent();
        const i = Number(b.dataset.objUp);
        if (i > 0 && arr[i]) {
          [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
          persistObjArray(key, arr, "已上移元素");
        }
      }),
    );
    rootEl.querySelectorAll("[data-obj-down]").forEach((b) =>
      (b.onclick = () => {
        const arr = getCurrent();
        const i = Number(b.dataset.objDown);
        if (i < arr.length - 1 && arr[i]) {
          [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
          persistObjArray(key, arr, "已下移元素");
        }
      }),
    );
  });
}

/** 对象数组结构变更：即时保存 → 重新加载 target（刷新元素字段） */
async function persistObjArray(keyPath, arr, doneMsg) {
  try {
    const data = await api(`/api/config/${state.target.targetId}`, {
      method: "POST",
      body: { changes: [{ keyPath, value: arr }] },
    });
    toast(`${doneMsg}，已保存（${data.saved} 项）`, "ok");
    state.changes.delete(keyPath);
    await selectTarget(state.target.targetId);
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ─────────── 配置管理：面板渲染与保存 ─────────── */
function renderConfigPanel(read) {
  const { top, groups, rawHtml } = groupFields(read.fields);
  const panel = $("#config-panel");

  let html = "";
  if (read.saveNote) {
    html += `<div class="save-note">📌 ${esc(read.saveNote)}</div>`;
  }
  if (read.skipped && read.skipped.length) {
    html += `<div class="skipped-tip">⛔ 以下部分为源码函数/类型定义/预设，后台不做修改，请到源码文件修改：<br>${read.skipped
      .map((s) => `<span class="st-key">${esc(s.keyPath)}</span>：${esc(s.reason)}`)
      .join("<br>")}</div>`;
  }
  if (rawHtml) {
    html += `<div class="form-row">
      <div class="row-head"><label>附属 HTML 内容（整文件编辑）</label><span class="kpath">${esc(rawHtml.keyPath)}</span></div>
      <textarea class="body-editor" data-cfg-rawhtml style="min-height:280px;font-family:Consolas,monospace;font-size:13px;">${esc(rawHtml.value)}</textarea>
    </div>`;
  }

  html += `<div class="form" id="config-form">`;
  for (const f of top) {
    if (Array.isArray(f.value)) {
      const allObj = f.value.length > 0 && f.value.every((v) => v && typeof v === "object");
      html += allObj ? configObjArrayEditor(f) : configArrayEditor(f);
    } else {
      html += configFieldRow(f);
    }
  }
  for (const [gname, g] of groups) {
    const hasNested = g.nested.length > 0;
    const hasElems = g.elems.size > 0;
    if (!hasNested && !hasElems) continue;
    let inner = "";
    for (const f of g.nested) {
      if (Array.isArray(f.value)) {
        const allObj = f.value.length > 0 && f.value.every((v) => v && typeof v === "object");
        inner += allObj ? configObjArrayEditor(f) : configArrayEditor(f);
      } else {
        inner += configFieldRow(f);
      }
    }
    for (const [elemKey, info] of g.elems) {
      const rows = info.entries
        .map((f) => configFieldRow(f, cfgLabelZh(f.keyPath.slice(f.keyPath.lastIndexOf("]") + 1))))
        .join("");
      inner += `<div class="panel panel-sub collapsed" data-elem-panel="${esc(elemKey)}">
        <div class="panel-head" data-toggle><span class="p-title">🧩 ${esc(elemLabelZh(elemKey, info.entries))}</span><span class="p-meta">${esc(elemKey)}</span><span class="p-arrow">▶</span></div>
        <div class="panel-body">${rows}</div>
      </div>`;
    }
    html += `<div class="panel collapsed">
      <div class="panel-head" data-toggle>
        <span class="p-title">📦 ${esc(cfgLabelZh(gname))}</span>
        <span class="p-meta">${g.nested.length + [...g.elems.values()].reduce((s, e) => s + e.entries.length, 0)} 个字段</span>
        <span class="p-arrow">▶</span>
      </div>
      <div class="panel-body">${inner}</div>
    </div>`;
  }
  html += `</div>`;

  html += `<div class="config-savebar">
    <button class="btn btn-primary" id="btn-config-save-inline">💾 保存全部变更</button>
    <span class="sb-count" id="config-changed-count">暂无变更</span>
  </div>`;

  panel.innerHTML = html;

  // 折叠面板
  panel.querySelectorAll("[data-toggle]").forEach((h) =>
    (h.onclick = () => h.closest(".panel").classList.toggle("collapsed")),
  );

  // 标量字段变更收集
  panel.querySelectorAll("[data-cfg]").forEach((el) => {
    const keyPath = el.dataset.cfg;
    const orig = read.fields.find((f) => f.keyPath === keyPath);
    const record = () => {
      let v;
      if (el.type === "checkbox") v = el.checked;
      else if (el.type === "number") v = el.value === "" ? "" : Number(el.value);
      else v = el.value;
      if (orig && v === orig.value) state.changes.delete(keyPath);
      else state.changes.set(keyPath, { value: v, hasQuote: orig?.hasQuote });
      refreshConfigSaveCount();
    };
    el.addEventListener("change", record);
    el.addEventListener("input", () => {
      if (el.type === "text" || el.type === "number") record();
    });
  });

  // __raw_html 变更收集
  const rawEl = panel.querySelector("[data-cfg-rawhtml]");
  if (rawEl) {
    const record = () => state.changes.set("__raw_html", { value: rawEl.value, hasQuote: false });
    rawEl.addEventListener("input", record);
  }

  // 数组编辑器
  bindConfigArrayEditor(panel);
  bindConfigObjArray(panel);

  $("#btn-config-save-inline").onclick = saveTarget;
  refreshConfigSaveCount();
}

function refreshConfigSaveCount() {
  const el = $("#config-changed-count");
  if (!el) return;
  const n = state.changes.size;
  el.textContent = n === 0 ? "暂无变更" : `已修改 ${n} 项（未保存）`;
}

async function saveTarget() {
  const changes = [...state.changes.entries()].map(([keyPath, c]) => ({
    keyPath,
    value: c.value,
    hasQuote: c.hasQuote,
  }));
  if (!changes.length) {
    toast("没有需要保存的变更", "");
    return;
  }
  try {
    const data = await api(`/api/config/${state.target.targetId}`, { method: "POST", body: { changes } });
    const note = data.note ? `；${data.note}` : "";
    toast(`已保存 ${data.saved} 项变更${note}`, "ok");
    state.changes.clear();
    await selectTarget(state.target.targetId);
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ─────────── 未选择模块/配置时：渲染 read.md 或 read.html 欢迎内容 ─────────── */
function mdEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 行内语法：行内代码 / 加粗 / 斜体 / 图片 / 链接 */
function mdInline(s) {
  let t = s;
  t = t.replace(/`([^`\n]+)`/g, (_, c) => `<code>${mdEscape(c)}</code>`);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}

/** 轻量 Markdown 渲染：标题 / 分隔线 / 引用 / 列表 / 代码块 / 段落 */
function renderMarkdown(md) {
  const codeBlocks = [];
  let text = String(md ?? "").replace(/\r\n/g, "\n").trim() + "\n";
  // 先整体提取围栏代码块，避免内部内容被当作正文解析
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      `<pre><code class="lang-${mdEscape(lang)}">${mdEscape(code.replace(/\n$/, ""))}</code></pre>`,
    );
    return `\u0000${idx}\u0000`;
  });
  const lines = text.split("\n");
  const out = [];
  let para = [];
  let list = null; // { ordered, items }
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${mdInline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      out.push(`<${tag}>${list.items.map((li) => `<li>${mdInline(li)}</li>`).join("")}</${tag}>`);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    const codeHit = /^\u0000(\d+)\u0000$/.exec(line);
    if (codeHit) {
      flushPara();
      flushList();
      out.push(codeBlocks[Number(codeHit[1])]);
      continue;
    }
    if (line === "") {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      flushPara();
      flushList();
      out.push("<hr />");
      continue;
    }
    if (line.startsWith(">")) {
      flushPara();
      flushList();
      out.push(`<blockquote>${mdInline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join("\n");
}

/**
 * 面板欢迎内容：优先渲染 admin/public/read.md，其次 read.html；
 * - read.md 由内置渲染器生成受控 HTML，直接注入
 * - read.html 通过 iframe 独立加载，其内部 <style>/<script> 仅作用于该文件，不会污染后台全局
 * 两者都不存在则保持空白。文件由你自己编辑。
 */
async function renderWelcome(container) {
  try {
    const mdRes = await fetch("/admin/read.md", { cache: "no-store" });
    if (mdRes.ok) {
      container.innerHTML = `<div class="welcome">${renderMarkdown(await mdRes.text())}</div>`;
      return;
    }
  } catch {
    /* 忽略：继续尝试 html */
  }
  try {
    const htmlRes = await fetch("/admin/read.html", { cache: "no-store" });
    if (htmlRes.ok) {
      container.innerHTML = "";
      const frame = document.createElement("iframe");
      frame.className = "welcome-frame";
      frame.setAttribute("title", "欢迎内容");
      frame.src = "/admin/read.html";
      container.appendChild(frame);
      // 高度自适应：加载完成后按内容高度撑开，避免出现内部滚动条
      frame.onload = () => {
        try {
          const doc = frame.contentDocument;
          if (doc) frame.style.height = `${doc.documentElement.scrollHeight}px`;
        } catch {
          /* 跨域不可读时保持默认高度 */
        }
      };
    }
  } catch {
    /* 忽略：文件不存在时留空 */
  }
}

/* ─────────── 初始化 ─────────── */
function initMain() {
  loadModules().catch((e) => toast(e.message, "err"));
  loadTargets().catch((e) => toast(e.message, "err"));
  renderWelcome($("#content-panel"));
  renderWelcome($("#config-panel"));
}

function init() {
  // 登录
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("#login-password").value;
    try {
      await doLogin(pw);
      $("#login-password").value = "";
    } catch (err) {
      $("#login-hint").textContent = err.message;
    }
  });

  // Tab 切换
  $$(".appbar-tabs a[data-tab]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); switchTab(a.dataset.tab); }));

  // 退出
  $("#btn-logout").onclick = (e) => {
    e.preventDefault();
    logout("已退出登录");
  };

  // 博客地址（「预览」按钮跳转用），保存到 localStorage 覆盖服务端默认值
  $("#blog-base-input").value = state.blogBase || "";
  $("#btn-blog-base").onclick = () => {
    const v = $("#blog-base-input").value.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(v)) {
      toast("请输入以 http:// 或 https:// 开头的博客地址", "err");
      return;
    }
    localStorage.setItem("blog_base", v);
    state.blogBase = v;
    toast("博客地址已保存 ✓");
  };

  // 弹窗关闭
  $("#modal-close").onclick = closeModal;
  $("#modal-mask").addEventListener("click", (e) => {
    if (e.target === $("#modal-mask")) closeModal();
  });

  // 内容面板按钮
  $("#btn-create").onclick = openCreate;
  $("#btn-backups").onclick = openBackups;
  $("#btn-save-config").onclick = saveTarget;

  // 恢复登录态
  try {
    const saved = JSON.parse(localStorage.getItem("blog_admin_token") || "null");
    if (saved && saved.token && saved.expiresAt && new Date(saved.expiresAt).getTime() > Date.now()) {
      state.token = saved.token;
      state.blogBase = localStorage.getItem("blog_base") || "";
      showMain();
      initMain();
      return;
    }
  } catch { /* 忽略损坏的 token */ }
  localStorage.removeItem("blog_admin_token");
  showLogin();
}

/** 从 /api/health 获取博客站点地址（预览按钮用），允许 localStorage 覆盖 */
async function loadBlogBase() {
  try {
    const r = await fetch("/api/health");
    const d = await r.json();
    if (d.blogBaseUrl) state.blogBase = localStorage.getItem("blog_base") || d.blogBaseUrl;
  } catch { /* 使用默认值 */ }
  if (!state.blogBase) state.blogBase = "http://localhost:4321";
  const input = $("#blog-base-input");
  if (input) input.value = state.blogBase;
}

document.addEventListener("DOMContentLoaded", () => { init(); loadBlogBase(); });
