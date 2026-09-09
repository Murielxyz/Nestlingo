// 语伴「知识点」预览：把 AssistantPoint[] 渲染成可读的分组列表（生词/例句/语法/原文）。
// 用于语伴对话气泡里、以及收藏夹文字收藏展开时——让用户在「收藏 / 生成闪卡」前就能看到具体词汇内容，
// 而不是只有一段笼统的 AI 回答文字。

import type { AssistantPoint } from "@/lib/ai-note";

const KIND_GROUPS: { key: AssistantPoint["kind"]; label: string }[] = [
  { key: "word", label: "生词" },
  { key: "example", label: "例句" },
  { key: "grammar", label: "语法" },
  { key: "article", label: "原文" },
];

/** 主行：front：back。front 是原语言词/句（加粗），back 是中文释义/翻译。 */
function Line({ front, back }: { front: string; back: string }) {
  if (!front && !back) return null;
  return (
    <div className="text-sm leading-snug text-zinc-800">
      {front && <span className="font-medium text-zinc-900">{front}</span>}
      {front && back && <span className="text-zinc-400">：</span>}
      {back && <span className="text-zinc-600">{back}</span>}
    </div>
  );
}

/** 副行：小号标签（teal）+ 内容（灰）。label 如「例句：」「拓展：」「例：」。 */
function Sub({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="text-xs leading-snug text-zinc-500">
      <span className="text-teal-600">{label}</span>
      {text}
    </div>
  );
}

function WordPoint({ p }: { p: AssistantPoint }) {
  return (
    <div className="space-y-0.5">
      <Line front={p.front + (p.reading ? `（${p.reading}）` : "")} back={p.back} />
      <Sub label="例句：" text={p.extra} />
      <Sub label="拓展：" text={p.note ?? ""} />
    </div>
  );
}

function ExamplePoint({ p }: { p: AssistantPoint }) {
  return (
    <div className="space-y-0.5">
      <Line front={p.front} back={p.back} />
      <Sub label="拓展：" text={p.extra} />
    </div>
  );
}

function GrammarPoint({ p }: { p: AssistantPoint }) {
  return (
    <div className="space-y-0.5">
      <Line front={p.front} back={p.back} />
      {(p.conjugations ?? []).map((c, i) => (
        <div key={i} className="text-xs leading-snug text-zinc-500">
          接续：{c.rule}
          {c.example ? `（${c.example}）` : ""}
        </div>
      ))}
      <Sub label="例：" text={p.extra} />
    </div>
  );
}

function ArticlePoint({ p }: { p: AssistantPoint }) {
  const fronts = p.front.split(/\n+/).filter(Boolean);
  const backs = p.back.split(/\n+/).map((s) => s.trim());
  return (
    <div className="space-y-0.5">
      {fronts.map((line, i) => (
        <div key={`f${i}`} className="text-sm leading-snug text-zinc-800">
          {line}
        </div>
      ))}
      {backs.map((line, i) =>
        line ? (
          <div key={`b${i}`} className="text-xs leading-snug text-zinc-500">
            {line}
          </div>
        ) : null
      )}
    </div>
  );
}

function PointBlock({ p }: { p: AssistantPoint }) {
  if (p.kind === "word") return <WordPoint p={p} />;
  if (p.kind === "example") return <ExamplePoint p={p} />;
  if (p.kind === "grammar") return <GrammarPoint p={p} />;
  return <ArticlePoint p={p} />;
}

/** 语伴知识点预览：按 生词/例句/语法/原文 分组，逐条列出 front/back/extra/note。 */
export function PointsPreview({ points }: { points?: AssistantPoint[] | null }) {
  if (!points || points.length === 0) return null;
  return (
    <div className="space-y-2">
      {KIND_GROUPS.map(({ key, label }) => {
        const list = points.filter((p) => p.kind === key);
        if (list.length === 0) return null;
        return (
          <div key={key}>
            <p className="mb-1 text-[11px] font-semibold text-teal-600">{label}</p>
            <ul className="space-y-1.5">
              {list.map((p, idx) => (
                <li key={idx}>
                  <PointBlock p={p} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
