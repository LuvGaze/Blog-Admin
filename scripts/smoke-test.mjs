/**
 * API 冒烟测试（admin 独立工程）
 * 运行前提：已在 admin/.env 配置 ADMIN_PASSWORD 并启动服务（npm run dev / npm start）
 * 用法：node scripts/smoke-test.mjs
 * 覆盖：鉴权 / 15 个内容模块 / 25 个配置 target / YAML 引号与空值更新语义 /
 *       文件夹分组 CRUD（友链、网站导航）/ 单文件模块（about.mdx、spec）/ 备份恢复 / 静态后台页
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.TEST_BASE || "http://localhost:8899";

/** 从 admin/.env 读取 ADMIN_PASSWORD（测试密码与运行环境保持一致） */
function readEnvPassword() {
  try {
    const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
    const raw = readFileSync(envFile, "utf8");
    const m = raw.match(/^\s*ADMIN_PASSWORD\s*=\s*(.+?)\s*$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

const PASSWORD = process.env.TEST_PASSWORD || readEnvPassword() || "change-me";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let pass = 0;
let fail = 0;
let token = "";
const created = []; // 测试创建的条目（{module, id}），最后清理

function assert(cond, msg) {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${msg}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${msg}`);
  }
}

async function req(pathName, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${pathName}`, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

async function section(title) {
  console.log(`\n== ${title} ==`);
}

// ─────────── 1. 鉴权 ───────────
await section("鉴权");
{
  let r = await req("/api/modules");
  assert(r.status === 401, "未带 token 访问 API 返回 401");

  r = await req("/api/auth/login", { method: "POST", body: { password: "wrong" } });
  assert(r.status === 401, "错误密码登录返回 401");

  r = await req("/api/auth/login", { method: "POST", body: { password: PASSWORD } });
  assert(r.status === 200 && r.data.token, "正确密码登录返回 token");
  if (r.data?.token) token = r.data.token;
}

// ─────────── 2. 基础信息 ───────────
await section("基础信息");
{
  let r = await req("/api/health");
  assert(r.status === 200 && r.data.ok === true, "/api/health 正常");
  assert(typeof r.data.blogBaseUrl === "string", "/api/health 返回 blogBaseUrl（预览用）");

  r = await req("/api/modules");
  assert(r.status === 200 && Array.isArray(r.data.modules), "/api/modules 返回模块数组");
  assert(r.data.modules?.length === 15, `模块数量为 15（实际 ${r.data.modules?.length}）`);
  assert(r.data.modules?.every((m) => typeof m.urlPrefix === "string"), "模块清单带 urlPrefix（预览按钮用）");
  const grouped = r.data.modules?.filter((m) => m.grouped).map((m) => m.id) ?? [];
  assert(grouped.includes("friends") && grouped.includes("website"), `分组模块为 friends/website（实际 ${grouped.join(",")}）`);
  const about = r.data.modules?.find((m) => m.id === "about");
  assert(about?.isSingleFile === true && about?.fields?.length === 0, "about 为单文件模块且无字段（正文编辑）");
  const nb = r.data.modules?.find((m) => m.isNotebooks);
  assert(nb && Array.isArray(nb.fields) && Array.isArray(nb.noteFields), "notebooks 模块带 fields + noteFields");

  r = await req("/api/config");
  assert(r.data.targets?.length === 25, `配置 target 数量为 25（实际 ${r.data.targets?.length}）`);
  assert(r.data.targets?.every((t) => typeof t.group === "string"), "配置 target 带分组 group（侧边栏分组）");
}

// ─────────── 3. 配置 TS-AST 读写 ───────────
await section("配置 TS-AST 读写（site：改 title 后还原）");
{
  let r = await req("/api/config/site");
  assert(r.status === 200 && Array.isArray(r.data.fields), "读取 site 返回 fields");
  const titleField = r.data.fields?.find((f) => f.keyPath === "title");
  assert(titleField !== undefined, "site 含 title 字段");
  const origTitle = titleField?.value;
  assert(typeof origTitle === "string", "title 原始值为字符串");
  assert(Array.isArray(r.data.skipped), "site 返回 skipped 数组");

  r = await req("/api/config/site", {
    method: "POST",
    body: { changes: [{ keyPath: "title", value: "冒烟测试标题", hasQuote: true }] },
  });
  assert(r.status === 200 && r.data.saved >= 1, "修改 site.title 成功");
  r = await req("/api/config/site");
  assert(r.data.fields?.find((f) => f.keyPath === "title")?.value === "冒烟测试标题", "回读 title 已修改");

  // 磁盘上应保留双引号字符串
  const sitePath = path.join(ROOT, "src", "config", "siteConfig.ts");
  const raw = readFileSync(sitePath, "utf8");
  assert(raw.includes('title: "冒烟测试标题"'), "磁盘写入保持双引号字符串");

  r = await req("/api/config/site", {
    method: "POST",
    body: { changes: [{ keyPath: "title", value: origTitle, hasQuote: true }] },
  });
  assert(r.status === 200, "title 还原成功");
  r = await req("/api/config/site");
  assert(r.data.fields?.find((f) => f.keyPath === "title")?.value === origTitle, `回读 title 已还原为「${origTitle}」`);
}

await section("配置特殊 target（footer / navbar / pio / music）");
{
  let r = await req("/api/config/footer");
  assert(r.data.fields?.some((f) => f.keyPath === "__raw_html"), "footer 含 __raw_html 虚拟字段");

  r = await req("/api/config/navbar");
  assert(r.data.skipped?.some((s) => s.keyPath === "LinkPresets"), "navbar skipped 含 LinkPresets");

  r = await req("/api/config/pio");
  assert(r.data.fields?.some((f) => f.keyPath === "spineModelConfig.model.path"), "pio 含 spineModelConfig.model.path（多导出）");

  r = await req("/api/config/music");
  assert(r.data.fields?.some((f) => f.keyPath === "local.playlist" && Array.isArray(f.value)), "music 含 local.playlist 对象数组整体字段");
  assert(r.data.fields?.some((f) => /^local\.playlist\[\d+\]\./.test(f.keyPath)), "music 含 local.playlist[i].* 元素字段");

  r = await req("/api/config/circle");
  assert(r.status === 200 && Array.isArray(r.data.fields), "circle 配置可读（朋友圈数据源）");
  r = await req("/api/config/cursor");
  assert(r.status === 200, "cursor 配置可读（鼠标指针）");
  r = await req("/api/config/font");
  assert(r.status === 200, "font 配置可读（全局字体）");
  r = await req("/api/config/externalBangumi");
  assert(r.status === 200, "externalBangumi 配置可读（追番数据源）");

  r = await req("/api/config/not-exist");
  assert(r.status === 404, "未知 target 返回 404");
}

// ─────────── 4. 内容模块：创建/读取/更新/备份/删除 ───────────
await section("内容模块（posts：创建 → 更新引号保留 → 空值删除 → 备份 → 删除）");
{
  let r = await req("/api/content/posts");
  assert(r.status === 200 && Array.isArray(r.data), "posts 列表返回数组");

  const body = {
    data: {
      title: "冒烟测试-引号保留",
      published: "2026-08-06",
      category: "测试",
      tags: ["测试", "2026-09-14"],
      description: "冒烟测试创建的临时文章",
    },
    body: "# 冒烟测试\n\n这是一篇用于验证的临时文章。",
  };
  r = await req("/api/content/posts", { method: "POST", body });
  assert(r.status === 201 && r.data.id, "创建测试文章成功");
  const id = r.data?.id;
  created.push({ module: "posts", id });

  const filePath = path.join(ROOT, "src", "content", "posts", id);
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf8");
    assert(raw.includes("title: 冒烟测试-引号保留"), "磁盘文件 title 按 posts 规范无引号写入");
    assert(raw.includes("tags: [测试"), "数组为 flow 格式");
    assert(raw.includes('"2026-09-14"'), "数组元素中的日期样式字符串被强制双引号（避免教程 YAML 误判）");
  } else {
    assert(false, "测试文件已写入磁盘");
  }

  r = await req(`/api/content/posts/${encodeURIComponent(id)}`);
  assert(r.data?.fields?.title === "冒烟测试-引号保留" && r.data.body.includes("临时文章"), "详情回读字段与正文正确");
  assert(r.data?.fields?.image === "api", "image 留空自动归一化为 api");
  assert(r.data?.fields?.published === "2026-08-06", "published 日期读回原始字符串（非 ISO 时间戳）");

  r = await req(`/api/content/posts/${encodeURIComponent(id)}`, { method: "PUT", body: { data: { title: "冒烟测试-已修改" } } });
  assert(r.status === 200, "更新文章成功");
  r = await req(`/api/content/posts/${encodeURIComponent(id)}`);
  assert(r.data?.fields?.title === "冒烟测试-已修改", "更新后 title 生效");
  assert(r.data?.fields?.tags?.length === 2, "未传字段 tags 原样保留");

  // 空值语义：提交空字符串删除该字段
  r = await req(`/api/content/posts/${encodeURIComponent(id)}`, { method: "PUT", body: { data: { description: "" } } });
  assert(r.status === 200, "提交空字符串更新成功");
  r = await req(`/api/content/posts/${encodeURIComponent(id)}`);
  assert(!("description" in (r.data?.fields ?? {})), "空字符串提交后 description 字段被删除");

  r = await req("/api/content/posts/backups");
  assert(r.status === 200 && r.data.some((b) => b.name.includes(id.split(".")[0])), "备份列表包含刚更新产生的备份");
  const backupName = r.data?.find((b) => b.name.includes(id.split(".")[0]))?.name;

  if (backupName) {
    r = await req("/api/content/posts/restore", { method: "POST", body: { backupName } });
    assert(r.status === 200, "恢复备份成功");
    r = await req(`/api/content/posts/${encodeURIComponent(id)}`);
    assert(r.data?.fields?.title === "冒烟测试-已修改", "恢复后 title 回到备份时的值");
  }

  r = await req(`/api/content/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
  assert(r.status === 200, "删除测试文章成功（自动备份）");
  created.pop();
  r = await req("/api/content/posts");
  assert(!r.data.some((it) => it.id === id), "列表中已无测试文章");
}

await section("内容模块（单文件模块 about.mdx / spec 页面）");
{
  let r = await req("/api/content/about");
  assert(r.status === 200 && r.data.length === 1 && r.data[0].id === "about.mdx", `about 只返回 about.mdx（实际 ${r.data?.map((x) => x.id).join(",") ?? "失败"}）`);

  r = await req("/api/content/about/about.mdx");
  assert(r.status === 200 && r.data.hasFrontmatter === false, "about.mdx 无 frontmatter 可读");
  assert(typeof r.data.body === "string" && r.data.body.includes("AboutProfileCard"), "about.mdx 正文为 MDX 原文");

  r = await req("/api/content/about/about.mdx", { method: "DELETE" });
  assert(r.status === 400, "单文件模块禁止删除（400）");

  r = await req("/api/content/about", { method: "POST", body: { data: {} } });
  assert(r.status === 400, "单文件模块禁止新建（400）");

  r = await req("/api/content/specFriends");
  assert(r.data.length === 1 && r.data[0].id === "friends.mdx", "specFriends 只返回 friends.mdx");
  r = await req("/api/content/guestbook");
  assert(r.data.length === 1 && r.data[0].id === "guestbook.md", "guestbook 只返回 guestbook.md");
  r = await req("/api/content/guestbook/guestbook.md");
  assert(r.data?.fields?.title === "留言板", "guestbook frontmatter 标题可读");
}

// ─────────── 5. 文件夹分组（友链 / 网站导航） ───────────
await section("分组元数据（friends / website）");
{
  let r = await req("/api/content/friends/groups");
  assert(r.status === 200 && Array.isArray(r.data) && r.data.length >= 2, `friends 分组非空（实际 ${r.data?.length}）`);
  const first = r.data?.[0];
  assert(first && typeof first.fields?.sort === "number", "friends 分组带 sort 元数据");
  const sorts = r.data?.map((g) => g.fields?.sort ?? 0) ?? [];
  assert(sorts.every((v, i) => i === 0 || sorts[i - 1] >= v), "friends 分组按 sort 降序");

  r = await req("/api/content/website/groups");
  assert(r.status === 200 && r.data.length >= 2, `website 分组非空（实际 ${r.data?.length}）`);
  const ws = r.data?.[0];
  assert(ws && typeof ws.fields?.icon === "string", "website 分组带 icon 元数据");

  r = await req("/api/content/friends");
  assert(r.data.every((it) => typeof it.group === "string"), "friends 条目带 group 字段");
  assert(r.data.some((it) => it.group !== ""), "friends 条目分组来自文件夹");
  const meta = r.data.find((it) => it.group !== "");
  r = await req(`/api/content/friends/${encodeURIComponent(meta.id)}`);
  assert(r.data?.group === meta.group, "嵌套 id（分组/文件.md）可正常读取");
}

// ─────────── 5.5 分组 CRUD（临时分组，自动清理） ───────────
await section("分组 CRUD（website：建组 → 建条目 → 清空字段 → 删条目 → 删组）");
{
  let groupId = "";
  let itemId = "";
  try {
    let r = await req("/api/content/website/groups", {
      method: "POST",
      body: { data: { name: "冒烟测试组", title: "冒烟测试组", icon: "material-symbols:star", order: 5 } },
    });
    assert(r.status === 201 && r.data.id, "新建分组成功");
    groupId = r.data?.id ?? "";

    r = await req("/api/content/website/groups");
    assert(r.data.some((g) => g.id === groupId), "分组列表包含新建分组");

    r = await req("/api/content/website", {
      method: "POST",
      body: { data: { name: "冒烟站点", url: "https://example.com", description: "初始描述" }, group: groupId },
    });
    assert(r.status === 201 && r.data.id?.startsWith(`${groupId}/`), "在指定分组下新建条目（id 含分组前缀）");
    itemId = r.data.id;

    r = await req(`/api/content/website/${encodeURIComponent(itemId)}`);
    assert(r.data?.group === groupId && r.data?.fields?.name === "冒烟站点", "分组条目详情正确");

    r = await req(`/api/content/website/${encodeURIComponent(itemId)}`, {
      method: "PUT",
      body: { data: { name: "冒烟站点", url: "https://example.com", description: "" } },
    });
    assert(r.status === 200, "清空可选字段成功");
    r = await req(`/api/content/website/${encodeURIComponent(itemId)}`);
    assert(!("description" in (r.data?.fields ?? {})), "清空后 description 字段被删除");

    r = await req(`/api/content/website/groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });
    assert(r.status === 400, "分组内仍有内容时禁止删除（400）");

    r = await req(`/api/content/website/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    assert(r.status === 200, "删除分组条目成功");
    itemId = "";

    r = await req(`/api/content/website/groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });
    assert(r.status === 200, "删除空分组成功");
    assert(!existsSync(path.join(ROOT, "src", "content", "website", groupId)), "分组目录已移除");
    groupId = "";
  } finally {
    if (itemId) await req(`/api/content/website/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    if (groupId) await req(`/api/content/website/groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });
  }
}

