// 语言检测：按 Unicode 区段判断一段文字是哪种语言（闪卡发音、词群页分语言标签都用它）。
// 泰语 / 韩语 / 中文 / 日语 四类，其余归「其他」。

export type Lang = "thai" | "korean" | "chinese" | "japanese" | "other";

export function detectLang(text: string): Lang {
  if (/[฀-๿]/.test(text)) return "thai"; // 泰文
  if (/[가-힯]/.test(text)) return "korean"; // 韩文（谚文音节）
  if (/[一-鿿]/.test(text)) return "chinese"; // 汉字
  if (/[぀-ヿ]/.test(text)) return "japanese"; // 假名
  return "other";
}

/** 浏览器 speechSynthesis 用的 BCP-47 语言码。 */
export function speechLang(lang: Lang): string {
  switch (lang) {
    case "thai":
      return "th-TH";
    case "korean":
      return "ko-KR";
    case "chinese":
      return "zh-CN";
    case "japanese":
      return "ja-JP";
    default:
      return "en-US";
  }
}

export const LANG_LABEL: Record<Lang, string> = {
  thai: "泰语",
  korean: "韩语",
  chinese: "中文",
  japanese: "日语",
  other: "其他",
};

/** 词群页 / 标签用的语言颜色（淡色系）。 */
export const LANG_COLOR: Record<Lang, string> = {
  thai: "bg-emerald-50 text-emerald-700",
  korean: "bg-sky-50 text-sky-700",
  chinese: "bg-amber-50 text-amber-700",
  japanese: "bg-rose-50 text-rose-700",
  other: "bg-zinc-100 text-zinc-600",
};
