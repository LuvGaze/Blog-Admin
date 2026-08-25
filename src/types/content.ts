/**
 * 内容模块元数据与字段定义类型
 * 字段定义同时充当「模块 TS interface」的服务端形态：UI 表单据此动态渲染
 */
export type FieldType =
  | "string"
  | "number"
  | "positiveInt"
  | "boolean"
  | "date"
  | "time"
  | "url"
  | "stringArray"
  | "urlArray"
  | "numberEnum";

export interface EnumOption {
  value: string | number;
  label: string;
}

export interface FieldDef {
  /** frontmatter key */
  key: string;
  /** 中文标签 */
  label: string;
  type: FieldType;
  required?: boolean;
  /** 表单隐藏（固定值字段如 category） */
  hidden?: boolean;
  /** 固定值：禁止修改，写回时强制使用该值 */
  fixed?: string | number | boolean;
  /** 下拉枚举 */
  enum?: EnumOption[];
  /** 图片媒体预览 */
  media?: boolean;
  /** 新建时的默认值 */
  defaultValue?: unknown;
  /** 表单帮助文本 */
  help?: string;
}

/** frontmatter 标量引号风格 */
export type QuoteStyle = "none" | "double" | "single";

/** 字段级格式覆盖（overrides[key]） */
export interface YamlFieldFormat {
  /** 标量引号风格；数组字段时表示元素引号 */
  quote?: QuoteStyle;
  /** 数组写法：flow `[a, b]`（带中括号） / block `  - a`（缩进列表） */
  arrayStyle?: "flow" | "block";
}

/**
 * 模块 frontmatter 写回格式规范（yamlService 生成数组/字符串时优先遵循）
 * 按各 content 集合现有 md 文件的实际写法配置，保证后端写出与仓库风格一致
 */
export interface YamlFormat {
  /** 字符串字段默认引号 */
  quote: QuoteStyle;
  /** 数组字段默认写法 */
  arrayStyle: "flow" | "block";
  /** 数组元素默认引号 */
  arrayItemQuote: QuoteStyle;
  /** 字段级覆盖（如 URL 字段单独双引号、某日期字段单独无引号） */
  overrides?: Record<string, YamlFieldFormat>;
}

/** 内容模块元数据 */
export interface ContentModuleDef {
  /** 模块标识：books / games / ... */
  id: string;
  /** 中文名 */
  name: string;
  /** 模块源目录（相对 src/content） */
  dir: string;
  /** 是否单文件模块（仅 update/restore） */
  isSingleFile: boolean;
  /** 是否有正文编辑器 */
  hasBody: boolean;
  /** 无 frontmatter（about：整文件即正文） */
  noFrontmatter?: boolean;
  /** 列表展示字段（标题） */
  titleField: string;
  /** 博客访问路径前缀：目录型以 / 结尾（拼接条目 slug），单页型为聚合页路径 */
  urlPrefix: string;
  /** 文件扩展名（默认 .md） */
  ext?: string;
  /** 列表排序方向：缺省保持文件系统顺序；asc 按 sortKeys 升序，desc 降序 */
  sortOrder?: "asc" | "desc";
  /** 列表排序字段（frontmatter key，依次作为主/次排序键），缺省按文件名 */
  sortKeys?: string[];
  /**
   * 自定义列表排序钩子（优先于 sortOrder/sortKeys）。
   * 用于状态顺序（在读>读过>想读>搁置>抛弃）等无法用简单字段排序表达的规则。
   */
  sortItems?: (items: ContentListItem[]) => ContentListItem[];
  fields: FieldDef[];
  /**
   * 写回前归一化钩子：修改 values 与删除字段清单
   * @param values 表单提交的字段值（含 fixed 字段强制值）
   * @param isNew 是否新建
   * @returns 变更操作（remove 字段列表 + 覆盖值）
   */
  normalize?: (values: Record<string, unknown>, isNew: boolean) => { remove: string[] };
  /** 新建时生成文件名（默认使用 titleField 值净化） */
  fileName?: (values: Record<string, unknown>) => string;
  /** frontmatter 写回格式规范：不配置时沿用现有「保留原格式」行为 */
  yamlFormat?: YamlFormat;
}

/** 内容条目摘要（列表用） */
export interface ContentListItem {
  id: string;
  filename: string;
  title: string;
  /** 解析出的全部字段值 */
  fields: Record<string, unknown>;
  /** 文件解析异常时非空（非法文件标记，不加载表单） */
  error?: string;
}

/** 内容条目详情（表单回填） */
export interface ContentDetail {
  id: string;
  filename: string;
  fields: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
  /** 未知字段（嵌套对象等，只读展示） */
  unknownKeys: string[];
  error?: string;
}
