"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { editorExtensions } from "@/lib/editor-extensions";
import { docToText } from "@/lib/doc-to-text";
import type { JSONContent } from "@tiptap/core";

function ToolButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
        active
          ? "bg-teal-100 text-teal-700"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * TipTap 富文本编辑器本体（备忘录式：工具栏在顶部，正文铺满下方）。
 * 只在客户端渲染（由 note-editor 用 next/dynamic ssr:false 加载），
 * 通过 onChange 把最新的 JSON + 纯文本回传给父组件。
 * 纯文本用 docToText 序列化，让表格保留成 TSV，转成闪卡时能正确识别。
 */
export function RichTextEditor({
  initialContent,
  onChange,
}: {
  initialContent?: unknown;
  onChange?: (json: JSONContent | null, text: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      ...editorExtensions,
      Placeholder.configure({
        placeholder: "写点什么，或粘贴泰语生词 / 表格…",
      }),
    ],
    immediatelyRender: true,
    content: (initialContent ?? undefined) as JSONContent | undefined,
    editorProps: {
      attributes: {
        class: "tiptap px-4 md:px-8 py-4",
      },
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON(), docToText(editor.getJSON()));
    },
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const [blockType, setBlockType] = useState("paragraph");

  // 标题下拉要实时反映光标所在的块：显式监听 selection/transaction，
  // 否则光标的块变了（点标题、移动光标）下拉不一定重渲染，会「停在同一个」上。
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      setBlockType(
        editor.isActive("codeBlock")
          ? "codeBlock"
          : editor.isActive("heading", { level: 1 })
            ? "h1"
            : editor.isActive("heading", { level: 2 })
              ? "h2"
              : editor.isActive("heading", { level: 3 })
                ? "h3"
                : "paragraph"
      );
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    update();
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  if (!editor) {
    return <div className="flex-1 bg-white" />;
  }

  function applyBlockType(type: string) {
    if (type === "paragraph") {
      editor.chain().focus().setParagraph().run();
    } else if (type === "codeBlock") {
      editor.chain().focus().toggleCodeBlock().run();
    } else {
      const level = Number(type.slice(1)) as 1 | 2 | 3;
      if (editor.isActive("heading", { level })) return; // 已经是这个标题就不重复切
      editor.chain().focus().toggleHeading({ level }).run();
    }
  }

  function insertNormalTable() {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: false })
      .run();
  }

  /** 生词 / 例句 / 语法：插一个带彩色标签的 callout 块，内容「转成闪卡」时按标签自动归类。 */
  function insertKindCallout(kind: "word" | "example" | "grammar") {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "callout",
        attrs: { kind },
        content: [{ type: "paragraph" }],
      })
      .run();
  }

  /** 分列：插入一个两列并排块（原文/译文对照），不是表格、没有标题行。 */
  function insertSplitColumns() {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "columns",
        content: [
          { type: "column", content: [{ type: "paragraph" }] },
          { type: "column", content: [{ type: "paragraph" }] },
        ],
      })
      .run();
  }

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      editor.chain().focus().setImage({ src: reader.result as string }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  return (
    <div className="flex flex-1 flex-col bg-white">
      {/* 工具栏（清爽一条，不描边）；sticky 常驻顶部，写长笔记时不用滚回顶部就能插标题/表格等 */}
      <div className="sticky top-12 z-20 flex flex-wrap items-center gap-0.5 border-b border-zinc-100 bg-white px-3 py-1.5 md:px-6">
        {/* 标题级别下拉 */}
        <select
          value={blockType}
          onChange={(e) => applyBlockType(e.target.value)}
          title="块样式"
          className="mr-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
        >
          <option value="paragraph">正文</option>
          <option value="h1">标题</option>
          <option value="h2">小标题</option>
          <option value="h3">副标题</option>
          <option value="codeBlock">等宽样式</option>
        </select>

        <ToolButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="加粗"
        >
          <span className="font-bold">B</span>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="斜体"
        >
          <span className="italic">I</span>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="下划线"
        >
          <span className="underline">U</span>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive("highlight")}
          title="高亮"
        >
          <span className="rounded bg-yellow-200 px-1">A</span>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="列表"
        >
          ≡
        </ToolButton>
        {/* 生词 / 例句 / 语法：独立成一个按钮（不是表格），插一个带标签的 callout，转卡时按标签归类 */}
        <div className="relative">
          <ToolButton onClick={() => setKindMenuOpen((v) => !v)} title="插入生词 / 例句 / 语法">
            词
          </ToolButton>
          {kindMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setKindMenuOpen(false)} />
              <div className="absolute left-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg">
                <button
                  onClick={() => {
                    setKindMenuOpen(false);
                    insertKindCallout("word");
                  }}
                  className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                >
                  🟩 生词
                </button>
                <button
                  onClick={() => {
                    setKindMenuOpen(false);
                    insertKindCallout("example");
                  }}
                  className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                >
                  🟦 例句
                </button>
                <button
                  onClick={() => {
                    setKindMenuOpen(false);
                    insertKindCallout("grammar");
                  }}
                  className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                >
                  🟪 语法
                </button>
              </div>
            </>
          )}
        </div>

        {/* 表格：点一下插入普通表格；插好后下面出现一行横向「表格操作」工具栏 */}
        <ToolButton onClick={insertNormalTable} title="插入表格">
          ▦
        </ToolButton>
        <ToolButton onClick={insertSplitColumns} title="分列（原文 / 译文对照）">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="12" y1="4" x2="12" y2="20" />
          </svg>
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="分割线（分割区块，转成闪卡只取分割线到标题之间）"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="4" y1="12" x2="20" y2="12" />
          </svg>
        </ToolButton>
        <ToolButton onClick={() => fileInputRef.current?.click()} title="上传图片">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </ToolButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={pickImage}
        />

        <span className="mx-1 h-5 w-px bg-zinc-200" />

        <ToolButton onClick={() => editor.chain().focus().undo().run()} title="撤销">
          ↩
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().redo().run()} title="重做">
          ↪
        </ToolButton>
      </div>

      {/* 光标在表格里时：横向一条表格操作工具栏（插/删行列、标题行、删表） */}
      {editor.isActive("table") && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-teal-100 bg-teal-50/70 px-3 py-1 md:px-6">
          <span className="mr-1 text-xs font-medium text-zinc-500">行</span>
          <ToolButton onClick={() => editor.chain().focus().addRowBefore().run()} title="在上方插入一行">
            ＋上
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().addRowAfter().run()} title="在下方插入一行">
            ＋下
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().deleteRow().run()} title="删除选中的行">
            －行
          </ToolButton>

          <span className="mx-1 h-4 w-px bg-zinc-300" />

          <span className="mr-1 text-xs font-medium text-zinc-500">列</span>
          <ToolButton onClick={() => editor.chain().focus().addColumnBefore().run()} title="在左侧插入一列">
            ＋左
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().addColumnAfter().run()} title="在右侧插入一列">
            ＋右
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().deleteColumn().run()} title="删除选中的列">
            －列
          </ToolButton>

          <span className="mx-1 h-4 w-px bg-zinc-300" />

          <ToolButton onClick={() => editor.chain().focus().toggleHeaderRow().run()} title="切换标题行">
            标题行
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().deleteTable().run()} title="删除整个表格">
            删表
          </ToolButton>
        </div>
      )}

      <EditorContent editor={editor} className="flex-1" />
    </div>
  );
}