// ─────────── 6. notebooks ───────────
await section("内容模块（notebooks：元数据 + 笔记）");
{
  let r = await req("/api/content/notebooks");
  assert(r.status === 200 && Array.isArray(r.data), "notebooks 列表返回数组");
  assert(r.data.length >= 1, "存在笔记本");
  const nb = r.data[0];
  assert(nb.fields && typeof nb.fields === "object", "笔记本列表带 fields（_index.json 元信息）");

  r = await req(`/api/content/notebooks/${encodeURIComponent(nb.id)}`);
  assert(r.data?.notes && Array.isArray(r.data.notes), "笔记本详情含笔记列表");
  assert(r.data?.fields?.name !== undefined, "笔记本详情 fields 含 name");
  const firstNote = r.data?.notes?.[0]?.id;
  if (firstNote) {
    r = await req(`/api/content/notebooks/${encodeURIComponent(nb.id)}/notes/${encodeURIComponent(firstNote)}`);
    assert(r.data?.fields?.title !== undefined, "笔记详情可读取");
  }
}

// ─────────── 6.5 备份增强（books 目录快照） ───────────
await section("备份增强（books：手动目录快照 → 修改 → 目录恢复）");
{
  let r = await req("/api/content/books");
  assert(r.status === 200 && r.data.length >= 1, "books 列表非空");
  const bookId = r.data[0].id;
  r = await req(`/api/content/books/${encodeURIComponent(bookId)}`);
  const origScore = r.data?.fields?.score;
  const origComment = r.data?.fields?.comment;

  r = await req("/api/content/books/backups", { method: "POST" });
  assert(r.status === 201 && Array.isArray(r.data?.created), "POST /books/backups 手动备份成功");
  const snapName = r.data?.created?.[0];

  r = await req("/api/content/books/backups");
  const snap = r.data?.find((b) => b.name === snapName);
  assert(snap && snap.isDirSnapshot === true, "备份列表含刚创建的目录快照（isDirSnapshot=true）");

  const newScore = origScore === 9.9 ? 8.8 : 9.9;
  r = await req(`/api/content/books/${encodeURIComponent(bookId)}`, {
    method: "PUT",
    body: { data: { score: newScore, comment: "冒烟测试-临时修改" } },
  });
  assert(r.status === 200, "修改书籍 score/comment 成功");
  r = await req(`/api/content/books/${encodeURIComponent(bookId)}`);
  assert(r.data?.fields?.score === newScore, "修改后 score 生效");

  r = await req("/api/content/books/restore", { method: "POST", body: { backupName: snapName } });
  assert(r.status === 200, "目录快照恢复成功");
  r = await req(`/api/content/books/${encodeURIComponent(bookId)}`);
  assert(r.data?.fields?.score === origScore, "恢复后 score 回到备份时值");
  assert(r.data?.fields?.comment === origComment, "恢复后 comment 回到备份时值");
}

