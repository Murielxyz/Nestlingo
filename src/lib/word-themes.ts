// 词群页的「主题分类」：按单词本身的相关性（而不是来源笔记）把生词归成几大类。
// 用关键词匹配（主要匹配背面中文释义，也带少量泰语关键词），离线、即时、无需 AI。
// 匹配到多个主题时取第一个（顺序即优先级，更具体的主题放前面）。
// 用户自定义分类（word_themes）排在内置主题之后，命中其关键词即归到该分类。

import type { LucideIcon } from "lucide-react";
import {
  Sparkles,
  Gamepad2,
  Dumbbell,
  Utensils,
  Plane,
  ShoppingBag,
  Home,
  Briefcase,
  HeartPulse,
  Heart,
  Clock,
  CloudSun,
  Hash,
  Package,
} from "lucide-react";
import type { WordTheme } from "@/lib/types";

export type Theme = {
  key: string;
  label: string;
  icon: LucideIcon;
  keywords: string[];
};

export const THEMES: Theme[] = [
  { key: "beauty", label: "美容", icon: Sparkles, keywords: ["化妆", "口红", "护肤", "面膜", "洗面", "发型", "美甲", "香水", "粉底", "睫毛", "眼影", "卸妆", "美容", "爽肤", "精华", "染发", "口红"] },
  { key: "game", label: "游戏", icon: Gamepad2, keywords: ["游戏", "关卡", "角色", "装备", "英雄", "电竞", "打怪", "升级", "副本", "玩家", "手柄", "电竞", "皮肤"] },
  { key: "sport", label: "运动", icon: Dumbbell, keywords: ["运动", "跑步", "游泳", "足球", "篮球", "健身", "瑜伽", "比赛", "锻炼", "网球", "羽毛球", "排球", "马拉松", "健身房"] },
  { key: "food", label: "美食", icon: Utensils, keywords: ["吃", "喝", "饭", "菜", "水果", "咖啡", "茶", "甜点", "米饭", "面", "汤", "早餐", "午餐", "晚餐", "好吃", "辣", "甜", "酸", "苦", "咸", "食材", "烹饪"] },
  { key: "travel", label: "旅行", icon: Plane, keywords: ["旅行", "机票", "酒店", "机场", "签证", "景点", "旅游", "地铁", "火车", "车站", "行李", "航班", "护照", "地图"] },
  { key: "shopping", label: "购物", icon: ShoppingBag, keywords: ["买", "卖", "钱", "价格", "贵", "便宜", "商店", "商场", "付钱", "打折", "购物", "收银", "退货"] },
  { key: "family", label: "家庭", icon: Home, keywords: ["爸爸", "妈妈", "家人", "孩子", "儿子", "女儿", "哥哥", "姐姐", "弟弟", "妹妹", "奶奶", "爷爷", "家", "亲戚", "妻子", "丈夫"] },
  { key: "work", label: "工作学习", icon: Briefcase, keywords: ["工作", "会议", "老板", "同事", "邮件", "上班", "学校", "老师", "学生", "作业", "考试", "学习", "毕业", "简历", "面试"] },
  { key: "health", label: "身体", icon: HeartPulse, keywords: ["身体", "头", "手", "脚", "生病", "医院", "医生", "药", "疼", "累", "感冒", "发烧", "健康", "心脏", "眼睛", "牙"] },
  { key: "feeling", label: "情感", icon: Heart, keywords: ["爱", "喜欢", "开心", "难过", "生气", "幸福", "想念", "讨厌", "害怕", "兴奋", "孤独", "感动"] },
  { key: "time", label: "时间", icon: Clock, keywords: ["时间", "星期", "今天", "明天", "昨天", "月", "年", "小时", "分钟", "早上", "晚上", "中午", "现在", "未来", "过去", "周末"] },
  { key: "weather", label: "天气", icon: CloudSun, keywords: ["天气", "下雨", "晴天", "冷", "热", "风", "雪", "温度", "阴天", "台风", "彩虹"] },
  { key: "number", label: "数字", icon: Hash, keywords: ["数字", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "百", "千", "万", "数", "第"] },
];

export function themeMeta(key: string): Theme | null {
  return THEMES.find((t) => t.key === key) ?? null;
}

export const OTHER_THEME: Theme = { key: "other", label: "其他", icon: Package, keywords: [] };

/** 判断一个生词属于哪个主题（把正面+背面拼起来做关键词匹配）。内置主题优先，再查用户分类。 */
export function classifyWord(
  front: string,
  back: string,
  userThemes: WordTheme[] = []
): string {
  const text = `${front} ${back}`.toLowerCase();
  for (const t of THEMES) {
    if (t.keywords.some((k) => text.includes(k))) return t.key;
  }
  for (const t of userThemes) {
    if ((t.keywords ?? []).some((k) => k && text.includes(k.toLowerCase()))) return t.id;
  }
  return "other";
}

/** 生词的最终主题：AI 语义归类优先，没有 AI 归类（或归到「其他」）时退回关键词匹配兜底。 */
export function themeOf(
  card: { front: string; back: string | null; theme?: string | null },
  userThemes: WordTheme[] = []
): string {
  const ai = card.theme?.trim() || "";
  if (ai && ai !== "other") return ai;
  return classifyWord(card.front, card.back ?? "", userThemes);
}

/** 给一个主题 key 取显示名：内置主题用自带 label，用户分类用分类名。 */
export function themeLabelOf(key: string, userThemes: WordTheme[] = []): string {
  const builtin = themeMeta(key);
  if (builtin) return builtin.label;
  const custom = userThemes.find((t) => t.id === key);
  return custom?.name ?? "主题";
}
