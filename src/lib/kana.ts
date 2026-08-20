// 日语「片假名 → 平假名」的确定性映射，用于精读原文里给片假名标注读音（振り仮名），不用 AI。
// 只处理片假名（含长音「ー」）；平假名 / 汉字 / 其它文字原样跳过。

/** 是否片假名字符（含长音记号「ー」）。 */
export function isKatakanaCode(c: number): boolean {
  // 0x30A1 ア … 0x30F6 ヺ；0x30FC ー（长音）
  return (c >= 0x30a1 && c <= 0x30f6) || c === 0x30fc;
}

/** 单个片假名 → 平假名；长音「ー」保留，其它字符原样返回。 */
function katakanaToHiraganaCode(c: number): string {
  if (c === 0x30fc) return "ー";
  if (c >= 0x30a1 && c <= 0x30f6) return String.fromCodePoint(c - 0x60);
  return String.fromCodePoint(c);
}

/** 一段（全为片假名的）字符串 → 平假名读音。 */
export function hiraganaOf(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += katakanaToHiraganaCode(s.charCodeAt(i));
  }
  return out;
}

/** 找出一行里所有「连续片假名」区间（start/end 按 UTF-16 索引，可直接 slice）。 */
export function katakanaRuns(line: string): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (isKatakanaCode(c)) {
      const start = i;
      while (i < line.length && isKatakanaCode(line.charCodeAt(i))) i++;
      runs.push({ start, end: i });
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < line.length) {
      i += 2; // 代理对（emoji 等），跳过整个码点
    } else {
      i += 1;
    }
  }
  return runs;
}
