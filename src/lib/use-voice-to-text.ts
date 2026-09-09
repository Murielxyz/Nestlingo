"use client";

// 语音转文字的可复用 hook（语伴会话 / 需要录音的地方共用）：
// MediaRecorder 录音 → 停止 → 走 /api/ai/transcribe-audio（Whisper）→ 把识别文字交回回调。
// 录音中再点一次即停止；识别期间 busy 为 true。直播麦克风权限错误会落到 error。

import { useCallback, useRef, useState } from "react";

export function useVoiceToText(onText: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function transcribe(blob: Blob) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", blob, "audio.webm");
      const res = await fetch("/api/ai/transcribe-audio", {
        method: "POST",
        body: fd,
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "转录失败");
        return;
      }
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (text) onText(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = useCallback(async () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前环境不支持录音（需要 https 或 localhost）");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await transcribe(blob);
      };
      rec.start();
      setRecording(true);
      setError(null);
    } catch {
      setError("无法使用麦克风（请允许麦克风权限）");
    }
  }, [recording]);

  return { recording, busy, error, toggle };
}
