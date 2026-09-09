// 规则解析：把一段文本（粘贴自 Excel/Sheets 的表格、词表、或「词 — 释义」清单）
// 拆成结构化卡片。免费、离线、即时，作为 AI 识别的兜底。

import { HR_TEXT } from "@/lib/doc-to-text";
import type { RecognitionRules, SplitRule } from "@/lib/types";

export interface ParsedCard {
  front: string;
  back: string;
  /** 由自定义分隔规则命中的卡片类型（生词/例句/语法）；普通卡片没有。 */
  kind?: "word" | "example" | "grammar";
}

type Role = "front" | "back" | "hint" | "extra";

/** 把表头模糊匹配到 正面/背面/读音/拓展 四种角色（读音是内置识别，不再开放自定义）。 */
function classifyHeader(raw: string, rules?: RecognitionRules | null): Role | null {
  const s = raw.trim().toLowerCase();
  if (/读音|发音|音标|拼音|罗马|音读|训读|romaniz|pronunc|reading/.test(s)) return "hint";
  if (/拓展|扩展|延伸|补充|拓展内容|extra|extension/.test(s)) return "extra";
  if (/释义|意思|含义|中文|翻译|译文|解释|定义|备注|注释|meaning|definition|translation/.test(s)) return "back";
  if (/词汇|单词|生词|生字|词|word|term|泰语|韩语|日语|英语|原文|front|表达|短语|句子|例句/.test(s)) return "front";
  // 用户自定义关键词（兜底，处理内置正则没覆盖到的表头）
  if (rules) {
    if ((rules.extra ?? []).some((k) => k && s.includes(k.toLowerCase()))) return "extra";
    if ((rules.back ?? []).some((k) => k && s.includes(k.toLowerCase()))) return "back";
    if ((rules.front ?? []).some((k) => k && s.includes(k.toLowerCase()))) return "front";
  }
  return null;
}

function splitRow(line: string, delim: string): string[] {
  return line.split(delim).map((c) => c.trim());
}

function parseTable(lines: string[], delim: string, rules?: RecognitionRules | null): ParsedCard[] {
  const rows = lines.map((l) => splitRow(l, delim));
  if (rows.length === 0) return [];

  const header = rows[0];
  const roles = header.map((h) => classifyHeader(h, rules));
  const hasHeader = roles.some((r) => r !== null);

  let frontIdx: number;
  let backIdx: number;
  let hintIdx: number;
  let extraIdxs: number[];

  if (hasHeader) {
    frontIdx = roles.indexOf("front");
    backIdx = roles.indexOf("back");
    hintIdx = roles.indexOf("hint");
    extraIdxs = roles
      .map((r, i) => (r === "extra" ? i : -1))
      .filter((i) => i !== -1);

    if (frontIdx === -1) frontIdx = 0;
    if (backIdx === -1) {
      // 没找到「释义」列：取第一个既不是正面、也不是读音/拓展的列当背面
      backIdx = roles.findIndex(
        (r, i) => i !== frontIdx && r !== "hint" && r !== "extra"
      );
      if (backIdx === -1) backIdx = 0;
    }
    if (backIdx === frontIdx) backIdx = (frontIdx + 1) % header.length;
  } else {
    // 无表头：第一列当正面，其余列合并当背面
    frontIdx = 0;
    backIdx = -1;
    hintIdx = -1;
    extraIdxs = [];
  }

  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((cols) => {
      let front = (cols[frontIdx] ?? "").trim();
      let back: string;
      if (backIdx === -1) {
        back = cols
          .filter((_, i) => i !== frontIdx)
          .filter(Boolean)
          .join(" ");
      } else {
        back = (cols[backIdx] ?? "").trim();
      }
      // 读音列（hint）放背面顶部，格式与 AI 解释一致「读音：xxx」。
      // 当没有「释义」列时（backIdx===-1），读音列已随其它列并入 back，无需另处理。
      const hint = hintIdx >= 0 ? cols[hintIdx]?.trim() : "";
      if (hint && backIdx !== -1) {
        back = back ? `读音：${hint}\n${back}` : `读音：${hint}`;
      }
      // 拓展列（例句/补充等）每项另起一行接在背面后面
      const extras = extraIdxs
        .map((i) => cols[i]?.trim())
        .filter(Boolean);
      for (const e of extras) back = back ? `${back}\n${e}` : e;
      return { front, back: back.trim() };
    })
    .filter((c) => c.front || c.back);
}

