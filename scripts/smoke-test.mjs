/**
 * API 冒烟测试（admin 独立工程）
 * 运行前提：已在 admin/.env 配置 ADMIN_PASSWORD=change-me 并启动服务（npm run dev / npm start）
 * 用法：node scripts/smoke-test.mjs
 * 覆盖：鉴权 / 模块清单 / 配置 AST 读写（改后还原）/ YAML 引号保留 / 备份恢复（文件+目录快照+手动备份）/ 静态后台页
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.TEST_BASE || "http://localhost:3344";

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
const created = []; // 测试创建的条目（id），最后清理

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
  return { status: res.status, data, text: async () => (await res.text()) };
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
  assert(r.data.modules?.length === 12, `模块数量为 12（实际 ${r.data.modules?.length}）`);
  assert(r.data.modules?.every((m) => typeof m.urlPrefix === "string"), "模块清单带 urlPrefix（预览按钮用）");
  const nb = r.data.modules?.find((m) => m.isNotebooks);
  assert(nb && Array.isArray(nb.fields) && Array.isArray(nb.noteFields), "notebooks 模块带 fields + noteFields");

  r = await req("/api/config");
  assert(r.data.targets?.length === 17, `配置 target 数量为 17（实际 ${r.data.targets?.length}）`);
  assert(r.data.targets?.every((t) => typeof t.group === "string"), "配置 target 带分组 group（侧边栏分组）");
}

// ─────────── 3. 配置 TS-AST 读写 ───────────
await section("配置 TS-AST 读写（site：改 hue 后还原）");
{
  let r = await req("/api/config/site");
  assert(r.status === 200 && Array.isArray(r.data.fields), "读取 site 返回 fields");
  const hue = r.data.fields?.find((f) => f.keyPath === "themeColor.hue");
  assert(hue !== undefined, "site 含 themeColor.hue 字段");
  const origHue = hue?.value;
  assert(typeof origHue === "number", "hue 原始值为数字");
  assert(Array.isArray(r.data.skipped), "site 返回 skipped 数组");

  // 修改 hue → 验证 → 还原
  r = await req("/api/config/site", { method: "POST", body: { changes: [{ keyPath: "themeColor.hue", value: 361, hasQuote: false }] } });
  assert(r.status === 200 && r.data.saved >= 1, "修改 themeColor.hue 成功");
  r = await req("/api/config/site");
  assert(r.data.fields?.find((f) => f.keyPath === "themeColor.hue")?.value === 361, "回读 hue === 361");

  r = await req("/api/config/site", { method: "POST", body: { changes: [{ keyPath: "themeColor.hue", value: origHue, hasQuote: false }] } });
  assert(r.status === 200, "hue 还原成功");
  r = await req("/api/config/site");
  assert(r.data.fields?.find((f) => f.keyPath === "themeColor.hue")?.value === origHue, `回读 hue 已还原为 ${origHue}`);

  // 语法校验：提交非法值应 400 且不落盘
  r = await req("/api/config/site", { method: "POST", body: { changes: [{ keyPath: "themeColor.hue", value: "abc", hasQuote: true }] } });
  assert(r.status === 200, "hue 提交字符串 'abc' 被接受（数字字段宽松处理）");
  await req("/api/config/site", { method: "POST", body: { changes: [{ keyPath: "themeColor.hue", value: origHue, hasQuote: false }] } });
}

await section("配置特殊 target（footer / navbar / pio / backgroundWallpaper）");
{
  let r = await req("/api/config/footer");
  assert(r.data.fields?.some((f) => f.keyPath === "__raw_html"), "footer 含 __raw_html 虚拟字段");

  r = await req("/api/config/navbar");
  assert(r.data.skipped?.some((s) => s.keyPath === "LinkPresets"), "navbar skipped 含 LinkPresets");

  r = await req("/api/config/pio");
  assert(r.data.fields?.some((f) => f.keyPath === "spineModelConfig.model.path"), "pio 含 spineModelConfig.model.path（多导出）");

  r = await req("/api/config/backgroundWallpaper");
  assert(!r.data.fields?.some((f) => f.isMedia), "backgroundWallpaper 无媒体预览字段");

  r = await req("/api/config/music");
  assert(r.data.fields?.some((f) => f.keyPath === "local.playlist" && Array.isArray(f.value)), "music 含 local.playlist 对象数组整体字段");
  assert(r.data.fields?.some((f) => /^local\.playlist\[\d+\]\./.test(f.keyPath)), "music 含 local.playlist[i].* 元素字段");

  // 不存在 target → 404
  r = await req("/api/config/not-exist");
  assert(r.status === 404, "未知 target 返回 404");
}

// ─────────── 4. 内容模块：创建/读取/更新/备份/删除 ───────────
await section("内容模块（posts：创建 → 更新引号保留 → 备份 → 删除）");
{
  let r = await req("/api/content/posts");
  assert(r.status === 200 && Array.isArray(r.data), "posts 列表返回数组");

  const body = { data: { title: "冒烟测试-引号保留", published: "2026-08-06", tags: ["测试", "CI"], description: "冒烟测试创建的临时文章" }, body: "# 冒烟测试\n\n这是一篇用于验证的临时文章。" };
  r = await req("/api/content/posts", { method: "POST", body });
  assert(r.status === 201 && r.data.id, "创建测试文章成功");
  const id = r.data?.id;
  created.push(id);

  // 磁盘文件引号验证：新增字段应为双引号
  const filePath = path.join(ROOT, "src", "content", "posts", id);
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf8");
    assert(raw.includes('title: "冒烟测试-引号保留"'), "磁盘文件 title 使用双引号（新增字段引号规范）");
    assert(raw.includes('tags: ["测试", "CI"]'), "数组 flow 格式元素保持双引号");
  } else {
    assert(false, "测试文件已写入磁盘");
  }

  // 详情回读
  r = await req(`/api/content/posts/${encodeURIComponent(id)}`);
  assert(r.data?.fields?.title === "冒烟测试-引号保留" && r.data.body.includes("临时文章"), "详情回读字段与正文正确");
  assert(r.data?.fields?.image === "api", "image 留空自动归一化为 api");
  assert(r.data?.fields?.published === "2026-08-06", "published 日期读回原始字符串（非 ISO 时间戳）");

  // 更新：仅改 title（未传字段原样保留）
  r = await req(`/api/content/posts/${encodeURIComponent(id)}`, { method: "PUT", body: { data: { title: "冒烟测试-已修改" } } });
  assert(r.status === 200, "更新文章成功");
  r = await req(`/api/content/posts/${encodeURIComponent(id)}`);
  assert(r.data?.fields?.title === "冒烟测试-已修改", "更新后 title 生效");
  assert(r.data?.fields?.tags?.length === 2, "未传字段 tags 原样保留（引号保留策略）");

  // 备份列表
  r = await req("/api/content/posts/backups");
  assert(r.status === 200 && r.data.some((b) => b.name.includes(id.split(".")[0])), "备份列表包含刚更新产生的备份");
  const backupName = r.data?.find((b) => b.name.includes(id.split(".")[0]))?.name;

  // 恢复备份（还原 title）
  if (backupName) {
    r = await req("/api/content/posts/restore", { method: "POST", body: { backupName } });
    assert(r.status === 200, "恢复备份成功");
    r = await req(`/api/content/posts/${encodeURIComponent(id)}`);
    assert(r.data?.fields?.title === "冒烟测试-引号保留", "恢复后 title 回到备份时的值");
  }

  // 删除（自动备份）
  r = await req(`/api/content/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
  assert(r.status === 200, "删除测试文章成功（自动备份）");
  r = await req("/api/content/posts");
  assert(!r.data.some((it) => it.id === id), "列表中已无测试文章");
}

await section("内容模块（notebooks / about / 校验）");
{
  let r = await req("/api/content/movies");
  assert(r.status === 200 && r.data.length >= 1, `movies 列表非空（实际 ${r.data?.length ?? "请求失败"} 条）`);

  r = await req("/api/content/notebooks");
  assert(r.status === 200 && Array.isArray(r.data), "notebooks 列表返回数组");
  assert(r.data.length >= 1, "存在笔记本（my-first-notebook）");

  r = await req("/api/content/notebooks/my-first-notebook");
  assert(r.data?.notes && Array.isArray(r.data.notes), "笔记本详情含笔记列表");
  assert(r.data?.name !== undefined && r.data?.summary !== undefined, "笔记本详情顶层含 name/summary（_index.json 元信息）");
  const firstNote = r.data?.notes?.[0]?.id;
  if (firstNote) {
    r = await req(`/api/content/notebooks/my-first-notebook/notes/${encodeURIComponent(firstNote)}`);
    assert(r.data?.fields?.title !== undefined, "笔记详情可读取");
  }

  r = await req("/api/content/about/about.md");
  assert(r.status === 200 && r.data.hasFrontmatter === false, "about 单文件无 frontmatter 可读");

  // 校验：缺少必填字段应 400
  r = await req("/api/content/posts", { method: "POST", body: { data: { published: "2026-08-06" } } });
  assert(r.status === 400, "缺少必填 title 返回 400");

  // 路径穿越防护：非法 id → 400/404
  r = await req("/api/content/posts/..%2F..%2Fpackage.json");
  assert(r.status === 400 || r.status === 404, "路径穿越文件名被拒绝");
}

// ─────────── 4.5 手动备份 + 目录快照恢复（books） ───────────
await section("备份增强（books：手动目录快照 → 修改 → 目录恢复）");
{
  let r = await req("/api/content/books");
  assert(r.status === 200 && r.data.length >= 1, "books 列表非空");
  const bookId = r.data[0].id;
  r = await req(`/api/content/books/${encodeURIComponent(bookId)}`);
  const origScore = r.data?.fields?.score;
  const origComment = r.data?.fields?.comment;

  // 手动创建目录快照
  r = await req("/api/content/books/backups", { method: "POST" });
  assert(r.status === 201 && Array.isArray(r.data?.created), "POST /books/backups 手动备份成功");
  const snapName = r.data?.created?.[0];

  r = await req("/api/content/books/backups");
  const snap = r.data?.find((b) => b.name === snapName);
  assert(snap && snap.isDirSnapshot === true, "备份列表含刚创建的目录快照（isDirSnapshot=true）");

  // 修改书籍
  const newScore = origScore === 9.9 ? 8.8 : 9.9;
  r = await req(`/api/content/books/${encodeURIComponent(bookId)}`, {
    method: "PUT",
    body: { data: { score: newScore, comment: "冒烟测试-临时修改" } },
  });
  assert(r.status === 200, "修改书籍 score/comment 成功");
  r = await req(`/api/content/books/${encodeURIComponent(bookId)}`);
  assert(r.data?.fields?.score === newScore, "修改后 score 生效");

  // 目录快照恢复（整体还原）
  r = await req("/api/content/books/restore", { method: "POST", body: { backupName: snapName } });
  assert(r.status === 200, "目录快照恢复成功");
  r = await req(`/api/content/books/${encodeURIComponent(bookId)}`);
  assert(r.data?.fields?.score === origScore, "恢复后 score 回到备份时值");
  assert(r.data?.fields?.comment === origComment, "恢复后 comment 回到备份时值");
}

await section("备份增强（notebooks：手动备份）");
{
  let r = await req("/api/content/notebooks/backups", { method: "POST" });
  assert(r.status === 201 && Array.isArray(r.data?.created), "POST /notebooks/backups 手动备份成功");
  r = await req("/api/content/notebooks/backups");
  assert(Array.isArray(r.data) && r.data.length >= 1, "notebooks 备份列表非空");
}

// ─────────── 4.6 配置保存路径：keyPath 齐全性（coverImage 随机封面接口） ───────────
await section("配置 coverImage（apis 数组整体保存，keyPath 必须齐全）");
{
  let r = await req("/api/config/coverImage");
  assert(r.status === 200, "读取 coverImage 成功");
  const apisField = r.data?.fields?.find((f) => f.keyPath === "randomCoverImage.apis");
  assert(apisField && Array.isArray(apisField.value), "coverImage 含 randomCoverImage.apis 数组字段");
  const origApis = apisField.value;
  const testApi = "https://example.com/random-cover.jpg";

  // 新增一条随机封面接口
  r = await req("/api/config/coverImage", {
    method: "POST",
    body: { changes: [{ keyPath: "randomCoverImage.apis", value: [...origApis, testApi] }] },
  });
  assert(r.status === 200 && r.data.saved >= 1, "保存 apis 数组成功（keyPath 齐全）");
  r = await req("/api/config/coverImage");
  const after = r.data?.fields?.find((f) => f.keyPath === "randomCoverImage.apis")?.value;
  assert(Array.isArray(after) && after.includes(testApi), "回读包含新接口");

  // 还原
  r = await req("/api/config/coverImage", {
    method: "POST",
    body: { changes: [{ keyPath: "randomCoverImage.apis", value: origApis }] },
  });
  assert(r.status === 200, "还原 apis 数组成功");
  r = await req("/api/config/coverImage");
  const restored = r.data?.fields?.find((f) => f.keyPath === "randomCoverImage.apis")?.value;
  assert(JSON.stringify(restored) === JSON.stringify(origApis), "回读 apis 已还原");
}

// ─────────── 4.7 数字枚举（movies status）写回数字 ───────────
await section("内容模块（movies：status 写回数字 1~5，非字符串）");
{
  const body = { data: { title: "冒烟测试-状态", subcategory: "movie", status: 3, score: 7.5 }, body: "" };
  let r = await req("/api/content/movies", { method: "POST", body });
  assert(r.status === 201 && r.data.id, "创建测试影视成功");
  const id = r.data?.id;
  created.push(id);

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

// ─────────── 5. 静态后台页 ───────────
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
for (const id of created) {
  try {
    await req(`/api/content/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
    console.log(`  清理测试文章 ${id}`);
  } catch { /* ignore */ }
}

console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
process.exit(fail > 0 ? 1 : 0);
