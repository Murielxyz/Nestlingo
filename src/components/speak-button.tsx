"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, Volume1 } from "lucide-react";
import { detectLang, speechLang, cleanForSpeech, type Lang } from "@/lib/lang-detect";
import { pickVoice } from "@/lib/speech";

/**
 * 发音按钮：用浏览器自带的 speechSynthesis（系统 TTS）读文字，自动按语言选音色。
 * 不再走 Google 翻译在线 TTS——那个免费端点（client=tw-ob）已失效且国内被墙，点了没声音。
 * iOS / Android 的音色列表（getVoices）是异步加载的，这里挂载时预热并监听 voiceschanged，
 * 保证点击时能选到对应语言音色；选不到也用该语言的默认音色读，不依赖音色列表。
 */
export function SpeakButton({
  text,
  lang,
  className,
}: {
  text: string;
  /** 卡片的语言标签；给了就按它读，否则按文字自动识别（纯汉字日语卡必须给，否则判成中文）。 */
  lang?: Lang;
  className?: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // iOS 会回收没被强引用的 SpeechSynthesisUtterance（播到一半就停），这里持住它。
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // 挂载时预热音色列表（iOS/Chrome/Android 都是异步加载）。Android 首次 getVoices 常为空、
  // voiceschanged 也未必触发，故隔几拍主动再拉几次，保证点喇叭时能选到音色；卸载时停掉发音。
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    const timers = [100, 400, 1000].map((ms) => window.setTimeout(load, ms));
    return () => {
      synth.removeEventListener("voiceschanged", load);
      timers.forEach((t) => window.clearTimeout(t));
      synth.cancel();
    };
  }, []);

  function speak(e: React.MouseEvent) {
    e.stopPropagation();
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;

    // 用卡片的语言标签优先（纯汉字日语卡只有靠标签才判得对），否则按文字自动识别。
    const l = lang ?? detectLang(text);
    // 去掉罗马读音（泰语「สวัสดี sawadee」只读泰语），再截断到 200 字。
    const cleaned = cleanForSpeech(text, l);
    const q = (cleaned || text).trim().slice(0, 200);
    if (!q) return;

    // 点击手势里现抓一次音色（Android 首次 getVoices 可能还没进 state，这里拿最新；
    // 仍为空再退回 state 里的缓存）。
    const fresh = synth.getVoices();
    const voice = pickVoice(l, fresh.length ? fresh : voices);

    const u = new SpeechSynthesisUtterance(q);
    u.lang = speechLang(l);
    if (voice) u.voice = voice;
    u.rate = 0.9;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);

    utteranceRef.current = u; // 强引用，防 iOS GC 提前回收
    setSpeaking(true);

    // Android / 桌面 Chrome：cancel 后立刻 speak 会被吞掉（无声），隔一小拍再 speak + resume。
    synth.cancel();
    window.setTimeout(() => {
      synth.speak(u);
      if (synth.paused) synth.resume();
    }, 40);
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
