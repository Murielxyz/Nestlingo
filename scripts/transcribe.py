#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语巢 · 本地转录工具（把视频 / 播客链接转成纯文字稿）

用法：
  python3 scripts/transcribe.py "https://www.youtube.com/watch?v=..."
  python3 scripts/transcribe.py "https://.../episode.mp3" --out 文字稿.txt

它会：
  1) 优先抓现成字幕（最快、零成本）；
  2) 没有字幕就抽音频 → 转码压小 → 超过 25MB 自动切片 → 用 OpenAI Whisper 逐段转文字；
  3) 把完整文字稿打印出来 + 存成 .txt（macOS 还会顺手复制到剪贴板，直接 ⌘V 贴进笔记）。

依赖（一次性安装）：
  brew install ffmpeg
  pip3 install yt-dlp requests
  （OPENAI_API_KEY 已存在项目 .env.local，脚本会自动读取，绝不打印）

转好的文字稿贴到笔记里「视频节点正下方」，再点那个视频上的「AI 精读」即可。
"""

import argparse
import glob
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

try:
    import requests
except ImportError:
    requests = None

try:
    import yt_dlp
except ImportError:
    yt_dlp = None

MAX_CHUNK_MB = 24  # Whisper 单文件硬限制 25MB，留 1MB 余量
WHISPER_MODEL = "whisper-1"


def require_bin(cmd, hint):
    if shutil.which(cmd) is None:
        print(f"❌ 缺少命令 {cmd}，请先安装：{hint}")
        sys.exit(1)


def check_deps():
    if yt_dlp is None:
        print("❌ 缺少 Python 包 yt-dlp，请先安装：pip3 install yt-dlp")
        sys.exit(1)
    if requests is None:
        print("❌ 缺少 Python 包 requests，请先安装：pip3 install requests")
        sys.exit(1)
    require_bin("ffmpeg", "brew install ffmpeg")
    require_bin("ffprobe", "brew install ffmpeg")


def load_api_key():
    """从项目根目录 .env.local 读 OPENAI_API_KEY，不打印它的值。"""
    candidates = [
        pathlib.Path(".env.local"),
        pathlib.Path(__file__).resolve().parent.parent / ".env.local",
    ]
    for p in candidates:
        if p.exists():
            for line in p.read_text().splitlines():
                if line.startswith("OPENAI_API_KEY="):
                    v = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if v:
                        return v
    return os.environ.get("OPENAI_API_KEY", "")


def vtt_to_text(raw):
    """把 WebVTT / SRT 字幕原文，扒成一行干净文字。"""
    out = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        up = line.upper()
        if up.startswith(("WEBVTT", "NOTE", "KIND:", "LANGUAGE:", "STYLE")):
            continue
        if "-->" in line:  # 时间戳行，如 00:00:01.000 --> 00:00:03.000
            continue
        if re.match(r"^\d+$", line):  # SRT 的序号行
            continue
        line = re.sub(r"<[^>]+>", "", line)  # 去掉 <c>、<00:00:00.000> 等标签
        line = line.strip()
        if line:
            out.append(line)
    return re.sub(r"\s+", " ", " ".join(out)).strip()


def fetch_sub_text(sub_url):
    r = requests.get(sub_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    return vtt_to_text(r.text)


def get_subtitle_text(url, langs):
    """优先手动字幕，其次自动字幕，按用户给的语言优先级。拿不到返回 None。"""
    opts = {"skip_download": True, "quiet": True, "no_warnings": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}

    for src in (manual, auto):
        for lang in langs:
            entries = src.get(lang) or src.get(lang.split("-")[0]) or []
            for e in entries:
                ext = (e.get("ext") or "").lower()
                if ext in ("json3", "ttml"):  # 跳过不好解析的格式
                    continue
                sub_url = e.get("url")
                if not sub_url:
                    continue
                text = fetch_sub_text(sub_url)
                if text:
                    return text
    return None


def download_audio(url, tmpdir):
    """用 yt-dlp 抽音频轨（视频或音频直链都行），返回下载到的文件路径。"""
    outtmpl = os.path.join(tmpdir, "raw_audio.%(ext)s")
    opts = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.extract_info(url, download=True)
    matches = glob.glob(os.path.join(tmpdir, "raw_audio.*"))
    if not matches:
        raise RuntimeError("音频下载失败，没找到输出文件")
    return matches[0]


def reencode(src, tmpdir):
    """转成 16kHz 单声道 32kbps mp3：语音够用，且几乎都在 25MB 以内。"""
    dst = os.path.join(tmpdir, "audio.mp3")
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "16000", "-b:a", "32k", dst],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f"音频转码失败：{r.stderr[-300:]}")
    return dst


def probe_duration(path):
    r = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True,
        text=True,
    )
    try:
        return float(r.stdout.strip())
    except (ValueError, AttributeError):
        return None


def split_audio(path):
    """超过 25MB 就按时长切成多段，返回每段路径（没超就原样返回单元素列表）。"""
    size = os.path.getsize(path)
    if size <= MAX_CHUNK_MB * 1024 * 1024:
        return [path]
    dur = probe_duration(path)
    if not dur:
        raise RuntimeError("音频超过 25MB 且读不到时长，无法切片")
    seg = dur * (MAX_CHUNK_MB * 1024 * 1024) / size * 0.9  # 留 10% 余量
    outdir = os.path.join(os.path.dirname(path), "chunks")
    os.makedirs(outdir, exist_ok=True)
    pattern = os.path.join(outdir, "chunk_%03d.mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-i", path, "-f", "segment", "-segment_time", str(seg), "-c", "copy", pattern],
        capture_output=True,
        check=True,
    )
    return sorted(glob.glob(os.path.join(outdir, "chunk_*.mp3"))) or [path]


def whisper(path, api_key):
    with open(path, "rb") as f:
        r = requests.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (os.path.basename(path), f, "audio/mpeg")},
            data={"model": WHISPER_MODEL},
            timeout=600,
        )
    if r.status_code != 200:
        raise RuntimeError(f"Whisper 转录失败（HTTP {r.status_code}）：{r.text[:300]}")
    return (r.json().get("text") or "").strip()


def finish(text, out_path):
    print()
    print("=" * 40)
    print(text)
    print("=" * 40)
    out = pathlib.Path(out_path) if out_path else pathlib.Path("transcript.txt")
    out.write_text(text, encoding="utf-8")
    print(f"\n已保存：{out}")
    if sys.platform == "darwin":
        try:
            subprocess.run(["pbcopy"], input=text.encode("utf-8"))
            print("已复制到剪贴板，直接 ⌘V 粘贴进笔记（视频节点正下方）。")
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser(description="语巢本地转录工具：视频/播客链接 → 文字稿")
    ap.add_argument("url", help="视频或音频链接")
    ap.add_argument("--lang", default="zh-Hans,zh,en,th,ko,ja", help="字幕语言优先级（逗号分隔）")
    ap.add_argument("--out", default=None, help="保存到的 .txt 路径（默认 transcript.txt）")
    args = ap.parse_args()

    check_deps()
    api_key = load_api_key()
    if not api_key:
        print("❌ 没找到 OPENAI_API_KEY（检查项目根目录 .env.local）")
        sys.exit(1)

    url = args.url.strip()
    langs = [x.strip() for x in args.lang.split(",") if x.strip()]

    with tempfile.TemporaryDirectory() as tmp:
        print("① 先试现成字幕 …")
        sub_text = None
        try:
            sub_text = get_subtitle_text(url, langs)
        except Exception as e:
            print(f"   字幕抓取跳过：{e}")
        if sub_text:
            print(f"   拿到字幕，共 {len(sub_text)} 字")
            finish(sub_text, args.out)
            return

        print("② 没字幕，抽音频 → Whisper 转录 …")
        src = download_audio(url, tmp)
        enc = reencode(src, tmp)
        chunks = split_audio(enc)
        parts = []
        for i, c in enumerate(chunks, 1):
            print(f"   Whisper 转录 {i}/{len(chunks)} …")
            parts.append(whisper(c, api_key))
        text = " ".join(p for p in parts if p).strip()
        if not text:
            print("❌ 转录结果为空")
            sys.exit(1)
        finish(text, args.out)


if __name__ == "__main__":
    main()
