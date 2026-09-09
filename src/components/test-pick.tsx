"use client";

import Link from "next/link";
import { ListChecks, Sparkles, Shuffle } from "lucide-react";
import { BackButton } from "./back-button";

/**
 * 测试选择页：某个合集进入测试前的起点，挑一种出题方式——
 * 选择题（看词选释义）/ 完形填空（根据语境填词）/ 混合练习（两类随机交替）。
 * 每种方式都基于同一个合集，点进去是各自的会话。
 */
export function TestPick({
  noteId,
  kind,
  title,
}: {
  noteId: string | null;
  kind?: string | null;
  title?: string | null;
}) {
  const base = `/review?note=${noteId ?? "orphans"}`;
  const k = kind ? `&kind=${kind}` : "";

  const modes: {
    href: string;
    icon: React.ReactNode;
    name: string;
    desc: string;
  }[] = [
    {
      href: `${base}${k}&mode=test`,
      icon: <ListChecks className="h-5 w-5" />,
      name: "选择题",
      desc: "看词 / 句，从释义里选正确答案",
    },
    {
      href: `${base}${k}&mode=cloze`,
      icon: <Sparkles className="h-5 w-5" />,
      name: "完形填空",
      desc: "根据语境填入缺失的词",
    },
    {
      href: `${base}${k}&mode=mixed`,
      icon: <Shuffle className="h-5 w-5" />,
      name: "混合练习",
      desc: "选择题与填空题随机交替",
    },
  ];

  return (
    <div>
      <header className="page-header mb-6 flex items-center gap-3">
        <BackButton fallback="/review" />
        <h1 className="text-lg font-bold text-zinc-900">
          测试{title ? ` · ${title}` : ""}
        </h1>
      </header>
      <div className="space-y-3">
        {modes.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-4 transition-colors hover:border-teal-300 hover:shadow-sm"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
              {m.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-zinc-900">{m.name}</span>
              <span className="block text-xs text-zinc-500">{m.desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
