// 「原文」callout 的操作按钮（翻译 / 精读笔记 / 加假名）。
// 按钮不再是 widget 装饰：widget 会渲染在 callout 块之前（跑到标签上方），且排不进行内标签。
// 现在由 callout-extension.ts 的 renderHTML 直接把按钮放进 .callout-label（PM 亲自产出，是节点 DOM
// 的一部分，不手动改 contenteditable → 不会触发 MutationObserver ↔ 解析 的死循环）。本插件只在
// 编辑器根上挂一个委托点击监听，从点击的按钮反查所属 callout 的 pos，交回编辑器组件的处理函数。
// 按钮只存在于编辑器；分享图 / 阅读模式经 renderHTML 也会输出，但被 CSS 隐藏。

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import { hasKana } from "@/lib/kana";
import {
  calloutHasFurigana,
  addFuriganaToCallout,
  removeFuriganaFromCallout,
} from "@/lib/furigana-apply";
import { calloutHasTranslation } from "@/lib/callout-extension";
import { translateCallout } from "@/lib/translate-apply";
import { analysisToNoteContent, type AiAnalysis } from "@/lib/ai-note";

export type CalloutAction = "analyze" | "toggleFurigana" | "translate";

type Handler = (action: CalloutAction, pos: number, rect: DOMRect) => void;

let actionHandler: Handler | null = null;
export function setCalloutActionHandler(h: Handler | null) {
  actionHandler = h;
}

const key = new PluginKey("calloutActions");

/** 从点击的按钮元素反查它是哪个「原文」callout 的 pos。
 *  用 view.nodeDOM(pos) 与点击元素比对（posAtDOM 对块节点的外容器会落到节点内部、错位），
 *  逐节点找 nodeDOM 严格等于点击的 .callout 容器，再校验该 pos 确实是 callout。 */
function findCalloutPos(view: EditorView, el: HTMLElement): number | null {
  const calloutEl = el.closest<HTMLElement>(".callout[data-kind=\"article\"]");
  if (!calloutEl) return null;
  let found: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.type.name !== "callout") return true;
    if (view.nodeDOM(pos) === calloutEl) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function calloutActionsPlugin(): Plugin {
  return new Plugin({
    key,
    props: {
      handleDOMEvents: {
        // 按钮在 contenteditable=false 的 label 里：mousedown 阻止它把焦点/选区带进正文。
        mousedown(view, e) {
          const target = e.target as HTMLElement | null;
          if (target?.closest?.(".callout-action")) return true;
          return false;
        },
      },
      // 给每个「原文」callout 加状态类：no-kana（无假名 → 藏掉加假名按钮，粘贴后实时刷新）、
      // is-translated（已翻译 → 给「翻译」按钮上已译色）。装饰每笔交易重算，故粘贴/翻译后即时生效。
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "callout" || node.attrs.kind !== "article") return true;
          const classes: string[] = [];
          if (!hasKana(node.textContent)) classes.push("no-kana");
          if (calloutHasTranslation(node)) classes.push("is-translated");
          if (classes.length) {
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: classes.join(" ") }));
          }
          return true;
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
    view(view) {
      const onClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        const btn = target?.closest?.<HTMLButtonElement>(".callout-action");
        if (!btn) return;
        const action = btn.dataset.calloutAction as CalloutAction | undefined;
        if (!action) return;
        e.preventDefault();
        e.stopPropagation();
        const pos = findCalloutPos(view, btn);
        if (pos != null) actionHandler?.(action, pos, btn.getBoundingClientRect());
      };
      view.dom.addEventListener("click", onClick);
      return {
        destroy() {
          view.dom.removeEventListener("click", onClick);
        },
      };
    },
  });
}

export const CalloutActions = Extension.create({
  name: "calloutActions",
  addProseMirrorPlugins() {
    return [calloutActionsPlugin()];
  },
});

/** 执行「原文」callout 的一个动作（翻译 / 精读笔记 / 加假名）。编辑器组件通过 setCalloutActionHandler 接入。
 *  `onTranslated`：翻译成功后再回掉一次（用于顺带翻译笔记标题）。 */
export async function runCalloutAction(
  editor: Editor,
  action: CalloutAction,
  pos: number,
  opts?: { onTranslated?: () => Promise<void> }
): Promise<void> {
  if (action === "toggleFurigana") {
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    if (calloutHasFurigana(node)) {
      removeFuriganaFromCallout(editor, pos);
    } else {
      try {
        await addFuriganaToCallout(editor, pos);
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
      }
    }
    return;
  }

  if (action === "translate") {
    try {
      await translateCallout(editor, pos);
      await opts?.onTranslated?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
    return;
  }

  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const text = (node.textContent ?? "").trim();
  if (!text) {
    alert("这段原文还没有内容");
    return;
  }

  try {
    const res = await fetch("/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "AI 精读失败");
    const analysis = data as AiAnalysis;
    const content =
      analysisToNoteContent(analysis, text, node.attrs.source as string | null).content ?? [];
    editor
      .chain()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, content)
      .run();
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
}
