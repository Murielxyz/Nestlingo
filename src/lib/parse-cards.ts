// 规则解析：把一段文本（粘贴自 Excel/Sheets 的表格、词表、或「词 — 释义」清单）
// 拆成结构化卡片。免费、离线、即时，作为 AI 识别的兜底。

import { HR_TEXT } from "@/lib/doc-to-text";
import { detectLang } from "@/lib/lang-detect";
import type { RecognitionRules, SplitRule } from "@/lib/types";

export interface ParsedCard {
  front: string;
  back: string;
  /** 读音（罗马音/拼音/音标），从表格「读音」列或行内「（读音）」里抽出；最后按设置并入正面或背面。 */
  hint?: string;
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
      const front = (cols[frontIdx] ?? "").trim();
      let back: string;
      if (backIdx === -1) {
        back = cols
          .filter((_, i) => i !== frontIdx)
          .filter(Boolean)
          .join(" ");
      } else {
        back = (cols[backIdx] ?? "").trim();
      }
      const hint = hintIdx >= 0 ? cols[hintIdx]?.trim() : "";
      const extras = extraIdxs
        .map((i) => cols[i]?.trim())
        .filter(Boolean);
      // 读音（hint）单独存，最后按设置放到正面或背面。
      // 拓展列（例句/补充等）每项另起一行接在背面后面
      for (const e of extras) back = back ? `${back}\n${e}` : e;
      return { front, back: back.trim(), hint: hint || undefined };
    })
    .filter((c) => c.front || c.back);
}

/** 从一段文字里把「（拉丁罗马音）」抽出来；只认拉丁字母开头的括号内容，避免把中文释义误当读音。 */
function extractParenHint(text: string): { rest: string; hint: string } {
  const m = text.match(/[(（]\s*([A-Za-z][A-Za-zÀ-ɏ̀-ͯ\s'\-]*)\s*[)）]/);
  if (!m) return { rest: text, hint: "" };
  const hint = m[1].replace(/\s+/g, " ").trim();
  const rest = (text.slice(0, m.index!) + " " + text.slice(m.index! + m[0].length))
    .replace(/\s+/g, " ")
    .trim();
  return { rest, hint };
}

/** 按脚本把「拉丁罗马音」从「非拉丁（泰/中/日等）文字」里抽出来，用于「词  读音  释义」这种中间裸读音。 */
function extractReadingByScript(text: string): { rest: string; hint: string } {
  if (!/[A-Za-z]/.test(text)) return { rest: text, hint: "" };
  const tokens = text.match(/[A-Za-zÀ-ɏ̀-ͯ'\-]+|[^A-Za-zÀ-ɏ̀-ͯ'\-]+/g) ?? [];
  const latin: string[] = [];
  const rest: string[] = [];
  for (const t of tokens) {
    if (/[A-Za-z]/.test(t)) latin.push(t);
    else if (t.trim()) rest.push(t.trim());
  }
  const hint = latin.join(" ").replace(/\s+/g, " ").trim();
  if (!hint) return { rest: text, hint: "" };
  return { rest: rest.join(" ").replace(/\s+/g, " ").trim(), hint };
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

/** 组装一张卡，并把读音抽成 hint（放正面还是背面由设置决定）。 */
function makeCard(front: string, back: string): ParsedCard {
  front = front.trim();
  back = back.trim();
  let card: ParsedCard;
  const fp = extractParenHint(front);
  if (fp.hint) {
    card = { front: fp.rest, back, hint: fp.hint };
  } else {
    const bp = extractParenHint(back);
    if (bp.hint) {
      card = { front, back: bp.rest, hint: bp.hint };
    } else if (/[【】]/.test(back)) {
      // 背面已带【读音】标记（如「搜索【kát săn】」）：按默认规则原样保留，不再拆。
      card = { front, back };
    } else if (detectLang(front) !== "other") {
      // 泰/中/日等非拉丁语种的生词，背面若混着「拉丁读音 + 非拉丁释义」，把拉丁部分抽成读音。
      const sb = extractReadingByScript(back);
      card = sb.hint ? { front, back: sb.rest, hint: sb.hint } : { front, back };
    } else {
      card = { front, back };
    }
  }
  return card;
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
  // 「词：释义」/「词: 释义」
  const colon = line.match(/^(.+?)\s*[:：]\s*(.+)$/);
  if (colon) return makeCard(colon[1], colon[2]);
  // 「词 - 释义」/「词 — 释义」（连字符前后带空格，避免误拆英文连字符词）
  const dash = line.match(/^(.+?)\s+[-—–]\s+(.+)$/);
  if (dash) return makeCard(dash[1], dash[2]);
  // 「词—释义」（破折号无空格）
  const emdash = line.match(/^(.+?)\s*[—–]\s*(.+)$/);
  if (emdash) return makeCard(emdash[1], emdash[2]);
  // 「词  释义」（两个及以上空格）
  const spaces = line.match(/^(.+?)\s{2,}(.+)$/);
  if (spaces) return makeCard(spaces[1], spaces[2]);
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

/** 把抽出来的读音按设置放回正面（词（读音））或背面（另起一行【读音】），并先做背面分句/换行。 */
function applyReading(card: ParsedCard, rules?: RecognitionRules | null): ParsedCard {
  card.back = normalizeBack(card.back, rules);
  const hint = (card.hint ?? "").trim();
  if (!hint) return card;
  const position = rules?.reading ?? "back";
  if (position === "front") {
    card.front = card.front ? `${card.front}（${hint}）` : hint;
  } else {
    // 背面：第一行【读音】，第二行才是释义。
    card.back = card.back ? `【${hint}】\n${card.back}` : `【${hint}】`;
  }
  card.hint = undefined;
  return card;
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

    // 表格：逗号分隔且每行列数一致（≥2）。只在第一行能识别成表头时才当表格，
    // 避免把带逗号的普通正文（尤其两栏原文/译文）误拆成卡片。
    const colCounts = lines.map((l) => l.split(",").length);
    if (colCounts[0] >= 2 && colCounts.every((n) => n === colCounts[0])) {
      const headerRoles = lines[0].split(",").map((h) => classifyHeader(h, rules));
      if (headerRoles.some((r) => r !== null)) {
        cards = parseTable(lines, ",", rules);
      } else {
        cards = parseLines(lines, rules, bareToCard, scope);
      }
    } else {
      // 逐行：「词 — 释义」「词：释义」
      cards = parseLines(lines, rules, bareToCard, scope);
    }
  }

  // 把抽出来的读音按设置放回正面或背面。
  return cards.map((c) => applyReading(c, rules));
}
