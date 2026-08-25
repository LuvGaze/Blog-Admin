/**
 * 书架/影视/游戏 列表排序：
 * 状态顺序 在读(3) > 读过(2) > 想读(1) > 搁置(4) > 抛弃(5)，同状态按评分降序，
 * 影视在同评分下按子分类 电影 > 电视剧 > 动漫 > 纪录片。
 */
import type { ContentListItem } from "../../types/content.js";

const STATUS_ORDER: Record<number, number> = { 3: 0, 2: 1, 1: 2, 4: 3, 5: 4 };

/** 生成模块级 sortItems 钩子；subcategoryOrder 可选（仅影视需要子分类次序） */
export function statusScoreSort(subcategoryOrder?: Record<string, number>): (items: ContentListItem[]) => ContentListItem[] {
  return (items) =>
    [...items].sort((a, b) => {
      const sa = STATUS_ORDER[Number(a.fields.status)] ?? 99;
      const sb = STATUS_ORDER[Number(b.fields.status)] ?? 99;
      if (sa !== sb) return sa - sb;
      const scoreA = Number(a.fields.score) || 0;
      const scoreB = Number(b.fields.score) || 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      if (subcategoryOrder) {
        const ca = subcategoryOrder[String(a.fields.subcategory)] ?? 99;
        const cb = subcategoryOrder[String(b.fields.subcategory)] ?? 99;
        if (ca !== cb) return ca - cb;
      }
      return String(a.title).localeCompare(String(b.title), "zh-CN");
    });
}
