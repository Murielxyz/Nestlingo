// 给笔记里的「原文」callout 做双语翻译（标签里的「翻译」按钮用）：先整理原文，再逐段翻成中文，
// 译文以 translation mark 插在原段下方，形成「原文 + 中文译文」上下双语对照。
// 正文段落、小标题（标题）、以及列表（清单）都会翻——标题常被粘贴成 heading 块，旧逻辑只认 paragraph 漏掉了标题/列表。
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

/** 哪些块参与翻译：正文段落 + 标题。其它块（列表、引用、图片、表格等）原样保留不翻。 */
function isTranslatableBlock(child: PMNode): boolean {
  return child.type.name === "paragraph" || child.type.name === "heading";
}

/** 把「可翻译块」的 JSON 重建成干净纯文本（去掉已有的翻译/假名等 mark 脏内容），保留原块类型与 attrs。
 *  段落/标题都能翻，译文作为独立 paragraph 插回原块下方。 */
function toTidyTextBlock(json: JSONContent, text: string): JSONContent {
  return {
    type: json.type as string,
    ...(json.attrs ? { attrs: json.attrs } : {}),
    content: [{ type: "text", text }],
  };
}

/** 列表项里「原文」文本：拼接其非译文段落，排除旧译文，用于整项翻译。 */
function listItemOrigText(listItem: PMNode): string {
  let text = "";
  listItem.forEach((c) => {
    if (c.type.name !== "paragraph" || isTranslationPara(c)) return;
    const t = tidyText(c.textContent ?? "");
    if (t) text = text ? `${text} ${t}` : t;
  });
  return text;
}

/** 重建一个列表项为首段(原文 纯文本) + 子块(嵌套列表等) + 译文段（占位，翻完回填）。旧译文段丢弃。 */
function rebuildListItem(listItem: PMNode, origText: string, trans: JSONContent): JSONContent {
  const out: JSONContent[] = [];
  listItem.forEach((c) => {
    if (c.type.name === "paragraph") {
      if (isTranslationPara(c)) return; // 旧译文丢弃，重建时重新翻好插回
      out.push({ type: "paragraph", content: [{ type: "text", text: origText }] });
      return;
    }
    out.push(c.toJSON()); // 嵌套列表等子块原样保留
  });
  out.push(trans);
  return { type: "listItem", content: out };
}

/** 翻译一个「原文」callout（原地替换为 原文 + 译文 的上下双语对照）。 */
export async function translateCallout(editor: Editor, pos: number): Promise<void> {
  const state = editor.state;
  const calloutNode = state.doc.nodeAt(pos);
  if (!calloutNode || calloutNode.type.name !== "callout" || calloutNode.attrs.kind !== "article") {
    return;
  }

  // 重建会把「原文」块统一成干净纯文本（旧译文/旧假名 mark 一并去掉），只保留整理后的原文 + 新译文。
  type Entry = { kind: "orig" | "keep"; json: JSONContent; trans?: JSONContent };
  const entries: Entry[] = [];
  const origTexts: string[] = [];
  const transParas: JSONContent[] = [];

  /** 入队一段要翻的原文，返回它的「译文段落」占位符（翻完后统一回填文本）。 */
  function queueTrans(text: string): JSONContent {
    origTexts.push(text);
    const trans: JSONContent = {
      type: "paragraph",
      content: [{ type: "text", text: "", marks: [{ type: "translation" }] }],
    };
    transParas.push(trans);
    return trans;
  }

  calloutNode.forEach((child) => {
    // 列表：整条列表重建，翻译逐个落在每个列表项内（原文下、缩进更小不换行）。
    if (child.type.name === "bulletList" || child.type.name === "orderedList") {
      const items: JSONContent[] = [];
      child.forEach((listItem) => {
        const text = listItemOrigText(listItem);
        if (!text) {
          items.push(listItem.toJSON());
          return;
        }
        items.push(rebuildListItem(listItem, text, queueTrans(text)));
      });
      entries.push({ kind: "keep", json: { type: child.type.name, attrs: child.attrs ?? undefined, content: items } });
      return;
    }

    if (!isTranslatableBlock(child)) {
      entries.push({ kind: "keep", json: child.toJSON() });
      return;
    }
    if (isTranslationPara(child)) return; // 旧译文丢弃，重建时重新按一段翻好插回
    const text = tidyText(child.textContent ?? "");
    if (!text) return; // 空段 / 纯空白：重建时直接去掉，做干净对照
    const trans = queueTrans(text);
    entries.push({ kind: "orig", json: toTidyTextBlock(child.toJSON(), text), trans });
  });

  if (origTexts.length === 0) return;

  const res = await fetch("/api/ai/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paragraphs: origTexts }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "翻译失败");
  const translations: string[] = Array.isArray(data?.translations)
    ? data.translations.map((t: unknown) => (typeof t === "string" ? t.trim() : ""))
    : [];

  // 按文档顺序回填每个译文占位符（段落/标题的直接排在下方、列表项内的在各自项内）。
  transParas.forEach((p, i) => {
    p.content = [{ type: "text", text: translations[i] ?? "", marks: [{ type: "translation" }] }];
  });

  const newContent: JSONContent[] = [];
  for (const e of entries) {
    newContent.push(e.json);
    if (e.kind === "orig" && e.trans) newContent.push(e.trans);
  }

  const newCallout: JSONContent = {
    type: "callout",
    attrs: calloutNode.attrs,
    content: newContent,
  };
  const newNode = state.schema.nodeFromJSON(newCallout);
  editor.view.dispatch(state.tr.replaceWith(pos, pos + calloutNode.nodeSize, newNode));
}