/** 反面正文的「分句/换行」规则：按分号分句、按两个及以上空格换行（都可开关）。 */
function normalizeBack(back: string, rules?: RecognitionRules | null): string {
  let parts = [back];
  if (rules?.splitBySemicolon) {
    parts = parts.flatMap((p) => p.split(/[;；]/));
  }
  if (rules?.wrapBackSpaces ?? true) {
    parts = parts.flatMap((p) => p.split(/\s{2,}/));
  }
  return parts.map((p) => p.trim()).filter(Boolean).join("\n");
}

/** 组装一张卡：正面反面完全按输入原样保留（所见即所得），不再自动抽取/搬移读音。 */
function makeCard(front: string, back: string): ParsedCard {
  return { front: front.trim(), back: back.trim() };
}

/** 一条自定义分隔规则是否在当前解析范围内生效。 */
function ruleApplies(rule: SplitRule, scope: "everywhere" | "callout" | "plain"): boolean {
  if (rule.appliesTo === "all") return true;
  // appliesTo === "callout"：只在彩色区块内（或「添加闪卡」这种不分区的粘贴）生效。
  return scope === "everywhere" || scope === "callout";
}

/** 用一条自定义分隔规则把一行拆成 [正面, 背面]，拆不出返回 null。 */
function splitByRule(line: string, rule: SplitRule): [string, string] | null {
  let sep: RegExp;
  switch (rule.mode) {
    case "double-space":
      sep = /\s{2,}/;
      break;
    case "tab":
      sep = /\t/;
      break;
    case "colon":
      sep = /[:：]\s*/;
      break;
    case "custom":
      if (!rule.customPattern) return null;
      try {
        sep = new RegExp(rule.customPattern);
      } catch {
        return null;
      }
      break;
    default:
      return null;
  }
  const parts = line.split(sep);
  if (parts.length < 2) return null;
  const front = parts[0].trim();
  const rest = parts.slice(1).join(" ").trim();
  if (!front || !rest) return null;
  return [front, rest];
}

function splitLine(
  line: string,
  rules?: RecognitionRules | null,
  scope: "everywhere" | "callout" | "plain" = "everywhere"
): ParsedCard | null {
  // 自定义行内分隔符优先（如 "==" → 「词==释义」）
  const sep = rules?.separator?.trim();
  if (sep) {
    const i = line.indexOf(sep);
    if (i > 0 && i + sep.length < line.length) {
      return makeCard(line.slice(0, i), line.slice(i + sep.length));
    }
  }
  // 自定义分隔规则（「新增规则」）：命中即按指定方式拆正反面，可带卡片类型。
  for (const rule of rules?.customRules ?? []) {
    if (!ruleApplies(rule, scope)) continue;
    const hit = splitByRule(line, rule);
    if (hit) {
      const card = makeCard(hit[0], hit[1]);
      if (rule.kind && rule.kind !== "general") card.kind = rule.kind;
      return card;
    }
  }
  if (line.includes("\t")) {
    const [f, ...rest] = line.split("\t");
    return makeCard(f, rest.join(" "));
  }
  // 「词：释义」「词 - 释义」「词  释义」等：按**行内首次出现**的分隔符切正反面。
  // 谁先出现谁就是主分隔符——「词  释义  搭配：xxx」里背面「搭配：」的冒号更靠后，
  // 不会抢先把「搭配」吸进正面；正面只留词、背面留「释义 + 搭配」标签（背诵时标签照常展示）。
  const seps: { at: number; front: string; back: string }[] = [];
  const colon = line.match(/^(.+?)\s*[:：]\s*(.+)$/); // 「词：释义」/「词: 释义」
  if (colon) seps.push({ at: colon[1].length, front: colon[1], back: colon[2] });
  const dash = line.match(/^(.+?)\s+[-—–]\s+(.+)$/); // 「词 - 释义」（连字符前后带空格，避免误拆英文连字符词）
  if (dash) seps.push({ at: dash[1].length, front: dash[1], back: dash[2] });
  const emdash = line.match(/^(.+?)\s*[—–]\s*(.+)$/); // 「词—释义」（破折号无空格）
  if (emdash) seps.push({ at: emdash[1].length, front: emdash[1], back: emdash[2] });
  const spaces = line.match(/^(.+?)\s{2,}(.+)$/); // 「词  释义」（两个及以上空格）
  if (spaces) seps.push({ at: spaces[1].length, front: spaces[1], back: spaces[2] });
  if (seps.length > 0) {
    const best = seps.reduce((a, b) => (b.at < a.at ? b : a));
    return makeCard(best.front, best.back);
  }
  return null;
}

