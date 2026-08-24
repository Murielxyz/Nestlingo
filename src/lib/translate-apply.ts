// 给笔记里的「原文」callout 做双语翻译（标签里的「翻译」按钮用）：先整理原文，再逐段翻成中文，
// 译文以 translation mark 插在原段下方，形成「原文 + 中文译文」上下双语对照。
// 已翻译过 / 已标过假名的旧内容会被重建为「只保留原文」的干净版本再翻，重复点不会越叠越多。
// 不含可翻译正文的 callout 跳过；整理原文会把多余的空白/空行压掉，让上面对照更干净。

import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/** 判断段落是否带「译文」标记。 */
function isTranslationPara(p: PMNode): boolean {
  return p.firstChild?.marks?.some((m) => m.type.name === "translation") ?? false;
}

/** 整理一段原文：折叠多余空白/换行、首尾去空。空段返回空串（由调用方决定去留）。 */
function tidyText(text: string): string {
  return text.replace(/[ \t\r\f\v]+/g, " ").replace(/\n+/g, " ").trim();
}

/** 把一个段落的 JSON 文本统一成纯文本（去掉已有的翻译/假名等 mark 脏内容），只留整理后的文字。 */
function toTidyTextPara(json: JSONContent, text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

/** 翻译一个「原文」callout（原地替换为 原文 + 译文 的上下双语对照）。 */
export async function translateCallout(editor: Editor, pos: number): Promise<void> {
  const state = editor.state;
  const calloutNode = state.doc.nodeAt(pos);
  if (!calloutNode || calloutNode.type.name !== "callout" || calloutNode.attrs.kind !== "article") {
    return;
  }

  // 重建会把「原文」段统一成干净纯文本（旧译文/旧假名 mark 一并去掉），只保留整理后的原文 + 新译文。
  type Entry = { kind: "orig" | "keep"; json: JSONContent };
  const entries: Entry[] = [];
  const origTexts: string[] = [];
  calloutNode.forEach((child) => {
    if (child.type.name !== "paragraph") {
      entries.push({ kind: "keep", json: child.toJSON() });
      return;
    }
    if (isTranslationPara(child)) return; // 旧译文丢弃，重建时重新按一段翻好插回
    const text = tidyText(child.textContent ?? "");
    if (!text) return; // 空段 / 纯空白：重建时直接去掉，做干净对照
    origTexts.push(text);
    entries.push({ kind: "orig", json: toTidyTextPara(child.toJSON(), text) });
  });

  if (origTexts.length === 0) return;

  const res = await fetch("/api/ai/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: origTexts.join("\n") }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "翻译失败");
  const translations = String(data?.translation ?? "")
    .split(/\n+/)
    .map((l) => l.trim());

  const newContent: JSONContent[] = [];
  let ti = 0;
  for (const e of entries) {
    newContent.push(e.json);
    if (e.kind === "orig") {
      const tr = translations[ti] ?? "";
      ti += 1;
      if (tr) {
        newContent.push({
          type: "paragraph",
          content: [{ type: "text", text: tr, marks: [{ type: "translation" }] }],
        });
      }
    }
  }

  const newCallout: JSONContent = {
    type: "callout",
    attrs: calloutNode.attrs,
    content: newContent,
  };
  const newNode = state.schema.nodeFromJSON(newCallout);
  editor.view.dispatch(state.tr.replaceWith(pos, pos + calloutNode.nodeSize, newNode));
}
