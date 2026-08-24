// 语言检测：按 Unicode 区段判断一段文字是哪种语言（闪卡发音、词群页分语言标签都用它）。
// 泰语 / 韩语 / 中文 / 日语 / 英语 五类，其余归「其他」。

export type Lang = "thai" | "korean" | "chinese" | "japanese" | "english" | "other";

export function detectLang(text: string): Lang {
  if (/[฀-๿]/.test(text)) return "thai"; // 泰文
  if (/[가-힯]/.test(text)) return "korean"; // 韩文（谚文音节）
  if (/[぀-ヿ]/.test(text)) return "japanese"; // 假名 → 日语（假名只存在于日文，最可靠，必须先于汉字判断；
  // 否则「食べる」「お寿司」这类汉字+假名混合词会先被汉字命中判成中文）
  if (/[一-鿿]/.test(text)) return "chinese"; // 汉字（无假名）→ 中文；中文与日语共用汉字，纯汉字文本只能归中文兜底
  if (/[A-Za-zÀ-ɏͰ-Ͽ]/.test(text)) return "english"; // 拉丁/希腊字母 → 英语（无上述几种文字时才到这儿）
  return "other";
}

/**
 * 判断一张闪卡的语言。正面是「要记的词」，若正面是纯汉字（中文 / 日语共用汉字，字符层无法区分）
 * 或完全无脚本（拉丁等），就看背面——日语卡的背面几乎必带假名例句（如「電車が運行する」里的 が/する），
 * 靠它就能把「運行」「電車」这类纯汉字日语词从中文里拽出来。
 * 规则：正面能确定脚本（泰 / 韩 / 含假名的日语）→ 用正面；正面是纯汉字(中文)或其它(无脚本)，
 * 且背面透露出确定脚本（假名 / 韩文 / 泰文）→ 用背面；否则保留正面判断（纯汉字仍归中文，无从再分）。
 */
export function detectCardLang(card: { front: string; back?: string | null }): Lang {
  const frontLang = detectLang(card.front);
  if (frontLang === "thai" || frontLang === "korean" || frontLang === "japanese") {
    return frontLang;
  }
  const backLang = detectLang(`${card.front} ${card.back ?? ""}`);
  if (backLang === "japanese" || backLang === "korean" || backLang === "thai") {
    return backLang;
  }
  return frontLang;
}

/**
 * 解析一张卡当前的展示语言：**已存储的 `card.lang` 优先**（用户在转卡预览/编辑态可检查修正），
 * 没存过（存量卡 / 手动加的卡）才回退到 `detectCardLang` 动态判断。
 * 所有「语言徽章 / 分组 / 筛选」统一用它，保证「改了 lang 就生效」。
 */
export function cardLang(card: { lang?: string | null; front: string; back?: string | null }): Lang {
  const l = card.lang as Lang | null | undefined;
  if (l && l in LANG_LABEL) return l;
  return detectCardLang(card);
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
    case "english":
      return "en-US";
    default:
      return "en-US";
  }
}

/**
 * 发音前清洗：只保留目标语言的文字，去掉夹杂的拉丁字母（罗马读音 / 拼音 / 假名罗马字），
 * 避免「สวัสดี sawadee」被读两遍（泰语 + 罗马拼音）。
 * 纯拉丁文字（本身就是要读的语言）原样返回。
 */
export function cleanForSpeech(text: string, lang?: Lang): string {
  const l = lang ?? detectLang(text);
  if (l === "other") return text;
  const keep =
    l === "thai"
      ? /[฀-๿]/
      : l === "korean"
        ? /[가-힯]/
        : l === "chinese"
          ? /[一-鿿]/
          : l === "japanese"
            ? /[぀-ヿ一-鿿]/ // 日语：假名 + 汉字
            : /[A-Za-zÀ-ɏͰ-Ͽ]/; // 英语：拉丁/希腊字母
  return [...text]
    .filter((ch) => keep.test(ch) || /\s/.test(ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** 语言下拉 / 分组的固定显示顺序。 */
export const LANG_ORDER: Lang[] = ["thai", "korean", "chinese", "japanese", "english", "other"];

export const LANG_LABEL: Record<Lang, string> = {
  thai: "泰语",
  korean: "韩语",
  chinese: "中文",
  japanese: "日语",
  english: "英语",
  other: "其他",
};

/** 词群页 / 标签用的语言颜色（淡色系）。 */
export const LANG_COLOR: Record<Lang, string> = {
  thai: "bg-emerald-50 text-emerald-700",
  korean: "bg-sky-50 text-sky-700",
  chinese: "bg-amber-50 text-amber-700",
  japanese: "bg-violet-50 text-violet-700",
  english: "bg-blue-50 text-blue-700",
  other: "bg-zinc-100 text-zinc-600",
};
