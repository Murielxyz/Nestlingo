"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Link2, Loader2, Save, RefreshCw, ListVideo, FolderPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseMediaUrl, parseYoutubePlaylist } from "@/lib/media";
import { detectLang, LANG_ORDER, LANG_LABEL, type Lang } from "@/lib/lang-detect";
import { MATERIAL_TYPE_LABEL } from "@/lib/types";
import { YTDLP_DISABLED } from "@/lib/feature-flags";
import type { MaterialCollection, MaterialType } from "@/lib/types";

type Meta = {
  kind: string;
  title: string;
  source: string;
  thumbnail: string | null;
  embedUrl: string | null;
  /** 解析出的音频直链（单集播客 / 音频文件）：保存时用它当素材地址，直接当单集导入。 */
  audioUrl: string | null;
  lang: string;
};

type PlaylistData = {
  title: string;
  episodes: { url: string; title: string; thumbnail: string | null }[];
  count: number;
  truncated: boolean;
};

const TYPE_ORDER: MaterialType[] = ["youtube", "audio", "spotify", "link", "podcast"];

/**
 * 素材去重的「稳定键」：同一个视频 / 音频 / 单集 / 栏目，不管怎么贴网址都归到同一个串，
 * 存档也用它当 url，这样重复收藏会撞库、不会多出一条。
 * - 单集播客 / 音频直链：用解析出的音频直链（同集同 mp3）。
 * - YouTube：抽成唯一 videoId 的 watch 链。
 * - Spotify：去掉 query/追踪参数，只留 origin+path（track/playlist id 在 path）。
 * - 其它文章 / 链接：原样 trim。
 */
function dedupKey(rawUrl: string, meta: Meta): string {
  if (meta.audioUrl) return meta.audioUrl;
  const parsed = parseMediaUrl(rawUrl);
  if (parsed?.kind === "youtube" && parsed.embedUrl) {
    return parsed.embedUrl.replace("youtube.com/embed/", "youtube.com/watch?v=");
  }
  if (parsed?.kind === "spotify") {
    try {
      const u = new URL(rawUrl);
      return u.origin + u.pathname;
    } catch {
      return rawUrl.trim();
    }
  }
  return rawUrl.trim();
}

/** 收藏素材面板：贴链接 → 服务端抓元数据 → 可改标题/来源/类型/语言 → 保存到指定合集（不选就存成单条）。
 *  - 单条素材可不归合集（素材库主页单条与合集并列展示）。
 *  - YouTube 合辑走单独流程：列出每集可勾选，导入所选为每集一条素材，归进同名合集。 */