function parseLines(
  lines: string[],
  rules?: RecognitionRules | null,
  bareToCard = true,
  scope: "everywhere" | "callout" | "plain" = "everywhere"
): ParsedCard[] {
  return lines
    .map((line) => splitLine(line, rules, scope) ?? (bareToCard ? makeCard(line, "") : null))
    .filter((c): c is ParsedCard => c !== null && Boolean(c.front));
}

export interface ParseOptions {
  /**
   * 没有任何分隔符的「裸行」是否也算一张卡。
   * 默认 true（「添加闪卡」粘贴纯词表时每行一张）；正文/整篇文章要传 false，跳过普通段落。
   */
  bareToCard?: boolean;
  /**
   * 解析上下文，决定「仅彩色区块」型自定义规则是否生效：
   * everywhere（默认，不分区的粘贴）/ callout（彩色区块内）/ plain（正文）。
   */
  scope?: "everywhere" | "callout" | "plain";
}

/** 入口：文本 → 卡片数组。rules 为用户自定义识别规则（可选）。 */
export function parseCards(
  text: string,
  rules?: RecognitionRules | null,
  opts?: ParseOptions
): ParsedCard[] {
  const bareToCard = opts?.bareToCard ?? true;
  const scope = opts?.scope ?? "everywhere";
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== HR_TEXT) // 分割线不是卡片内容，整篇模式也跳过
    .filter((l) => !l.startsWith("[媒体]")); // 内嵌媒体的占位行（「[媒体] https://…」）不是卡片
  if (rawLines.length === 0) return [];

  let cards: ParsedCard[];

  // 表格：某行有制表符（从 Excel/Sheets 粘贴最常见）。
  // 把连续含 \t 的行当作一个表格块，其它非空行按「词—释义」行处理，
  // 避免把表格上方的说明文字（如「生词」小标题）误当成表格第一行。
  if (rawLines.some((l) => l.includes("\t"))) {
    const results: ParsedCard[] = [];
    let tableBlock: string[] = [];
    const flush = () => {
      if (tableBlock.length > 0) {
        results.push(...parseTable(tableBlock, "\t", rules));
        tableBlock = [];
      }
    };
    for (const line of rawLines) {
      if (line.includes("\t")) {
        tableBlock.push(line);
      } else {
        flush();
        if (line) results.push(...parseLines([line], rules, bareToCard, scope));
      }
    }
    flush();
    cards = results;
  } else {
    const lines = rawLines.filter(Boolean);

    // 逗号表格：把「连续含逗号（≥2 列）的行」当作候选表格块，块首行能被识别成表头角色才当表格解析；
    // 其它行（表格上方的说明文字、普通正文）逐行按「词—释义」处理。
    // 不再要求整块每行列数一致——列数不齐的行 parseTable 用空串兜底，避免一条标题行 / 含逗号单元格就整张拒掉。
    const results: ParsedCard[] = [];
    let tableBlock: string[] = [];
    const flushBlock = () => {
      if (tableBlock.length > 0) {
        const firstCols = tableBlock[0].split(",");
        const headerRoles = firstCols.map((h) => classifyHeader(h, rules));
        if (firstCols.length >= 2 && headerRoles.some((r) => r !== null)) {
          results.push(...parseTable(tableBlock, ",", rules));
        } else {
          results.push(...parseLines(tableBlock, rules, bareToCard, scope));
        }
        tableBlock = [];
      }
    };
    for (const line of lines) {
      if (line.split(",").length >= 2) {
        tableBlock.push(line);
      } else {
        flushBlock();
        if (line) results.push(...parseLines([line], rules, bareToCard, scope));
      }
    }
    flushBlock();
    cards = results;
  }

  // 反面做分句/换行（所见即所得：正面不再抽走/挪动读音）。
  return cards.map((c) => ({ ...c, back: normalizeBack(c.back, rules) }));
}
