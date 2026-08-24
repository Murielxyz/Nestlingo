// 给编辑器里「原文」callout 加假名：读里面的日文正文 → 调 /api/ai/furigana 标音 → 原地替换回该区块。
// 中文概括段 / 翻译段保持不变；只重写含假名的日文正文段落（汉字上方标平假名）。

import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { furiganaSegmentsToParagraphs } from "@/lib/ai-note";
import { hasKana } from "@/lib/kana";

export async function addFuriganaToCallout(editor: Editor, pos: number): Promise<void> {
  const state = editor.state;
  const calloutNode = state.doc.nodeAt(pos);
  if (!calloutNode || calloutNode.type.name !== "callout" || calloutNode.attrs.kind !== "article") {
    throw new Error("找不到原文区块");
  }

  type Entry = { kind: "trans" | "keep" | "ja"; json: JSONContent; text: string };
  const entries: Entry[] = [];
  calloutNode.forEach((child) => {
    if (child.type.name !== "paragraph") return;
    const isTrans = child.firstChild?.marks?.some((m) => m.type.name === "translation") ?? false;
    const text = child.textContent ?? "";
    if (isTrans) entries.push({ kind: "trans", json: child.toJSON(), text });
    else if (hasKana(text)) entries.push({ kind: "ja", json: child.toJSON(), text });
    else entries.push({ kind: "keep", json: child.toJSON(), text });
  });

  const jaTexts = entries.filter((e) => e.kind === "ja").map((e) => e.text);
  if (jaTexts.length === 0) throw new Error("原文里没有日文正文，无需加假名");

  const res = await fetch("/api/ai/furigana", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: jaTexts.join("\n") }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "加假名失败");

  const paras = furiganaSegmentsToParagraphs(data?.segments ?? []);

  let jaIdx = 0;
  const newContent: JSONContent[] = entries.map((e) => {
    if (e.kind !== "ja") return e.json;
    const p = paras[jaIdx] ?? { type: "paragraph", content: [{ type: "text", text: e.text }] };
    jaIdx += 1;
    return p;
  });
  // 兜底：AI 返回的行数比原文多时，把多余的也拼到末尾。
  while (jaIdx < paras.length) {
    newContent.push(paras[jaIdx]);
    jaIdx += 1;
  }

  const newCallout: JSONContent = {
    type: "callout",
    attrs: calloutNode.attrs,
    content: newContent,
  };
  const newNode = state.schema.nodeFromJSON(newCallout);
  editor.view.dispatch(state.tr.replaceWith(pos, pos + calloutNode.nodeSize, newNode));
}

/** 判断「原文」区块里是否已经有假名标注（有则可切回「去假名」）。 */
export function calloutHasFurigana(node: PMNode): boolean {
  let found = false;
  node.descendants((n) => {
    if (n.isText && n.marks.some((m) => m.type.name === "furigana")) found = true;
  });
  return found;
}

/** 去掉「原文」区块里的假名标注，恢复成纯原文（只摘 furigana mark，保留生词高亮/语法下划线等其它标注）。
 *  摘完 mark 后重建一次节点：renderHTML 只在节点重建时才重跑，重建才能让「加/去假名」标签与装饰类即时刷新。 */
export function removeFuriganaFromCallout(editor: Editor, pos: number): void {
  const state = editor.state;
  const calloutNode = state.doc.nodeAt(pos);
  if (!calloutNode || calloutNode.type.name !== "callout") throw new Error("找不到原文区块");
  const furiganaType = state.schema.marks.furigana;
  // 只作用于区块正文范围（pos+1 … pos+nodeSize-1），removeMark 只摘 furigana、不动其它 mark。
  const from = pos + 1;
  const to = pos + calloutNode.nodeSize - 1;
  const tr = state.tr.removeMark(from, to, furiganaType);
  if (!tr.docChanged) return;
  editor.view.dispatch(tr);
  // 用去除后的内容重建等宽 callout：让 renderHTML 重新计算「加/去假名」文案。
  const cleaned = editor.state.doc.nodeAt(pos);
  if (!cleaned) return;
  const rebuilt: JSONContent = {
    type: "callout",
    attrs: cleaned.attrs,
    content: cleaned.toJSON().content,
  };
  editor.view.dispatch(
    state.tr.replaceWith(pos, pos + cleaned.nodeSize, state.schema.nodeFromJSON(rebuilt))
  );
}
