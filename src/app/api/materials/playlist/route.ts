// POST /api/materials/playlist —— 解析 YouTube 合辑链接，返回合辑标题 + 每集列表。
// 素材库「一键导入合辑」用。用 yt-dlp 的 --flat-playlist 只取合辑元数据与每集 id/标题
// （不下载视频），再拼每集观看地址与缩略图。出网走 execFile + 代理（照 /api/ai/transcribe）；
// 不返回任何密钥，代码在服务端跑。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseYoutubePlaylist } from "@/lib/media";
import { YTDLP_DISABLED } from "@/lib/feature-flags";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

// YouTube 视频 id 固定 11 位（合辑里可能混入非视频项，过滤用）。
const YT_ID_RE = /^[\w-]{11}$/;

/** 最多收录的集数上限：合辑过大时只取前 N 集，避免一次塞太多素材。 */
const MAX_EPISODES = 300;

type Episode = {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
};

/** 读代理地址（与 server-fetch / /api/ai/transcribe 一致）。 */
function proxyUrl(): string | undefined {
  const p = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  return p?.trim() || undefined;
}

/** 用 yt-dlp --flat-playlist 拉合辑标题 + 每集，解析成结构化列表。失败抛中文错误。 */
async function fetchPlaylist(url: string): Promise<{ title: string; episodes: Episode[] }> {
  const args = [
    "-m", "yt_dlp",
    "--flat-playlist",
    "--dump-single-json", // 整个合辑输出成一份 JSON（含 entries），供解析
    "--no-warnings",
  ];
  const proxy = proxyUrl();
  if (proxy) args.push("--proxy", proxy);
  args.push(url);

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("python3", args, { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }));
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err);
    const blocked = /bot|sign in|precondition|challenge|proxy|connect|timed out|failed|SSL|EOF|violation/i.test(stderr);
    throw new Error(
      blocked
        ? "被 YouTube 拦截了——请确认本机 Chrome 已登录 YouTube、.env.local 里 HTTPS_PROXY 已配置，然后重启 dev 再试。"
        : "没能解析这个合辑——链接可能不是公开的播放列表，或已失效。"
    );
  }

  let data: { title?: string; entries?: unknown[] };
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("解析合辑数据失败。");
  }

  const rawTitle = (data.title ?? "").trim();
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const episodes: Episode[] = [];
  for (const e of entries) {
    if (episodes.length >= MAX_EPISODES) break;
    if (!e || typeof e !== "object") continue;
    const it = e as { id?: string; title?: string };
    const id = it.id ?? "";
    if (!YT_ID_RE.test(id)) continue; // 跳过嵌套合辑 / 非视频项
    episodes.push({
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: (it.title ?? "").trim() || `视频 ${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/default.jpg`,
    });
  }

  if (episodes.length === 0) {
    throw new Error("合辑里没有找到可收录的视频。");
  }

  return { title: rawTitle || "YouTube 合辑", episodes };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  if (YTDLP_DISABLED) {
    return NextResponse.json({ error: "此功能暂未启用" }, { status: 503 });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const raw = (body.url ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "没有链接" }, { status: 400 });
  }

  let url: string;
  try {
    url = new URL(raw).href;
  } catch {
    return NextResponse.json({ error: "这个链接不合法。" }, { status: 400 });
  }

  const pl = parseYoutubePlaylist(url);
  if (!pl) {
    return NextResponse.json({ error: "这个链接不是 YouTube 合辑。" }, { status: 400 });
  }

  try {
    const { title, episodes } = await fetchPlaylist(pl.url);
    return NextResponse.json({
      title,
      episodes,
      count: episodes.length,
      truncated: episodes.length >= MAX_EPISODES,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
