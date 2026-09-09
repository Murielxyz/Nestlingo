"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Trash2,
  ExternalLink,
  Loader2,
  FilePlus2,
  FileText,
  Play,
  ScanText,
  Rss,
  File as FileIcon,
  Music,
  Image as ImageIcon,
  Sparkles,
  Save,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseMediaUrl } from "@/lib/media";
import { LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import { MATERIAL_TYPE_LABEL } from "@/lib/types";
import type { Material, MaterialImportExtra } from "@/lib/types";
import { ImportMaterialModal } from "./import-material-modal";
import { PodcastAudioPlayer } from "./podcast-audio-player";
import { BackButton } from "./back-button";

const FILE_KIND_LABEL: Record<string, string> = {
  audio: "音频",
  image: "图片",
  doc: "文档",
};

function materialLang(m: Material): Lang {
  const l = m.lang as Lang | null | undefined;
  return l && l in LANG_LABEL ? l : "other";
}

type PodcastEpisode = { title: string; audio: string };

/** 播客：拉订阅里的单集，可点听、可选定某集导入。 */
function PodcastPlayerMaterial({
  material,
  onImportEpisode,
}: {
  material: Material;
  onImportEpisode: (ep: PodcastEpisode) => void;
}) {
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([]);
  const [count, setCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/rss", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: material.url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "加载失败");
        if (!cancelled) {
          setEpisodes(data.episodes ?? []);
          setCount(data.count ?? data.episodes?.length ?? 0);
          setTruncated(!!data.truncated);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [material.url]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载单集…
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-zinc-500">
        <Rss className="h-4 w-4 text-teal-600" />
        订阅里的单集，点「▶」即听，选中一集后「导入到笔记」内嵌那集。
        {truncated && <span className="text-xs text-zinc-400">（共 {count} 集，只列最近 {episodes.length} 集）</span>}
      </div>
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : episodes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-400">
          订阅里没有可播放的单集（可能不是播客源）。
        </div>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {episodes.map((ep, i) => (
            <li key={ep.audio + i}>
              <div
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 ${
                  active === i ? "bg-teal-50" : ""
                }`}
              >
                <button
                  onClick={() => setActive(active === i ? null : i)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
                  aria-label={active === i ? `停止 ${ep.title}` : `播放 ${ep.title}`}
                >
                  <Play className="h-3 w-3" />
                  {active === i ? "停止" : "听"}
                </button>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-700" title={ep.title}>
                  {ep.title}
                </span>
                <button
                  onClick={() => onImportEpisode(ep)}
                  className="shrink-0 rounded-md border border-teal-200 px-2 py-1.5 text-xs font-medium text-teal-600 hover:bg-teal-50"
                >
                  导入
                </button>
              </div>
              {active === i && (
                <audio controls src={ep.audio} className="w-full px-1 py-2" preload="metadata" autoPlay />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 素材观看页：在站内直接嵌入观看 / 阅读，而不是弹窗 iframe。
 * - 视频 / 音乐：iframe 内嵌播放；音频：<audio>。
 * - 播客：列出单集，可点听、可选定某集导入。
 * - 上传文件：音频/图片/文档按类型渲染。
 * - 文章：原文采集区——「自动提取正文」（失败撤按钮）或手动粘贴，正文导入时写成笔记「原文」块。
 * - AI 生成：展示生成的正文，可导入笔记精读/转卡。
 * 导入失败仍回落到「打开原文」入口。
 */
export function MaterialWatch({ material: initial }: { material: Material }) {
  const router = useRouter();
  // 允许导入到笔记后用新数据刷新状态（同页不重新挂载）。
  const [material] = useState(initial);
  const [importOpen, setImportOpen] = useState(false);
  const [importExtra, setImportExtra] = useState<MaterialImportExtra | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 「提取正文」状态。文章正文放在 articleText（用户粘贴或自动提取的产物），成功提取时持久化进 materials.content。
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractFailed, setExtractFailed] = useState(false);
  const [articleText, setArticleText] = useState(initial.content ?? "");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const parsed = parseMediaUrl(material.url);
  const embed = parsed?.embedUrl ?? null;
  const embedKind = parsed?.kind ?? null;
  const lang = materialLang(material);
  const importedNote = material.status === "imported" ? material.note_id : null;

  async function del() {
    if (!window.confirm(`删除素材「${material.title || material.url}」？`)) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("materials").delete().eq("id", material.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/materials");
    router.refresh();
  }

  async function extract() {
    setExtractBusy(true);
    setExtractFailed(false);
    try {
      const res = await fetch("/api/materials/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: material.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "提取失败");
      // 成功：填进正文区并持久化（刷新/重进不丢），下次直接展示。
      const text = data.text ?? "";
      setArticleText(text);
      const supabase = createClient();
      await supabase.from("materials").update({ content: text }).eq("id", material.id);
    } catch {
      // 失败：撤掉「自动提取」按钮（只留粘贴盒），显示一次友好说明。
      setExtractFailed(true);
    } finally {
      setExtractBusy(false);
    }
  }

  // 正文文本框可直接改（删减/新增）。改动静默写回 materials.content（debounce），离开再回来不丢。
  const articleTextRef = useRef(articleText);
  articleTextRef.current = articleText;
  const contentSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleContentSave() {
    if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);
    contentSaveTimerRef.current = setTimeout(() => {
      void createClient()
        .from("materials")
        .update({ content: articleTextRef.current })
        .eq("id", material.id);
    }, 800);
  }

  // 手动「保存」：立即写回正文（不等 debounce），给用户明确的保存反馈。
  async function saveContent() {
    setSaveBusy(true);
    setSaved(false);
    const { error } = await createClient()
      .from("materials")
      .update({ content: articleTextRef.current })
      .eq("id", material.id);
    setSaveBusy(false);
    if (error) {
      setError(error.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    }
  }

  // 离开页面若 debounce 还没触发，尽力存一次当前正文，避免修改丢失。
  useEffect(() => {
    const saved = initial.content ?? "";
    return () => {
      if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);
      if (articleTextRef.current !== saved) {
        void createClient().from("materials").update({ content: articleTextRef.current }).eq("id", material.id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openImport(extra?: MaterialImportExtra) {
    setImportExtra(extra);
    setImportOpen(true);
  }

  return (
    <div>
      {/* 顶栏：返回（回到刚进来的那个列表）+ 标题 + 状态 */}
      <header className="page-header mb-4">
        <BackButton
          fallback="/companion/favorites"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-800"
        >
          <ArrowLeft className="h-4 w-4" />
          收藏夹
        </BackButton>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-zinc-900" title={material.title}>
              {material.title || material.url}
            </h1>
            {material.source && <p className="mt-0.5 text-sm text-zinc-400">{material.source}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${LANG_COLOR[lang]}`}>
              {LANG_LABEL[lang]}
            </span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
              {MATERIAL_TYPE_LABEL[material.type]}
            </span>
            {importedNote && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                已导入
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 打开原始页：视频 / 播客 / 音频，右对齐放在观看区上方（不放内容框内，避免顶部出现白色留白）。 */}
      {(material.type === "youtube" || material.type === "podcast" || material.type === "audio") && (
        <div className="mb-1 flex justify-end">
          <a
            href={material.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-teal-600"
            title="在新标签打开原始页面"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {material.type === "youtube" ? "打开原始链接" : "打开音频"}
          </a>
        </div>
      )}

      {/* 观看区：按类型分支 */}
      {material.type === "link" ? (
        <div className="mb-4">
          {extractFailed ? (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              此页无法自动提取正文（可能要登录 / 付费 / 动态渲染）。请直接把正文粘贴到下面的文本框再导入。
            </div>
          ) : (
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                onClick={extract}
                disabled={extractBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 px-3 py-2.5 text-sm font-medium text-teal-600 transition-colors hover:bg-teal-50 disabled:opacity-50"
              >
                {extractBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
                {extractBusy ? "提取中…" : articleText.trim() ? "重新提取正文" : "自动提取正文"}
              </button>
              <a
                href={material.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-teal-600"
                title="在新标签打开原始页面"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                打开原文
              </a>
            </div>
          )}
          <textarea
            value={articleText}
            onChange={(e) => {
              setArticleText(e.target.value);
              scheduleContentSave();
            }}
            placeholder="把正文贴到这里（或点「自动提取正文」）。导入时这段会被写成笔记的「原文」块，供 AI 精读 / 转卡用。"
            rows={18}
            className="w-full min-h-[55vh] rounded-lg border border-zinc-200 px-3 py-2.5 text-sm leading-6 text-zinc-800 focus:border-teal-500 focus:outline-none placeholder:text-sm"
          />
        </div>
      ) : (
        <div className="mb-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {material.type === "generated" ? (
            <div className="p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-teal-700">
                <Sparkles className="h-4 w-4" /> AI 生成的素材
              </div>
              <div className="whitespace-pre-wrap text-sm leading-6 text-zinc-800">
                {material.content || "（空）"}
              </div>
            </div>
          ) : material.type === "file" ? (
            <FileMaterial material={material} />
          ) : material.type === "podcast" ? (
            <PodcastPlayerMaterial material={material} onImportEpisode={(ep) => openImport({ audioUrl: ep.audio, audioTitle: ep.title })} />
          ) : (
            <div className="bg-black">
              {embedKind === "audio" && embed ? (
                <PodcastAudioPlayer
                  src={embed}
                  title={material.title}
                  subtitle={material.source}
                  cover={material.thumbnail}
                />
              ) : embed ? (
                <div className="aspect-video w-full">
                  <iframe
                    src={embed}
                    className="h-full w-full"
                    title={material.title || "素材"}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div className="aspect-video w-full">
                  <iframe
                    src={material.url}
                    className="h-full w-full"
                    title={material.title || "素材"}
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 操作区 */}
      <div className="flex flex-wrap items-center gap-2">
        {importedNote ? (
          <Link
            href={`/notes/${importedNote}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            <FileText className="h-4 w-4" />
            查看笔记
          </Link>
        ) : material.type === "link" ? (
          <button
            onClick={() => openImport({ articleText: articleText.trim() || undefined, title: material.title })}
            disabled={!articleText.trim()}
            title={articleText.trim() ? "把「原文」导入笔记（可再 AI 精读 / 转卡）" : "先点上方「原文采集」粘贴正文或自动提取，再导入"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FilePlus2 className="h-4 w-4" />
            导入到笔记
          </button>
        ) : (
          <button
            onClick={() => openImport()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            <FilePlus2 className="h-4 w-4" />
            导入到笔记
          </button>
        )}
        {material.type === "link" && (
          <>
            {saved && <span className="text-xs font-medium text-emerald-600">已保存</span>}
            <button
              onClick={saveContent}
              disabled={saveBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60"
            >
              {saveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存
            </button>
          </>
        )}
        <button
          onClick={del}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          删除
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {importOpen && (
        <ImportMaterialModal
          material={material}
          extra={importExtra}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

/** 上传文件素材：音频 → 播放器；图片 → 图示；文档 → 下载/在线预览（不内嵌播放器）。 */
function FileMaterial({ material }: { material: Material }) {
  const kind = material.file_kind ?? "doc";
  const kindLabel = FILE_KIND_LABEL[kind] ?? "文件";

  return (
    <div className="p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-teal-700">
        {kind === "audio" ? (
          <Music className="h-4 w-4" />
        ) : kind === "image" ? (
          <ImageIcon className="h-4 w-4" />
        ) : (
          <FileIcon className="h-4 w-4" />
        )}
        {kindLabel} · {material.title || "文件"}
      </div>

      {kind === "audio" ? (
        <PodcastAudioPlayer
          src={material.url}
          title={material.title || material.url}
          subtitle={`${kindLabel} · 文件素材`}
          cover={material.thumbnail}
        />
      ) : kind === "image" ? (
        <img
          src={material.url}
          alt={material.title}
          className="mx-auto max-h-[60vh] rounded-lg object-contain"
          loading="lazy"
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-500">
            这是一个文档文件，可下载后用对应软件打开阅读；若想提炼内容，可先转成文字稿。
          </p>
          <a
            href={material.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            <ExternalLink className="h-4 w-4" />
            下载 / 打开文件
          </a>
        </div>
      )}
    </div>
  );
}
