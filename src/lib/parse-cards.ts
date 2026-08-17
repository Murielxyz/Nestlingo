// 规则解析：把一段文本（粘贴自 Excel/Sheets 的表格、词表、或「词 — 释义」清单）
// 拆成结构化卡片。免费、离线、即时，作为 AI 识别的兜底。

import { HR_TEXT } from "@/lib/doc-to-text";

export interface ParsedCard {
  front: string;
  back: string;
}

type Role = "front" | "back" | "hint" | "extra";

/** 把表头模糊匹配到 正面/背面/读音/拓展 四种角色。 */
function classifyHeader(raw: string): Role | null {
  const s = raw.trim().toLowerCase();
  if (/读音|发音|音标|拼音|罗马|音读|训读|romaniz|pronunc|reading/.test(s)) return "hint";
  if (/拓展|扩展|延伸|补充|拓展内容|extra|extension/.test(s)) return "extra";
  if (/释义|意思|含义|中文|翻译|译文|解释|定义|备注|注释|meaning|definition|translation/.test(s)) return "back";
  if (/词汇|单词|生词|生字|词|word|term|泰语|韩语|日语|英语|原文|front|表达|短语|句子|例句/.test(s)) return "front";
  return null;
}

function splitRow(line: string, delim: string): string[] {
  return line.split(delim).map((c) => c.trim());
}

function parseTable(lines: string[], delim: string): ParsedCard[] {
  const rows = lines.map((l) => splitRow(l, delim));
  if (rows.length === 0) return [];

  const header = rows[0];
  const roles = header.map(classifyHeader);
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
      if (hint) back = back ? `${back}（${hint}）` : hint;
      // 拓展列（例句/补充等）每项另起一行接在背面后面
      for (const e of extras) back = back ? `${back}\n${e}` : e;
      return { front, back: back.trim() };
    })
    .filter((c) => c.front || c.back);
}

function splitLine(line: string): ParsedCard | null {
  if (line.includes("\t")) {
    const [f, ...rest] = line.split("\t");
    return { front: f.trim(), back: rest.join(" ").trim() };
  }
  // 「词：释义」/「词: 释义」
  const colon = line.match(/^(.+?)\s*[:：]\s*(.+)$/);
  if (colon) return { front: colon[1].trim(), back: colon[2].trim() };
  // 「词 - 释义」/「词 — 释义」（连字符前后带空格，避免误拆英文连字符词）
  const dash = line.match(/^(.+?)\s+[-—–]\s+(.+)$/);
  if (dash) return { front: dash[1].trim(), back: dash[2].trim() };
  // 「词—释义」（破折号无空格）
  const emdash = line.match(/^(.+?)\s*[—–]\s*(.+)$/);
  if (emdash) return { front: emdash[1].trim(), back: emdash[2].trim() };
  // 「词  释义」（两个及以上空格）
  const spaces = line.match(/^(.+?)\s{2,}(.+)$/);
  if (spaces) return { front: spaces[1].trim(), back: spaces[2].trim() };
  return null;
}

function parseLines(lines: string[]): ParsedCard[] {
  return lines
    .map((line) => splitLine(line) ?? { front: line, back: "" })
    .filter((c) => c.front);
}

/** 入口：文本 → 卡片数组。 */
export function parseCards(text: string): ParsedCard[] {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== HR_TEXT); // 分割线不是卡片内容，整篇模式也跳过
  if (rawLines.length === 0) return [];

  // 表格：某行有制表符（从 Excel/Sheets 粘贴最常见）。
  // 把连续含 \t 的行当作一个表格块，其它非空行按「词—释义」行处理，
  // 避免把表格上方的说明文字（如「生词」小标题）误当成表格第一行。
  if (rawLines.some((l) => l.includes("\t"))) {
    const results: ParsedCard[] = [];
    let tableBlock: string[] = [];
    const flush = () => {
      if (tableBlock.length > 0) {
        results.push(...parseTable(tableBlock, "\t"));
        tableBlock = [];
      }
    };
    for (const line of rawLines) {
      if (line.includes("\t")) {
        tableBlock.push(line);
      } else {
        flush();
        if (line) results.push(...parseLines([line]));
      }
    }
    flush();
    return results;
  }

  const lines = rawLines.filter(Boolean);

  // 表格：逗号分隔且每行列数一致（≥2）
  const colCounts = lines.map((l) => l.split(",").length);
  if (colCounts[0] >= 2 && colCounts.every((n) => n === colCounts[0])) {
    return parseTable(lines, ",");
  }

  // 逐行：「词 — 释义」「词：释义」
  return parseLines(lines);
}
