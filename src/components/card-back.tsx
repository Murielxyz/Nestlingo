"use client";

// 统一样式的「闪卡背面」渲染器。
// 规则：只把「已知标签：内容」这类行渲染成左轴排版（标签在左、内容在右、细分隔线），
// 其余行一律原样纯文本。这样 AI 解释 / AI 补全生成的结构化背面能统一好看，
// 而用户手写的自由内容（比如只有一句话的释义）不会被强行拆开。
// 三个展示位（卡片翻面 / 详情页翻面 / 复习翻面）都渲染它，保证到处一致。
// 居中只发生在「背诵」且由调用方传 center=true 时：
//  - 顶部居中显示「正面词 + 含义（释义/译文）」；
//  - 下方靠左显示其余带标签的内容（读音/例句/拓展/接续…）；
//  - 自建（全无标签）卡 = 正面词 + 整段自由释义居中、无下方标签。
// 详情页 / 翻面卡不传 center，走左轴模板、不重复正面、不居中。

import { CardFront } from "./card-front";

/**
 * 认识的行标签（归一化后比对）。
 * 生词：读音/释义/例句/拓展；例句：译文/解析/生词/用法；语法：说明/接续/例句/用法。
 * 这是「哪些行算结构化」的唯一依据——不在表里的标签一律不当结构化处理。
 */
const KNOWN_LABELS = new Set([
  "读音", "发音", "音标", "拼音", "罗马音",
  "释义", "意思", "含义", "解释", "词性",
  "搭配", "常用搭配", "词组", "相关", "相关词", "拓展",
  "例句", "例", "译文", "翻译", "解析", "长难句", "生词", "词义",
  "用法", "注意", "说明", "接续", "接续规则", "规则",
]);

/** 哪些标签算「含义」（背诵时提到顶部居中显示，和正面词放在一起）。 */
const MEANING_LABELS = new Set([
  "释义", "意思", "含义", "解释", "词义", "译文", "翻译",
]);

/** 显示名归一化：相关词→相关；词组/常用搭配→搭配（统一成一个「搭配」标签）。 */
const LABEL_ALIAS: Record<string, string> = {
  相关词: "相关",
  词组: "搭配",
  常用搭配: "搭配",
};

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

/** 把块切成「含义」和「其他标签」两部分（背诵居中用）：
 *  - label 命中 MEANING_LABELS → 含义；
 *  - 其它带标签 → 其他；
 *  - 无标签且出现在第一个带标签块之前（语伴释义是无标签首行）→ 含义，否则 → 其他。
 *  纯自由文本（全无标签）→ 整段进含义、其他为空。 */
function splitMeaning(blocks: Block[]): { meaning: string[]; details: Block[] } {
  const meaning: string[] = [];
  const details: Block[] = [];
  let seenLabel = false;
  for (const b of blocks) {
    if (b.label) {
      seenLabel = true;
      if (MEANING_LABELS.has(b.label)) meaning.push(b.text);
      else details.push(b);
    } else if (!seenLabel) {
      meaning.push(b.text);
    } else {
      details.push(b);
    }
  }
  return { meaning, details };
}

/** 一条带标签的行：左轴 chip + 内容（标签经别名归一化）。 */
function LabeledRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="inline-flex shrink-0 items-center rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-700">
        {LABEL_ALIAS[label] ?? label}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{text}</span>
    </div>
  );
}

export function CardBack({
  back,
  front,
  reading,
  center = false,
}: {
  back: string;
  front?: string;
  reading?: string | null;
  center?: boolean;
}) {
  const blocks = parseBack(back);

  // —— 背诵（center）：正面词 + 含义居中，其余带标签内容靠左 ——
  if (center) {
    const { meaning, details } = splitMeaning(blocks);
    return (
      <div className="w-full">
        <div className="text-center">
          {front ? (
            <div className="text-2xl font-semibold leading-relaxed">
              <CardFront text={front} reading={reading} />
            </div>
          ) : null}
          {meaning.length > 0 && (
            <p
              className={`whitespace-pre-wrap text-lg font-medium text-zinc-700 ${
                front ? "mt-2" : ""
              }`}
            >
              {meaning.join("\n")}
            </p>
          )}
        </div>
        {details.length > 0 && (
          <div className="mt-4 w-full space-y-2 border-t border-zinc-100 pt-3 text-left">
            {details.map((b, i) =>
              b.label ? (
                <LabeledRow key={i} label={b.label} text={b.text} />
              ) : (
                <p key={i} className="whitespace-pre-wrap">
                  {b.text}
                </p>
              )
            )}
          </div>
        )}
      </div>
    );
  }

  // —— 详情页 / 翻面卡 / 错题集：左轴模板，不居中、不重复正面 ——
  const hasStructured = blocks.some((b) => b.label);
  if (!hasStructured) {
    return <p className="whitespace-pre-wrap text-left">{back || "（空）"}</p>;
  }

  return (
    <div className="space-y-2 text-left">
      {blocks.map((b, i) =>
        b.label ? (
          <LabeledRow key={i} label={b.label} text={b.text} />
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {b.text}
          </p>
        )
      )}
    </div>
  );
}

/** 取背面「含义」部分（释义/译文/翻译行）拼成字符串；无结构化标签时回退整段原文。
 *  供选择题选项使用，避免把「例句 / 拓展 / 用法」等非释义内容塞进选项、泄露答案。
 *  关键：有标签但抽不出任何释义（背面只有例句/拓展等）→ 返回空串，让这张卡不参与出题，
 *  而不是把整段背面（含例句/拓展）当成答案混进选项。 */
export function backMeaning(back: string): string {
  const blocks = parseBack(back);
  const hasLabel = blocks.some((b) => b.label);
  const { meaning } = splitMeaning(blocks);
  const text = meaning.join("\n").trim();
  return text || (hasLabel ? "" : back.trim());
}

/** 非结构化（纯文本）背面也能复用；供外部判断是否需要额外容器。 */
export function isStructuredBack(back: string): boolean {
  return (back ?? "")
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
