/**
 * bills 账单模块（迁移自参考模板，适配本博客账单 schema）
 * 路径：src/content/bills/*.md；无正文；amount 数字、type 收支枚举、time 时间（双引号）
 */
import type { ContentModuleDef } from "../../../types/content.js";

/** 账单 frontmatter 数据结构 */
export interface BillData {
  title: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  account: string;
  date: string;
  time: string;
  description: string;
  tags: string[];
}

export const billsModule: ContentModuleDef = {
  id: "bills",
  name: "账单",
  dir: "bills",
  urlPrefix: "/bills/",
  isSingleFile: false,
  hasBody: false,
  titleField: "title",
  sortOrder: "desc",
  // 先按日期、再按时间排序；便于后台按发生时间展示
  sortKeys: ["date", "time"],
  fields: [
    { key: "title", label: "账单名称", type: "string", required: true },
    { key: "amount", label: "金额", type: "number", required: true, help: "正数金额，例如 399" },
    {
      key: "type",
      label: "收支类型",
      type: "string",
      required: true,
      defaultValue: "expense",
      enum: [
        { value: "income", label: "收入" },
        { value: "expense", label: "支出" },
      ],
    },
    { key: "category", label: "分类", type: "string", defaultValue: "其他", help: "例如 餐饮、娱乐、工资" },
    { key: "account", label: "账户", type: "string", defaultValue: "其他", help: "例如 支付宝、微信、银行卡" },
    { key: "date", label: "账单日期", type: "date", required: true },
    { key: "time", label: "账单时间", type: "time", help: "格式 HH:mm，例如 09:00" },
    { key: "description", label: "备注", type: "string", defaultValue: "" },
    { key: "tags", label: "标签", type: "stringArray", defaultValue: [] },
  ],
  // 与现有账单文件（expense-*.md、salary-*.md）一致：
  // 字符串无引号、日期/数字无引号、tags 每项独立一行、time 双引号
  yamlFormat: {
    quote: "none",
    arrayStyle: "block",
    arrayItemQuote: "none",
    overrides: {
      time: { quote: "double" },
      tags: { arrayStyle: "block", quote: "none" },
    },
  },
};