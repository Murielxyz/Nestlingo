// 编辑器共用的扩展：富文本编辑、以及把笔记 JSON 转回 HTML（分享图）都用它，
// 保证两边渲染的格式一致。

import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
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

// 链接：粘贴 URL 后跟空格 / 回车自动转成可点击链接。
// openOnClick: false —— 点链接不会跳转到新标签，否则想选中链接/token 时一碰就跳走、很棘手；
// 在内容可编辑区内点链接会选中它（可取消链接 / 取地址），真正打开用「目标标签」即可。
const LinkAuto = Link.configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  HTMLAttributes: {
    class: "tiptap-link",
    target: "_blank",
    rel: "noopener noreferrer nofollow",
  },
});

export const editorExtensions = [
  // v3 的 StarterKit 内置了 link 扩展，与下方自定义的 LinkAuto 重名会导致编辑器创建失败
  // （Duplicate extension names: ['link']），这里关掉内置的，保留带 openOnClick:false 的 LinkAuto。
  StarterKit.configure({ link: false }),
  LinkAuto,
  Highlight,
  // 文字对齐（左/中/右）：作用于标题和段落；表格单元格内也是段落，所以能对齐单元格内容。
  TextAlign.configure({ types: ["heading", "paragraph"] }),
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
