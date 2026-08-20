// 语音合成：挑「更接近真人」的系统音色 + 读长文本（故事朗读）。
// 现代系统的原生音色（macOS 的 Siri、Windows/Android 的微软/谷歌神经音）比
// Google 翻译 TTS 更自然，尤其是韩语。这里统一用它；设备上没有好音色时再退回在线 TTS。
import { speechLang, type Lang } from "./lang-detect";

function getVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const vs = window.speechSynthesis.getVoices();
  return vs && vs.length ? vs : [];
}

/** 是否像「真人」音色：网络/神经音色，或名字带自然/厂商关键词。 */
export function isNaturalVoice(v: SpeechSynthesisVoice): boolean {
  const n = v.name.toLowerCase();
  return (
    !v.localService ||
    /natural|neural|premium|enhanced|online|siri|google|microsoft|samsung|yuna|sunhi|in-joon|heami|yuri|sora|gong|kyoko|nanami|ting-ting|xiaoxiao/.test(
      n
    )
  );
}

/** 按语言挑一个更接近真人的系统音色；没有匹配返回 null。 */
export function pickVoice(lang: Lang): SpeechSynthesisVoice | null {
  const voices = getVoices();
  if (!voices.length) return null;
  const target = speechLang(lang).slice(0, 2).toLowerCase();
  const matches = voices.filter((v) =>
    v.lang.toLowerCase().replace("_", "-").startsWith(target)
  );
  if (!matches.length) return null;
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/natural|neural|premium|enhanced|online/.test(n)) s += 5;
    if (/siri|google|microsoft|samsung|yuna|sunhi|in-joon|heami|yuri|sora|gong|kyoko|nanami|ting-ting|xiaoxiao|xiaoyi|huihui|yaoyao/.test(n)) s += 3;
    if (!v.localService) s += 2;
    if (v.default) s += 1;
    return s;
  };
  return matches.slice().sort((a, b) => score(b) - score(a))[0];
}

/**
 * 读一段长文本（自动按句子切分，避免超长卡顿）。
 * 返回一个停止函数；环境不支持合成语音时返回 null。
 */
export function speakParagraph(
  text: string,
  lang?: Lang,
  onEnd?: () => void
): (() => void) | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const l = lang ?? "other";
  const sentences = clean
    .split(/(?<=[。．.!！?？\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const voice = pickVoice(l);
  window.speechSynthesis.cancel();
  const chunks = sentences.length ? sentences : [clean];
  chunks.forEach((s, i) => {
    const u = new SpeechSynthesisUtterance(s);
    u.lang = speechLang(l);
    if (voice) u.voice = voice;
    u.rate = 0.95;
    if (i === chunks.length - 1 && onEnd) u.onend = onEnd;
    window.speechSynthesis.speak(u);
  });
  return () => window.speechSynthesis.cancel();
}
