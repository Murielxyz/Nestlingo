"use client";

import type { FuriganaSegment } from "@/lib/furigana";

/** 把卡片「正面」渲成可能带假名上标的控件：日语生词的汉字上方标平假名读音。
 *  reading 是存库的 JSON 字符串（{text,reading}[]）；解析失败或为空就原样显示纯文本，
 *  docToText 不参与（卡片显示是纯展示），不影响正面文字 / 搜索 / 转卡。 */
function parseReading(reading?: string | null): FuriganaSegment[] | null {
  if (!reading) return null;
  try {
    const arr = JSON.parse(reading);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const segs = arr
      .map((s) => ({
        text: String(s?.text ?? ""),
        reading: String(s?.reading ?? ""),
      }))
      .filter((s) => s.text.length > 0);
    return segs.length > 0 ? segs : null;
  } catch {
    return null;
  }
}

export function CardFront({
  text,
  reading,
}: {
  text: string;
  reading?: string | null;
}) {
  const segments = parseReading(reading);
  if (segments) {
    return (
      <>
        {segments.map((seg, i) =>
          seg.reading ? (
            <ruby key={i} className="furigana">
              {seg.text}
              <rt>{seg.reading}</rt>
            </ruby>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </>
    );
  }
  // 非 furigana 的纯字符串读音（泰语罗马音 / 日语假名 / 拼音 / 音标…）：
  // 在词下方加一行小号灰字，展示「怎么读」，同时保持正面原词不变（不影响搜索 / 转卡）。
  const plain = (reading ?? "").trim();
  if (plain) {
    return (
      <>
        <div>{text}</div>
        <div className="text-sm font-normal text-zinc-400">{plain}</div>
      </>
    );
  }
  return <>{text}</>;
}