export function AddMaterialPanel({
  collections,
  defaultCollectionId,
  onClose,
}: {
  collections: MaterialCollection[];
  defaultCollectionId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pl, setPl] = useState<PlaylistData | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [type, setType] = useState<MaterialType>("link");
  const [lang, setLang] = useState<Lang>("other");
  // 导入合辑时统一的语言：auto=逐集按标题自动判断，选定后整批都用这一种。
  const [plLang, setPlLang] = useState<Lang | "auto">("auto");
  const [collectionId, setCollectionId] = useState(defaultCollectionId ?? "");
  const [newColName, setNewColName] = useState(""); // 单条保存时内联新建合集
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 重复收藏的提示（不是错误，用琥珀色区分）；有它就不落库。
  const [notice, setNotice] = useState<string | null>(null);

  // 新解析出合辑时，默认全选每集。
  useEffect(() => {
    if (pl) setSelected(new Set(pl.episodes.map((e) => e.url)));
  }, [pl]);

  async function resolve() {
    const u = url.trim();
    if (!u) {
      setFetchError("先粘贴链接。");
      return;
    }
    setFetching(true);
    setFetchError(null);
    setMeta(null);
    setPl(null);
    setSaveError(null);
    setNotice(null);

    // 只有「纯合辑链接」才走单独的合辑端点；watch?v=..&list=.. 这种带合辑上下文的单集
    // 按单视频处理（否则会把用户随手贴的一条视频一锅端成整个播放列表）。
    if (parseYoutubePlaylist(u) && !parseMediaUrl(u)) {
      if (YTDLP_DISABLED) {
        setFetchError("此功能暂未启用");
        setFetching(false);
        return;
      }
      try {
        const res = await fetch("/api/materials/playlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: u }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "解析失败");
        setPl(data);
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : String(e));
      } finally {
        setFetching(false);
      }
      return;
    }

    // 普通素材走元数据端点。
    try {
      const res = await fetch("/api/materials/meta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "解析失败");
      setMeta(data);
      setTitle(data.title ?? "");
      setSource(data.source ?? "");
      setType((data.kind as MaterialType) ?? "link");
      setLang((data.lang as Lang) ?? "other");
      setCollectionId(defaultCollectionId ?? "");
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  }

  /** 单条保存：可归入一个合集，或存为单条。 */
  async function save() {
    const u = url.trim();
    if (!u) {
      setSaveError("链接不能为空。");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    const supabase = createClient();

    // 去重：库里有同一条（稳定键撞库）→ 提示并停止，不新增；也不为它新建合集。
    const key = dedupKey(u, meta!);
    const { data: existing } = await supabase
      .from("materials")
      .select("id,title")
      .eq("url", key)
      .maybeSingle();
    if (existing) {
      setNotice(`已收藏过「${existing.title}」。`);
      setSaving(false);
      return;
    }

    // 指定了合集就用它；否则内联输入就新建一个；都没有就存成单条。
    let cid = collectionId;
    if (!cid && newColName.trim()) {
      const { data, error } = await supabase
        .from("material_collections")
        .insert({ name: newColName.trim() })
        .select("id")
        .single();
      if (error || !data) {
        setSaveError(error?.message ?? "创建合集失败");
        setSaving(false);
        return;
      }
      cid = data.id;
    }

    const { error } = await supabase.from("materials").insert({
      url: key,
      type,
      title: title.trim() || u,
      source: source.trim() || null,
      thumbnail: meta?.thumbnail ?? null,
      lang,
      collection_id: cid || null,
      status: "pending",
    });
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    router.refresh();
    onClose();
  }

  /** 导入合辑所选集：每集一条素材，归进同名素材合集（没有就自动建，或指定了合集就用指定）。 */
  async function importPlaylist() {
    if (!pl) return;
    const chosen = pl.episodes.filter((e) => selected.has(e.url));
    if (chosen.length === 0) {
      setSaveError("请先勾选要导入的集数。");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();

    let cid: string;
    if (defaultCollectionId) {
      cid = defaultCollectionId;
    } else {
      const { data: exist } = await supabase
        .from("material_collections")
        .select("id")
        .eq("name", pl.title)
        .limit(1);
      const existId = (exist?.[0]?.id as string | undefined) ?? null;
      if (existId) {
        cid = existId;
      } else {
        const { data, error } = await supabase
          .from("material_collections")
          .insert({ name: pl.title, lang: plLang === "auto" ? null : plLang, type: "youtube" })
          .select("id")
          .single();
        if (error || !data) {
          setSaveError(error?.message ?? "创建合集失败");
          setSaving(false);
          return;
        }
        cid = data.id;
      }
    }

    // 跳过已收录的集（重复导入不产生重复素材）。
    const urls = chosen.map((e) => e.url);
    const { data: existingRows } = await supabase.from("materials").select("url").in("url", urls);
    const have = new Set((existingRows ?? []).map((r) => r.url));
    const fresh = chosen.filter((e) => !have.has(e.url));

    if (fresh.length > 0) {
      const { error } = await supabase.from("materials").insert(
        fresh.map((e) => ({
          url: e.url,
          type: "youtube" as const,
          title: e.title,
          thumbnail: e.thumbnail,
          source: pl.title,
          lang: plLang === "auto" ? detectLang(e.title) : plLang,
          collection_id: cid,
          status: "pending",
        }))
      );
      if (error) {
        setSaveError(error.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    router.refresh();
    onClose();
  }

  function toggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleAll() {
    if (!pl) return;
    if (selected.size === pl.episodes.length) setSelected(new Set());
    else setSelected(new Set(pl.episodes.map((e) => e.url)));
  }

  const input =
    "w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">收藏素材</h3>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            // 链接一被改动，之前的解析结果就失效：清掉，必须重新「解析」才能保存 / 导入。
            // 否则会用旧 meta（含旧 audioUrl）去保存，导致新链接被丢弃。
            setMeta(null);
            setPl(null);
            setFetchError(null);
            setSaveError(null);
            setNotice(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") resolve();
          }}
          placeholder="贴一个链接：YouTube 视频 / 合辑 / 音频 / 播客 / 文章…"
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
        />
        <button
          onClick={resolve}
          disabled={fetching || saving}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
        >
          {fetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : meta || pl ? (
            <RefreshCw className="h-4 w-4" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
          {fetching ? "解析中…" : meta || pl ? "重新解析" : "解析"}
        </button>
      </div>

      {fetchError && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {fetchError}
        </p>
      )}

      {/* ===== 合辑：勾选每集 + 导入所选 ===== */}
      {pl && (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-2">
            <ListVideo className="h-4 w-4 text-teal-600" />
            <p className="text-sm font-medium text-zinc-800">{pl.title}</p>
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
              共 {pl.count} 集
            </span>
            {pl.truncated && <span className="text-xs text-zinc-400">（只取前 {pl.count} 集）</span>}
          </div>
          {/* 统一语言：不选则整批都已按内容自动判断；选定则整批用这一种，避免同一合集语言混杂。 */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">语言</span>
            <select
              value={plLang}
              onChange={(e) => setPlLang(e.target.value as Lang | "auto")}
              className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-600 focus:border-teal-500 focus:outline-none"
            >
              <option value="auto">按内容自动判断</option>
              {LANG_ORDER.map((l) => (
                <option key={l} value={l}>
                  {LANG_LABEL[l]}
                </option>
              ))}
            </select>
            {plLang !== "auto" && (
              <span className="text-xs text-zinc-500">导入的每集都用这个语言</span>
            )}
          </div>
          <div className="mb-2 flex items-center gap-2 text-xs">
            <button
              onClick={toggleAll}
              className="rounded-md px-2 py-1 font-medium text-teal-600 hover:bg-teal-50"
            >
              {selected.size === pl.episodes.length ? "全不选" : "全选"}
            </button>
            <button
              onClick={() => setSelected(new Set(pl.episodes.map((e) => e.url)))}
              className="rounded-md px-2 py-1 font-medium text-zinc-500 hover:bg-zinc-50"
            >
              清空
            </button>
          </div>
          <p className="mb-2 text-xs text-zinc-500">
            导入所选的每集为一条素材，归进合集（{defaultCollectionId ? "当前合集" : `同名合集「${pl.title}」`}）；已收录的集自动跳过。
          </p>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-100 p-1">
            {pl.episodes.map((e) => (
              <label
                key={e.url}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(e.url)}
                  onChange={() => toggle(e.url)}
                  className="h-4 w-4 shrink-0 accent-teal-600"
                />
                {e.thumbnail ? (
                  <img src={e.thumbnail} alt="" className="h-7 w-11 shrink-0 rounded object-cover" loading="lazy" />
                ) : (
                  <span className="h-7 w-11 shrink-0 rounded bg-zinc-100" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-700" title={e.title}>
                  {e.title}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ===== 普通素材：可编辑元数据 ===== */}
      {meta && !pl && (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          {meta.thumbnail ? (
            <img
              src={meta.thumbnail}
              alt=""
              className="h-24 w-36 shrink-0 rounded-lg object-cover"
              loading="lazy"
            />
          ) : null}
          <div className="min-w-0 flex-1 space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="标题"
              className={input}
            />
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="来源（频道 / 作者 / 站名）"
              className={input}
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as MaterialType)}
                className="w-auto flex-none rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {MATERIAL_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
                className="w-auto flex-none rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              >
                {LANG_ORDER.map((l) => (
                  <option key={l} value={l}>
                    {LANG_LABEL[l]}
                  </option>
                ))}
              </select>
            </div>
            {/* 归入的合集 */}
            {defaultCollectionId ? (
              <p className="text-xs text-zinc-500">
                将归入合集「{collections.find((c) => c.id === defaultCollectionId)?.name}」。
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <select
                  value={collectionId}
                  onChange={(e) => setCollectionId(e.target.value)}
                  className={input}
                >
                  <option value="">不归合集（单条）</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-1.5">
                  <input
                    value={newColName}
                    onChange={(e) => setNewColName(e.target.value)}
                    placeholder="或输入新合集名，新建一个"
                    className={input}
                  />
                  <span className="inline-flex shrink-0 items-center px-1 text-zinc-300">
                    <FolderPlus className="h-4 w-4" />
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {saveError && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {saveError}
        </p>
      )}
      {notice && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {notice}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
        >
          取消
        </button>
        {pl ? (
          <button
            onClick={importPlaylist}
            disabled={saving || fetching}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListVideo className="h-4 w-4" />}
            {saving ? "导入中…" : `导入所选（${selected.size}）`}
          </button>
        ) : (
          <button
            onClick={save}
            disabled={saving || fetching || !meta}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "保存中…" : "保存"}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
