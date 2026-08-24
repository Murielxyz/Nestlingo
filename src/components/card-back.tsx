"use client";

// 统一样式的「闪卡背面」渲染器。
// 规则：只把「已知标签：内容」这类行渲染成左轴排版（标签在左、内容在右、细分隔线），
// 其余行一律原样纯文本。这样 AI 解释 / AI 补全生成的结构化背面能统一好看，
// 而用户手写的自由内容（比如只有一句话的释义）不会被强行拆开。
// 三个展示位（卡片翻面 / 详情页翻面 / 复习翻面）都渲染它，保证到处一致。

/**
 * 认识的行标签（归一化后比对）。
 * 生词：读音/释义/搭配/例句/相关词；例句：译文/解析/生词/用法；语法：说明/接续/例句/用法。
 * 这是「哪些行算结构化」的唯一依据——不在表里的标签一律不当结构化处理。
 */
const KNOWN_LABELS = new Set([
  "读音", "发音", "音标", "拼音", "罗马音",
  "释义", "意思", "含义", "解释", "词性",
  "搭配", "常用搭配", "相关词",
  "例句", "例", "译文", "翻译", "解析", "长难句", "生词", "词义",
  "用法", "注意", "说明", "说明", "接续", "接续规则", "规则",
]);

type Block = { label: string | null; text: string };

/** 把背面文本切成块：已知标签的行标出 label，其余 label=null。 */
function parseBack(back: string): Block[] {
  return back
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      // 【读音】… 这种方括号标签（规则识别常用）
      const bracket = line.match(/^【([^】]+)】\s*(.*)$/);
      if (bracket && KNOWN_LABELS.has(bracket[1].trim())) {
        return { label: bracket[1].trim(), text: bracket[2].trim() };
      }
      // 「读音：…」这种冒号标签
      const colon = line.match(/^([^：:]{1,12})[：:]\s*(.*)$/);
      if (colon && KNOWN_LABELS.has(colon[1].trim())) {
        return { label: colon[1].trim(), text: colon[2].trim() };
      }
      return { label: null, text: line };
    });
}

export function CardBack({ back }: { back: string }) {
  const blocks = parseBack(back);
  const hasStructured = blocks.some((b) => b.label);

  // 整张背面没有任何结构化行 → 原样纯文本，绝不动用户手写内容。
  if (!hasStructured) {
    return <p className="whitespace-pre-wrap">{back || "（空）"}</p>;
  }

  return (
    <div className="space-y-2 text-left">
      {blocks.map((b, i) =>
        b.label ? (
          <div key={i} className="flex items-baseline gap-2">
            <span className="inline-flex shrink-0 items-center rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-700">
              {b.label}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{b.text}</span>
          </div>
        ) : (
          <p key={i} className="whitespace-pre-wrap">{b.text}</p>
        )
      )}
    </div>
  );
}

/** 非结构化（纯文本）背面也能复用；供外部判断是否需要额外容器。 */
export function isStructuredBack(back: string): boolean {
  const text = back ?? "";
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .some((line) => {
      const bracket = line.match(/^【([^】]+)】\s*(.*)$/);
      if (bracket && KNOWN_LABELS.has(bracket[1].trim())) return true;
      const colon = line.match(/^([^：:]{1,12})[：:]\s*(.*)$/);
      return !!(colon && KNOWN_LABELS.has(colon[1].trim()));
    });
}