// ─────────── 7. 数字枚举（movies status） ───────────
await section("内容模块（movies：status 写回数字 1~5，非字符串）");
{
  const body = { data: { title: "冒烟测试-状态", subcategory: "movie", status: 3, score: 7.5 }, body: "" };
  let r = await req("/api/content/movies", { method: "POST", body });
  assert(r.status === 201 && r.data.id, "创建测试影视成功");
  const id = r.data?.id;
  created.push({ module: "movies", id });

  r = await req(`/api/content/movies/${encodeURIComponent(id)}`);
  assert(r.data?.fields?.status === 3, "回读 status === 3（数字）");

  const filePath = path.join(ROOT, "src", "content", "movies", id);
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf8");
    assert(/^status:\s*3\s*$/m.test(raw), "磁盘文件 status 为数字 3（无引号）");
    assert(!/^status:\s*["']3["']/m.test(raw), "磁盘文件 status 非字符串");
  } else {
    assert(false, "测试影视文件已写入磁盘");
  }

  r = await req(`/api/content/movies/${encodeURIComponent(id)}`, { method: "DELETE" });
  assert(r.status === 200, "删除测试影视成功");
  created.pop();
}

// ─────────── 8. 校验与安全 ───────────
await section("校验与安全");
{
  let r = await req("/api/content/posts", { method: "POST", body: { data: { published: "2026-08-06" } } });
  assert(r.status === 400, "缺少必填 title 返回 400");

  r = await req("/api/content/posts/..%2F..%2Fpackage.json");
  assert(r.status === 400 || r.status === 404, "路径穿越文件名被拒绝");

  r = await req("/api/content/friends/a%2Fb%2Fc.md");
  assert(r.status === 400 || r.status === 404, "超过两级的嵌套路径被拒绝");
}

// ─────────── 9. 静态后台页 ───────────
await section("后台静态页面");
{
  const res = await fetch(`${BASE}/admin`);
  const html = await res.text();
  assert(res.status === 200 && html.includes("view-login"), "GET /admin 返回登录页");

  const css = await fetch(`${BASE}/admin/css/kraft.css`);
  assert(css.status === 200, "GET /admin/css/kraft.css 正常");

  const js = await fetch(`${BASE}/admin/js/app.js`);
  assert(js.status === 200, "GET /admin/js/app.js 正常");
}

// ─────────── 清理兜底 ───────────
for (const item of created) {
  try {
    await req(`/api/content/${item.module}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    console.log(`  清理测试条目 ${item.module}/${item.id}`);
  } catch { /* ignore */ }
}

console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
process.exit(fail > 0 ? 1 : 0);
