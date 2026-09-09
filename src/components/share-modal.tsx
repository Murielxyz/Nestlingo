"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { generateHTML } from "@tiptap/core";
import { editorExtensions } from "@/lib/editor-extensions";
import { KIND_META } from "@/lib/callout-extension";
import { docToText } from "@/lib/doc-to-text";
import type { JSONContent } from "@tiptap/core";

type BgKey = "white" | "paper" | "dark" | "grid" | "pastel";

type Bg = {
  key: BgKey;
  label: string;
  swatch: string;
  bg: string;
  text: string;
  sub: string;
};

const BACKGROUNDS: Bg[] = [
  { key: "white", label: "白纸", swatch: "#ffffff", bg: "#ffffff", text: "#27272a", sub: "#71717a" },
  { key: "paper", label: "米黄", swatch: "#faf6ec", bg: "#faf6ec", text: "#3f3a2e", sub: "#9a8a6a" },
  { key: "dark", label: "深色", swatch: "#1e1e2e", bg: "#1e1e2e", text: "#ececf1", sub: "#9a9aad" },
  { key: "pastel", label: "粉彩", swatch: "#f3d9ef", bg: "linear-gradient(135deg, #fde7f3 0%, #e0f0ff 100%)", text: "#4a3a44", sub: "#8a6f7d" },
  { key: "grid", label: "网格", swatch: "#f4f4f5", bg: "#ffffff", text: "#27272a", sub: "#71717a" },
];

const GRID_BG =
  "linear-gradient(#eef0f2 1px, transparent 1px), linear-gradient(90deg, #eef0f2 1px, transparent 1px)";

const FONT =
  '-apple-system, "PingFang SC", "Hiragino Sans GB", "Noto Sans Thai", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

const PAGE_WIDTH = 720; // 分享图基准宽度（pixelRatio=2 下载时翻倍，实际 1440px）
const PAGE_PADDING = 32; // p-8
const BLOCK_GAP = 12;

type RatioKey = "1:1" | "3:4" | "4:3" | "16:9" | "9:16";

// 可选图片比例：宽度固定 720，高度按比例换算。
const RATIOS: { key: RatioKey; label: string; h: number }[] = [
  { key: "1:1", label: "1:1", h: 720 },
  { key: "3:4", label: "3:4", h: 960 },
  { key: "4:3", label: "4:3", h: 540 },
  { key: "16:9", label: "16:9", h: 405 },
  { key: "9:16", label: "9:16", h: 1280 },
];

type Part =
  | { kind: "title" }
  | { kind: "label"; label: string; color: string }
  | { kind: "block"; index: number; table?: TablePartInfo }
  | { kind: "footer" };

/** 一个「表头行 / 表体行」part 所属的表格信息：同一张表共享 groupId，表头 isHeader=true。 */
type TablePartInfo = {
  groupId: number;
  isHeader: boolean;
};

/** 一页里的渲染单元：普通 part（title/label/块/footer）或合并后的整张表。 */
type RenderUnit =
  | { kind: "part"; part: Part }
  | { kind: "table"; html: string };

