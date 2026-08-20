"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, Volume1 } from "lucide-react";
import { detectLang, speechLang, cleanForSpeech, type Lang } from "@/lib/lang-detect";
import { pickVoice, isNaturalVoice } from "@/lib/speech";

/** 语言码映射成 Google TTS 的 tl 参数。 */
function googleLang(lang: Lang): string {
  switch (lang) {
    case "thai":
      return "th";
    case "korean":
      return "ko";
    case "chinese":
      return "zh-CN";
    case "japanese":
      return "ja";
    default:
      return "en";
  }
}

/**
 * 发音按钮：优先用 Google 翻译的在线语音（更自然，接近真人），
 * 网络不通 / 被墙 / 加载超时则退回浏览器自带的 speechSynthesis（机器人音，但离线可用）。
 * 自动按文字语言选语音（泰语→th、韩语→ko、中文→zh-CN）。
 */
export function SpeakButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);

  // 组件卸载时停掉所有发音，避免声音一直响。
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function stopAll() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }

  function synthSpeak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeaking(false);
      return;
    }
    const lang = detectLang(text);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(lang);
    // 挑一个更自然的本地音色（默认音色往往很机器）。
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.rate = 0.9;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }

  function speak(e: React.MouseEvent) {
    e.stopPropagation();
    if (!text.trim() || typeof window === "undefined") return;
    stopAll();

    // 去掉罗马读音（泰语「สวัสดี sawadee」只读泰语），再截断到 200 字。
    const cleaned = cleanForSpeech(text);
    const q = (cleaned || text).trim().slice(0, 200);
    const lang = detectLang(q);

    // 系统有「更接近真人」的音色（如 macOS Siri、微软/谷歌神经音）就优先用它，
    // 尤其是韩语；没有合适的音色再走 Google 在线 TTS。
    const voice = pickVoice(lang);
    if (voice && isNaturalVoice(voice)) {
      synthSpeak(q);
      return;
    }

    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${googleLang(
      lang
    )}&q=${encodeURIComponent(q)}`;

    const audio = new Audio(url);
    audioRef.current = audio;
    let settled = false;
    const fallback = () => {
      if (settled) return;
      settled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      audioRef.current = null;
      synthSpeak(cleaned || text);
    };
    // 2.5 秒内没开始播放（网络慢/被墙）就退回系统语音。
    timerRef.current = window.setTimeout(fallback, 2500);
    audio.onerror = fallback;
    audio.onplaying = () => {
      if (settled) return;
      settled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setSpeaking(true);
    };
    audio.onended = () => setSpeaking(false);
    audio.play().catch(fallback);
  }

  return (
    <button
      type="button"
      onClick={speak}
      title="发音"
      aria-label="发音"
      className={
        className ??
        "shrink-0 rounded-lg px-2 py-1 text-base leading-none text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
      }
    >
      {speaking ? (
        <Volume2 className="h-4 w-4" />
      ) : (
        <Volume1 className="h-4 w-4" />
      )}
    </button>
  );
}
