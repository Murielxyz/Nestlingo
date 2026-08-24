// 编辑器共用的扩展：富文本编辑、以及把笔记 JSON 转回 HTML（分享图）都用它，
// 保证两边渲染的格式一致。

import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { Columns, Column } from "./columns-extension";
import { Callout } from "./callout-extension";
import { MediaEmbed } from "./media-embed-extension";
import { Translation } from "./translation-mark";
import { Furigana } from "./furigana-mark";
import { CalloutActions } from "./callout-actions";

// 表格：resizable 开启内置的列宽拖拽（prosemirror-tables 的 columnResizing 插件）。
// 列宽存进单元格 colwidth，generateHTML（分享图 / 阅读模式）也会输出 colgroup，两边一致。
// 不再用自定义 NodeView（它跟 columnResizing 抢节点视图，导致拖拽失效）。
const TableResizable = Table.configure({ resizable: true });

// 链接：粘贴 URL 后跟空格 / 回车自动转成可点击链接（openOnClick 点击即开新标签）。
const LinkAuto = Link.configure({
  openOnClick: true,
  autolink: true,
  linkOnPaste: true,
  HTMLAttributes: {
    class: "tiptap-link",
    target: "_blank",
    rel: "noopener noreferrer nofollow",
  },
});

export const editorExtensions = [
  StarterKit,
  LinkAuto,
  Highlight,
  Translation,
  Furigana,
  Image,
  TableResizable,
  TableRow,
  TableHeader,
  TableCell,
  Columns,
  Column,
  Callout,
  MediaEmbed,
  CalloutActions,
];