/** 给一个正文块生成一行纯文本预览（用于勾选列表）。 */
function blockPreview(block: JSONContent): string {
  const t = docToText({ type: "doc", content: [block] }).replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 60)}…` : t || "（空块）";
}

// ===== 表格按行切分（分享成图） =====

/** 拆出一张表的表头行（可选）+ 表体行。表头判断：第一行首格 type 为 tableHeader。 */
function splitTable(table: JSONContent): {
  header: JSONContent | null;
  body: JSONContent[];
  hasHeader: boolean;
} {
  const rows = (table.content ?? []) as JSONContent[];
  if (rows.length === 0) return { header: null, body: [], hasHeader: false };
  const firstCell = ((rows[0].content ?? []) as JSONContent[])[0];
  // toggleHeaderRow 是「整行」切 header_cell，判第一格即可。
  const hasHeader = firstCell?.type === "tableHeader";
  if (hasHeader) return { header: rows[0], body: rows.slice(1), hasHeader: true };
  return { header: null, body: rows, hasHeader: false };
}

/** 是否有竖向合并单元格（rowspan>1）：按行切会截断，检测到就整块保留。 */
function hasRowspan(table: JSONContent): boolean {
  for (const row of (table.content ?? []) as JSONContent[]) {
    for (const cell of (row.content ?? []) as JSONContent[]) {
      if (((cell.attrs?.rowspan as number) ?? 1) > 1) return true;
    }
  }
  return false;
}

/** 用原表 attrs（含 colwidth）包若干行，构造一个「单行 / 带表头」小表格节点。 */
function makeTable(node: JSONContent, rows: JSONContent[]): JSONContent {
  return { type: "table", ...(node.attrs ? { attrs: node.attrs } : {}), content: rows };
}

/** 把「表头 + 本页若干行」合并成一个完整表格的 HTML。 */
function renderTableSlice(headerRow: JSONContent | null, bodyRows: JSONContent[]): string {
  const content = headerRow ? [headerRow, ...bodyRows] : bodyRows;
  try {
    return generateHTML({ type: "doc", content: [{ type: "table", content }] }, editorExtensions);
  } catch {
    return "";
  }
}

/** 把一页里的 part 分组：连续同 groupId 的表格 part 合并成一个 {kind:"table"} 单元。 */
function buildPageUnits(page: Part[], flatNodes: JSONContent[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  let i = 0;
  while (i < page.length) {
    const p = page[i];
    if (p.kind === "block" && p.table) {
      const g = p.table.groupId;
      const slice: Part[] = [];
      while (i < page.length) {
        const q = page[i];
        if (!(q.kind === "block" && q.table?.groupId === g)) break;
        slice.push(q);
        i++;
      }
      const headerPart = slice.find((x) => x.kind === "block" && x.table?.isHeader);
      const headerRow =
        headerPart && headerPart.kind === "block"
          ? (flatNodes[headerPart.index].content?.[0] ?? null)
          : null;
      const bodyRows = slice
        .filter((x) => x.kind === "block" && !x.table?.isHeader)
        .map((x) => (x.kind === "block" ? flatNodes[x.index].content?.[0] : null))
        .filter((x): x is JSONContent => Boolean(x));
      units.push({ kind: "table", html: renderTableSlice(headerRow, bodyRows) });
    } else {
      units.push({ kind: "part", part: p });
      i++;
    }
  }
  return units;
}

/**
 * 分享：把笔记按原排版生成图片（标题 + 正文，保留加粗/标题/列表/表格）。
 * 去掉固定比例，改为固定宽度 + 自然高度；长文按「块」切分，绝不在段落/表格中间切断，
 * 逐页生成多张 PNG（标题只在第 1 页、页脚只在最后一页）。
 */
export function ShareModal({
  title,
  content,
  onClose,
}: {
  title: string;
  content: JSONContent | null;
  onClose: () => void;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [bgKey, setBgKey] = useState<BgKey>("white");
  const [ratioKey, setRatioKey] = useState<RatioKey>("3:4");
  // 分享视图：笔记样式（callout 带颜色整块保留） / 按条切页（长列表逐条分页）
  const [viewMode, setViewMode] = useState<"note" | "flat">("note");
  const [editTitle, setEditTitle] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<Part[][]>([]);
  // 每页的实际内容高度（不含上下 p-8 边距），用于让每张图自适应内容、不浪费画幅。
  const [pageHeights, setPageHeights] = useState<number[]>([]);
  // 取消勾选的正文块（默认全选）。用「反选集合」表示，空集合 = 全部导出。
  const [deselected, setDeselected] = useState<Set<number>>(new Set());
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);

  const bg = BACKGROUNDS.find((b) => b.key === bgKey)!;
  const ratio = RATIOS.find((r) => r.key === ratioKey)!;
  const PAGE_HEIGHT = ratio.h;
  const CONTENT_MAX = PAGE_HEIGHT - PAGE_PADDING * 2;

  // 顶层块（标题 + 每个正文块 + 页脚 按顺序排列，测高后切页）
  const blocks = useMemo<JSONContent[]>(() => {
    if (!content?.content) return [];
    return (content.content as JSONContent[]).filter(
      (n) => n && typeof n === "object"
    );
  }, [content]);

  // 把选中的顶层块「摊平」成可独立切页的单元：callout 拆成「标签 + 内容」，列表拆成逐条，
  // 这样生词/例句太多时可以按条切到多张图，而不是把整块裁掉。
  const { flatNodes, flatHtmls, parts } = useMemo(() => {
    const flatNodes: JSONContent[] = [];
    const parts: Part[] = [{ kind: "title" }];
    let tableId = 0;

    const addNode = (node: JSONContent, table?: TablePartInfo) => {
      flatNodes.push(node);
      parts.push({ kind: "block", index: flatNodes.length - 1, ...(table ? { table } : {}) });
    };

    const flatten = (node: JSONContent) => {
      if (node.type === "bulletList" || node.type === "orderedList") {
        // 列表逐条拆，每条渲染成一个单项列表（保留项目符号），也方便按条切页。
        for (const li of node.content ?? []) {
          addNode({ type: node.type, content: [li] });
        }
      } else if (node.type === "table") {
        // 表格按行拆：表头 + 逐行各成一个 part（单行小表格），切页时跨页重复表头。
        const rows = (node.content ?? []) as JSONContent[];
        if (rows.length === 0 || hasRowspan(node)) {
          addNode(node); // 空表 / 含 rowspan：整块保留，不切
          return;
        }
        const { header, body, hasHeader } = splitTable(node);
        const groupId = tableId++;
        if (hasHeader && header) {
          addNode(makeTable(node, [header]), { groupId, isHeader: true });
          for (const row of body) addNode(makeTable(node, [row]), { groupId, isHeader: false });
        } else {
          for (const row of body) addNode(makeTable(node, [row]), { groupId, isHeader: false });
        }
      } else {
        addNode(node);
      }
    };

    blocks.forEach((block, i) => {
      if (deselected.has(i)) return;
      if (viewMode === "flat" && block.type === "callout") {
        // 按条切页：callout 拆成「标签 + 逐条内容」，超长时逐条分页
        const kind = (block.attrs?.kind as string) ?? "word";
        const meta = KIND_META[kind] ?? KIND_META.word;
        if (meta.label) {
          parts.push({ kind: "label", label: meta.label, color: meta.color });
        }
        for (const child of block.content ?? []) flatten(child);
      } else if (block.type === "table") {
        // 顶层表格也按行拆（笔记样式 / 按条切页两种视图都拆）：超页时切到多张并在每页重复表头。
        flatten(block);
      } else {
        // 笔记样式：整块保留，callout 按笔记内页配色渲染（见 globals.css）
        addNode(block);
      }
    });

    parts.push({ kind: "footer" });

    // generateHTML 依赖 window.document，只在浏览器里能跑（本组件仅在点击后客户端渲染）。
    const flatHtmls =
      typeof window === "undefined"
        ? flatNodes.map(() => "")
        : flatNodes.map((n) => {
            try {
              return generateHTML({ type: "doc", content: [n] }, editorExtensions);
            } catch {
              return "";
            }
          });

    return { flatNodes, flatHtmls, parts };
  }, [blocks, deselected, viewMode]);

  function toggleBlock(i: number) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const selectedCount = blocks.length - deselected.size;
  const allSelected = deselected.size === 0;

  // 全选按钮：点一下全部选中，再点一下清空（之后自己逐条勾选）。
  function toggleSelectAll() {
    setDeselected((prev) =>
      prev.size === 0 ? new Set(blocks.map((_, i) => i)) : new Set()
    );
  }

  // 测量每个部分的高度，按页高上限切分（标题自然落在第 1 页、页脚落在最后一页）。
  // 注意：测量容器外层还套了一个 flex 容器，所以取 el.firstElementChild 的 children 才是每个块。
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const wrap = el.firstElementChild as HTMLElement | null;
    if (!wrap) return;
    const nodes = Array.from(wrap.children) as HTMLElement[];
    if (nodes.length !== parts.length) return;

    // 表头行高度按 groupId 预取一次，跨页重复时直接复用（口径与首页表头一致）。
    const headerByGroup = new Map<number, { part: Part; h: number }>();
    nodes.forEach((n, i) => {
      const p = parts[i];
      if (p.kind === "block" && p.table?.isHeader) {
        headerByGroup.set(p.table.groupId, { part: p, h: n.offsetHeight + BLOCK_GAP });
      }
    });

    const result: Part[][] = [];
    const heights: number[] = [];
    let cur: Part[] = [];
    let height = 0;
    const closePage = () => {
      if (cur.length) {
        result.push(cur);
        // 内容高度 = 各块高度之和（含 gap）去掉最后一个块后面的 gap。
        heights.push(Math.max(0, height - BLOCK_GAP));
        cur = [];
        height = 0;
      }
    };

    nodes.forEach((node, i) => {
      const p = parts[i];
      const h = node.offsetHeight + BLOCK_GAP;

      // 表格 part 单独处理：表头是整表起点；表体行放不下断页时，上一页已有这张表则新页先重复表头。
      if (p.kind === "block" && p.table) {
        const g = p.table.groupId;
        if (p.table.isHeader) {
          if (cur.length > 0 && height + h > CONTENT_MAX) closePage();
          cur.push(p);
          height += h;
        } else {
          if (cur.length > 0 && height + h > CONTENT_MAX) {
            const pageHasGroup = cur.some(
              (x) => x.kind === "block" && x.table?.groupId === g
            );
            closePage();
            const hdr = headerByGroup.get(g);
            if (hdr && pageHasGroup) {
              cur.push(hdr.part);
              height = hdr.h;
            }
          }
          cur.push(p);
          height += h;
        }
        return;
      }

      // title / label / 普通块 / footer：保持原逻辑。
      if (cur.length > 0 && height + h > CONTENT_MAX) closePage();
      cur.push(p);
      height += h;
    });

    closePage();
    setPages(result);
    setPageHeights(heights);
  }, [parts, flatHtmls, editTitle, ratioKey, CONTENT_MAX]);

  // 预览按容器宽度等比缩小，让整张图完整可见（不横向滚动、不放大画幅）。
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    const update = () => setPreviewScale(Math.min(1, el.clientWidth / PAGE_WIDTH));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bgStyle: React.CSSProperties =
    bgKey === "grid"
      ? { background: "#ffffff", backgroundImage: GRID_BG, backgroundSize: "24px 24px" }
      : { background: bg.bg };

  function renderPart(part: Part) {
    if (part.kind === "title") {
      return (
        <h2 className="text-2xl font-bold leading-snug" style={{ color: bg.text }}>
          {editTitle || "无标题"}
        </h2>
      );
    }
    if (part.kind === "footer") {
      return <p className="text-xs" style={{ color: bg.sub }}>语巢 · Nestlingo</p>;
    }
    if (part.kind === "label") {
      return (
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ background: part.color }}
          />
          <span className="text-sm font-semibold" style={{ color: part.color }}>
            {part.label}
          </span>
        </div>
      );
    }
    return (
      <div
        className="share-content"
        style={{ color: bg.text }}
        dangerouslySetInnerHTML={{ __html: flatHtmls[part.index] ?? "" }}
      />
    );
  }

  // 每页的渲染单元：把同一张表在本页的「表头 + 若干行」合并回一个 <table>（避免每行小表格带间隙）。
  const pageUnits = useMemo(
    () => pages.map((page) => buildPageUnits(page, flatNodes)),
    [pages, flatNodes]
  );

  function renderUnit(unit: RenderUnit) {
    if (unit.kind === "table") {
      return (
        <div
          className="share-content"
          style={{ color: bg.text }}
          dangerouslySetInnerHTML={{ __html: unit.html }}
        />
      );
    }
    return renderPart(unit.part);
  }

  async function download() {
    if (pages.length === 0) return;
    setBusy(true);
    setError(null);
    const fname = editTitle.trim() || "语巢笔记";
    try {
      for (let i = 0; i < pages.length; i++) {
        const node = pageRefs.current[i];
        if (!node) continue;
        const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true });
        const a = document.createElement("a");
        a.download = pages.length > 1 ? `${fname}-${i + 1}.png` : `${fname}.png`;
        a.href = dataUrl;
        a.click();
        // 多张时中间加小延时，避免浏览器拦截连续下载。
        if (i < pages.length - 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    } catch {
      setError("生成图片失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <header className="flex items-start justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">生成分享图片</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              按笔记原排版生成，长文自动分成多张图片。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {/* 背景 */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">背景</p>
            <div className="flex flex-wrap gap-1.5">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setBgKey(b.key)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                    bgKey === b.key
                      ? "bg-teal-50 ring-2 ring-teal-300"
                      : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  <span
                    className="inline-block h-4 w-4 rounded-full border border-zinc-200"
                    style={{ background: b.swatch }}
                  />
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* 图片比例 */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">比例</p>
            <div className="flex flex-wrap gap-1.5">
              {RATIOS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRatioKey(r.key)}
                  className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                    ratioKey === r.key
                      ? "bg-teal-50 text-teal-700 ring-2 ring-teal-300"
                      : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* 视图：笔记样式（callout 带颜色整块保留） / 按条切页（长列表逐条分页） */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">视图</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setViewMode("note")}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  viewMode === "note"
                    ? "bg-teal-50 text-teal-700 ring-2 ring-teal-300"
                    : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                笔记样式
              </button>
              <button
                onClick={() => setViewMode("flat")}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  viewMode === "flat"
                    ? "bg-teal-50 text-teal-700 ring-2 ring-teal-300"
                    : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                按条切页
              </button>
            </div>
          </div>

          {/* 标题（可改） */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">标题</p>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="标题"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-800 focus:border-teal-500 focus:outline-none placeholder:text-sm"
            />
          </div>

          {/* 选择要导出的内容（默认全选） */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-500">
                选择内容（{selectedCount}/{blocks.length}）
              </p>
              <button
                onClick={toggleSelectAll}
                className="text-xs font-medium text-teal-600 hover:text-teal-700"
              >
                {allSelected ? "清空" : "全选"}
              </button>
            </div>
            {blocks.length === 0 ? (
              <p className="text-xs text-zinc-400">没有可导出的正文块。</p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2">
                {blocks.map((b, i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 hover:bg-zinc-50">
                      <input
                        type="checkbox"
                        checked={!deselected.has(i)}
                        onChange={() => toggleBlock(i)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-teal-600"
                      />
                      <span className="min-w-0 flex-1 text-xs leading-snug text-zinc-600">
                        {blockPreview(b)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 预览（按页叠放） */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">
              预览{pages.length > 1 ? `（共 ${pages.length} 张）` : ""}
            </p>
            <div ref={previewWrapRef} className="space-y-3">
              {pages.length === 0 ? (
                <p className="py-6 text-center text-xs text-zinc-400">生成预览中…</p>
              ) : (
                pages.map((_, pi) => {
                  const pageH = (pageHeights[pi] ?? 0) + PAGE_PADDING * 2;
                  return (
                  <div key={pi} className="w-full">
                    <p className="mb-1 text-[11px] text-zinc-400">第 {pi + 1} 页</p>
                    <div
                      className="overflow-hidden"
                      style={{
                        width: PAGE_WIDTH * previewScale,
                        height: pageH * previewScale,
                      }}
                    >
                      <div
                        style={{
                          transform: `scale(${previewScale})`,
                          transformOrigin: "top left",
                        }}
                      >
                        <div
                          ref={(el) => {
                            pageRefs.current[pi] = el;
                          }}
                          className="flex flex-col overflow-hidden"
                          style={{
                            width: PAGE_WIDTH,
                            height: pageH,
                            ...bgStyle,
                            color: bg.text,
                            fontFamily: FONT,
                          }}
                        >
                          <div
                            className={`flex flex-col p-8 ${viewMode === "flat" ? "share-flat" : ""}`}
                            style={{ gap: BLOCK_GAP }}
                          >
                            {pageUnits[pi].map((unit, i) => (
                              <div key={i} style={{ overflow: "hidden" }}>
                                {renderUnit(unit)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {/* 隐藏的测量容器：跟预览同样的宽度/字体/间距，测出每块高度用于切页 */}
        <div
          ref={measureRef}
          aria-hidden
          className="fixed -left-[9999px] top-0"
          style={{ width: PAGE_WIDTH - PAGE_PADDING * 2, fontFamily: FONT }}
        >
          <div
            className={`flex flex-col ${viewMode === "flat" ? "share-flat" : ""}`}
            style={{ gap: BLOCK_GAP }}
          >
            {parts.map((part, i) => (
              <div key={i} style={{ overflow: "hidden" }}>
                {renderPart(part)}
              </div>
            ))}
          </div>
        </div>

        <footer className="flex gap-2 border-t border-zinc-100 px-4 py-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            onClick={download}
            disabled={busy || pages.length === 0}
            className="flex-1 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {busy ? "生成中…" : pages.length > 1 ? `下载 ${pages.length} 张` : "下载图片"}
          </button>
        </footer>
      </div>
    </div>
  );
}
