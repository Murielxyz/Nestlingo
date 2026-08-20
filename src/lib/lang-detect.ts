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

/**
 * 发音前清洗：只保留目标语言的文字，去掉夹杂的拉丁字母（罗马读音 / 拼音 / 假名罗马字），
 * 避免「สวัสดี sawadee」被读两遍（泰语 + 罗马拼音）。
 * 纯拉丁文字（本身就是要读的语言）原样返回。
 */
export function cleanForSpeech(text: string): string {
  const lang = detectLang(text);
  if (lang === "other") return text;
  const keep =
    lang === "thai"
      ? /[฀-๿]/
      : lang === "korean"
        ? /[가-힯]/
        : lang === "chinese"
          ? /[一-鿿]/
          : /[぀-ヿ一-鿿]/; // 日语：假名 + 汉字
  return [...text]
    .filter((ch) => keep.test(ch) || /\s/.test(ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
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
