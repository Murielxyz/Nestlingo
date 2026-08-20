# 语巢 · 更新与决策记录

> **用途**：记录所有已敲定的更新 / 调整，以及「进行中、待办、待确认」的事项。
> **约定**：每完成或敲定一处改动，就在这里追加 / 更新一条；开工前先读这里找回上下文，确保中断的任务能接上。

## 关键偏好（长期有效）
- 干净清爽、简单为主；进阶功能做成可选入口，不塞进主流程。
- 商定方案做好记录、防止丢失；改动前先说方案。
- `.env.local` 里的 key 值（ANTHROPIC / OPENAI / DEEPSEEK）绝不打印。

---

## 进行中 / 暂停
- 2026-08-21 闪卡页合并词群已完成，暂无进行中的改动；下一步可选「词场升级」（待办第 4 条），待确认见下方。

## 已完成（时间倒序）
- 2026-08-21 **视觉打磨：callout 调淡 + 分享成图「笔记样式」+ 日语精读片假名上标平假名**：① callout 配色再调淡一档（生词/例句/语法背景、描边降到 -100 级，标签色从 -500 降到 -400，`callout-extension.ts` 的 `KIND_META` 同步改淡）；② 分享成图新增「视图」切换——「笔记样式」（默认）按笔记内页渲染：生词蓝框/例句绿框/语法紫框整块保留，「按条切页」保留原来的逐条分页（`share-modal.tsx` + `globals.css` 的 `.share-content .callout[data-kind]`）；③ 新增 `kana.ts`（片假名→平假名确定性映射，不用 AI）+ `furigana-mark.ts`（`<ruby>` mark），`ai-note.ts` 精读原文在片假名上方标平假名（平假名/汉字不动、长音「ー」保留），`docToText` 只取正文不影响转卡。⚠️ 旧笔记要重新「AI 精读」才有 furigana。
- 2026-08-21 **闪卡页合并「词群」（按来源 / 按主题切换）+ 词群批量操作去红统一**：把原来独立的「词群」页并入「闪卡」页，`cards/page.tsx` 顶部加「按来源 / 按主题」分段切换（用 `searchParams.view` 查询参数驱动，`/cards?view=theme` 直达主题视图、可退回/可分享）。「按来源」= 原 `CardsView`（按来源笔记分组，含生词/例句/语法），「按主题」= 原 `GroupBrowser`（只归类生词 `kind='word'` 到场景主题）。`/groups` 页改成 `redirect("/cards?view=theme")`（旧链接不 404），词群详情页 `/groups/[key]` 保留；`app-shell` 删「词群」导航项；`theme-detail` / `review` / `cards/[id]` 的返回链接统一改指 `/cards?view=theme`。**词群批量操作去红**：批量栏从红底红字改成白底 + 灰边，「全选」用品牌绿、「已选 N」用灰字、「删除所选」改成细红描边按钮（不再大红实心），与全站 teal/zinc 风格统一。
- 2026-08-21 **按来源卡片来源标识 + 卡片列表语言徽章统一**：`cards-view` 每张「合集卡」现在都有来源标注——有文件夹显示文件夹名，否则「笔记添加」（普通笔记转的）/「外部添加」（独立粘贴/导入的卡片文件），与孤儿卡的「外部添加」一致（图标用 Inbox，不用 ＋，避免误以为可点击）；`note-cards` 的卡片也补上语言徽章（`detectLang` + `LANG_COLOR`），和词群详情的卡片样式对齐。**暂未做**：按来源「合集卡」批量操作（低频 + 破坏性强）、两个 tab 卡片「翻面 vs 平铺」保留差异（管理/自测 vs 浏览/移词）。
- 2026-08-19 **精读笔记：对照翻译 + 生词高亮 + 语法下划线**：`/api/ai/analyze` 新增返回 `transcriptTranslation`（原文逐段中文翻译，段数与 transcript 一一对应）和 `grammar[].phrase`（语法点在原文里的原语言短语）；`analysisToNoteContent` 把「原文」callout 改成**上下逐段对照**——每段原文下方跟一段淡灰小字中文翻译，生词用 `<mark>` 淡黄高亮（只标全篇首次出现，大小写不敏感子串匹配），语法短语用 `<u>` 下划线（也只标首现）。新增自定义 mark `translation`（`translation-mark.ts`，渲染成 `<span class="translation">`，配色在 globals.css 的 `.translation`），注册进 `editorExtensions`。例句仍只在下方列表、不在原文标注；`docToText` 忽略 mark，不影响「转成闪卡」。**注意**：旧笔记没翻译/高亮（生成时还没有这功能），要重新「AI 精读」才有。
- 2026-08-19 **字幕语言改按「原始语言轨」优先**：之前 `LANG_PREF` 把 `en` 排在 `ko/ja/th` 前面，韩语/日语/泰语视频会误抓英文翻译字幕。改为先抓各目标语言的 `-orig`（视频本身语言，每视频仅一个，如 `ko-orig`=韩语原始轨）再兜底普通轨：韩语视频出韩语、英语视频出英语。另把 `blocked` 报错判定补上 `SSL/EOF/violation`，代理偶发断连时给「网络问题」提示而非「没字幕」。
- 2026-08-19 **YouTube 字幕改走 yt-dlp + Chrome 登录态（修 bot 拦截）**：实测 `youtu.be/tB88DEBk5tw` 等**所有**视频抓不到字幕，根因不是「没字幕」，而是 YouTube 对「数据中心 IP + 无登录态」的请求直接 bot 拦截（`Sign in to confirm you're not a bot` / `Precondition check failed` 400），`youtube-transcript` 的裸 innertube 请求已全量失效。改法：`/api/ai/transcribe` 的 YouTube 分支弃用 `youtube-transcript`，改调 `python3 -m yt_dlp --cookies-from-browser chrome --skip-download --ignore-no-formats-error --write-subs --write-auto-subs --sub-format vtt` 抓字幕（含自动字幕），再按语言偏好（`-orig` 优先）读 .vtt 并用新写的 `parseVtt`（只取「整行快照」、跳过逐字滚动 `<c>` 行）拼成纯文本。**前提：本机 Chrome 登录了 YouTube**；cookie 只在本机、只用于向 YouTube 请求。依赖：本机已装 `python3` + `yt_dlp`（2026.07.04）。
- 2026-08-19 **修复转录代理失效（undici 版本不匹配）**：`serverFetch` 原先用全局 `fetch` + npm `undici` 的 `ProxyAgent`，两者是不同实例，传 `dispatcher` 报 `UND_ERR_INVALID_ARG`，导致即使配了 `HTTPS_PROXY` 也「fetch failed」、转录报「没能抓到字幕」。改为用 `undici` 自带的 `fetch`（与 `ProxyAgent` 同包配对）；Whisper 的 multipart 改用 `undici` 的 `FormData`（全局 FormData 会被 undici fetch 当普通对象序列化）。`fetchYouTubeTranscript` 报错区分「连不上 YouTube（代理没生效）」和「真没字幕」。
- 2026-08-19 **修复新建笔记报「Adding different instances of a keyed plugin」**：精读「已收录」下划线装饰插件原先用 `useEffect` + `editor.registerPlugin` 挂载，React 严格模式（开发）下会重复注册同一 `PluginKey` 的两个不同实例而崩。改成 `Extension.create({ addProseMirrorPlugins })` 塞进 `useEditor` 的 `extensions`，在编辑器创建时一次性挂上，去掉 `registerPlugin`/`unregisterPlugin` 那套。
- 2026-08-19 **修复媒体转录失败（网络代理）**：根因是 Node 服务端 `fetch` 不读 macOS 系统代理（Clash 127.0.0.1:7897），YouTube / OpenAI 直连超时导致「转录不了文字稿」（浏览器能开是因为走了系统代理）。新增 `src/lib/server-fetch.ts`（undici `ProxyAgent`，读 `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` 环境变量，没配就退回普通 fetch）；`/api/ai/transcribe`（YouTube 字幕、音频下载、Whisper）、`/api/rss`（抓订阅）、`ai-client`（Anthropic/DeepSeek）全部改走 `serverFetch`。**使用前需在 `.env.local` 加一行 `HTTPS_PROXY=http://127.0.0.1:7897`**（换成你自己的代理端口）。
- 2026-08-19 **AI 精读整理原文文稿**：`/api/ai/analyze` 新增 `transcript` 字段——让模型把原始字幕/文字稿整理成干净原文（修正错别字、删重复和口水话、去掉无关碎片、按语义分段，保留原语言、不翻译不概括）；`analysisToNoteContent` 的「原文」区块优先用整理后的原文，旧原始文字稿作兜底；`maxTokens` 提到 12000 以容纳完整整理稿。
- 2026-08-19 **精读解析去表格 + 分享图按条切页不裁切**：`analysisToNoteContent` 把生词/例句/语法从「表格」改成彩色 callout 内的逐条列表「词：释义  拓展」（语法为「语法点：说明  例：例句」），转成闪卡仍按冒号规则归入对应类型，且双空格让拓展落到背面释义的下一行（不跟释义挤一行、避免括号混淆）；`share-modal` 把 callout / 列表「摊平」成独立可切页单元（彩色标签 + 逐条），一个类型尽量放一张图、放不下自动加图，不再裁切省略。
- 2026-08-19 **修复转卡误收媒体链接与概括文字**：`parse-cards` 跳过「[媒体] 链接」占位行；`analysisToNoteContent` 把「概括 + 原文」一起放进只读「原文」区块（不再裸放概括段落），两者都不再被转成闪卡。
- 2026-08-19 **转成闪卡按类型勾选 + 侧栏续转入口**：`convert-to-cards` 顶部加「生词 / 例句 / 语法」chip（默认全选，可取消某类，只把生词入库）；闪卡侧栏加「转成闪卡」按钮，已有卡的笔记也能一键继续转（如补充例句）。
- 2026-08-19 **「原文」区块 + AI 精读 callout 化**：新增「原文」callout 类型（灰色，只读），`parse-sections` 对原文/文章区域整段跳过不转卡；`analysisToNoteContent` 把生词/例句/语法改成彩色 callout（不再是标题+表格）；「生成文字稿」「AI 精读」自动把文字稿包进原文区块，避免原文被误转成卡。工具栏新增「原文」按钮。
- 2026-08-19 **精读「拓展」列内容约束**：analyze prompt 明确「拓展」只放常见搭配 / 例句 / 相关词，不写词源或历史背景。
- 2026-08-19 **精读解释加「音标 + 词性」**：`/api/ai/explain` 返回新增 `phonetic`（英语 IPA / 韩日罗马字 / 泰语罗马化）、`partOfSpeech`（中文词性）两字段；气泡头显示 词性徽标 + 音标行；「收录到闪卡」背面第一行写「词性 · /音标/」元信息。
- 2026-08-19 **精读标记改为「只标点过解释且收录的词」**：`rich-text-editor.tsx` 去掉「载入时按 `cards.front` 回填」的逻辑，改为只在本次会话里点过「解释」并「收录到闪卡」的词才加淡下划线（不跨刷新持久化）。
- 2026-08-18 **本地转录工具** `scripts/transcribe.py`：字幕优先（yt-dlp），无字幕则抽音频 → ffmpeg 转码/切片 → OpenAI Whisper 逐段转录；输出存 txt + 复制剪贴板。
- 2026-08-18 **词群列表重排 + 词群页重构**（A）：`theme-detail.tsx` 卡片网格（两列、正反面直显、不翻面）；批量选择/删除分类在外层 `group-browser`。
- 2026-08-18 **精读「高亮即解释」+ 原形还原**（B）：选中文字浮「✨ 解释」气泡，点才调 AI；结果含「收录到闪卡」；AI 返回词典原形当正面；手动收录加「✨ 还原原形」。
- 2026-08-18 **识别规则重排 + 新增自定义规则**（C）：`SplitRule` 自定义分隔规则；原 `parseCards` 逻辑不动。
- 2026-08-18 **复习翻面空格键**（D）：`review-session.tsx` 空格翻面（输入框内不触发、不连发）。
- 2026-08-18 **媒体悬浮播放可拖拽 + 最小化**（E）：`media-embed-nodeview.tsx`。
- 2026-08-18 **媒体内嵌 Spotify**：`media.ts` 新增 spotify 解析。
- 2026-08-18 **故事模式 + 闪卡合集搜索 + 词群分类删除/隐藏**。
- 2026-08-18 **Round G**：视觉升级（sage-mint 主题）+ 媒体内嵌笔记 + 复习/设置/词群/分享打磨（git `16e1778`）。

## 待办（未做）
### 1. 语音转文字稿（无字幕视频 + 播客听声转录）
- **YouTube「无字幕 → 听声转录」回退**：有字幕（含自动字幕）已经走通（yt-dlp + Chrome 登录态）；但「下载音频 → 语音识别」这条没做。实测 `yt-dlp` 提取音频直链后，下载 googlevideo 数据会 **HTTP 403**——YouTube 现强制 JS 挑战（n-sig）验证，需装 **deno**（JS 运行时挑战求解器）+ **ffmpeg** + 接语音识别 API（DeepSeek 任务书推荐 **Deepgram**（有 $200 免费额度，首选）/ Groq / OpenAI）。⚠️ 该路依赖本地代理、受 25MB 限制、上不了 Vercel。真没字幕的极端情况暂用本地 `scripts/transcribe.py` 或手动复制。
- **Apple Podcast 单集转录**（可行，未做）：`itunes.apple.com/lookup?id=<podcastId>` 拿 `feedUrl` → 抓 RSS → 按 `?i=<episodeId>` 找该集 `<enclosure url="...mp3">` 直链 → 走现有 Whisper。已实测可行（The Daily 的 feed 里就是 direct mp3）。需扩展 `parseMediaUrl` + `/api/ai/transcribe`。
- **Spotify 单集转录：做不了**（音频被登录/API 挡，无公开 mp3 直链；内嵌播放可以、转录不行）。
- **ffmpeg 安装**（brew，供 `scripts/transcribe.py` 与后端抽音频用）。

### 2. 手机端正式使用 / 是否需要部署
- 【待决策】手机现在通过局域网 HTTP 打开，登录会**静默失败**（非 https 环境）。
- 方案 A **Vercel 部署**：CLI 已装（59.1.4）；登录未成功（vercel.com 慢、device flow 超时，`vercel whoami` 仍是 Logged out）。恢复：`vercel login` → `vercel link` → 填环境变量（`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`）→ `vercel --prod`。⚠️ 部署后**本地才能跑的转录（yt-dlp + Chrome cookie、ffmpeg、本地代理）在 Vercel 上不可用**，得重新想这些 AI 能力怎么在线上跑（或接受线上版没有转录）。
- 方案 B **本地起 https**（`next dev` 加 https 或反向代理），手机继续连本机——不部署，但手机得和电脑同一 WiFi。
- 明天先聊清「手机是外网用、还是只在同一 WiFi 用」，再定方案。

### 3. 其他
- **拍照 OCR**：选区转文字。

### 4. 词场升级（2026-08-21 决定不做，搁置）
> 用户判断：词群页只是「查看 + 轻管理」，把词移出、把单词闪卡收录进词群已经够用；掌握率 / 移到别的词群 / 一词多词群 都是锦上添花、非必需，暂不升级。以后真要再说。
- **多词群**（核心）：一张卡可属于多个词群。建议把 `cards.theme`（单字符串）升级成 `cards.themes text[]`（数组）：关键词匹配返回全部命中、AI 聚类每词给 1~2 个主题、手动移卡 = push/pop，不加新表。
- **每个词群显示掌握率**：用 `review_state`（ease/reps/lapses）聚合，纯前端、便宜。
- **手动移卡 / 加到别的词群**：词群详情页给每张卡「移到别的词群」。
- **AI 归类到自定义词群**：`cluster-cards` 现在只能归到 13 个内置主题，改成也能归到用户 `word_themes`。
- ⏸️ **地图/关系图视图**：先不做（学习价值存疑、成本高）；以后可用「相关词群」一行小字替代。

### 5. 素材库（整体搁置）
- 想法「词群 + 素材库」（口语句型/每日新闻/阅读/视频/播客收藏）暂不做：和核心学习闭环关系弱、摊子大。
- 只留一个最小切片待定：**链接收藏夹 + 语言标签 + 软件内打开 + 一键导入笔记**（复用现有媒体内嵌/转录/精读/转卡管线）。
- 明确砍掉：微信公众号抓取、每日新闻自动抓取、日语片假名自动注音（各自独立大工程）。

### 6. 视觉 / 分享 / 精读打磨（✅ 已完成 2026-08-21，见上方已完成）
- **Callout 颜色更淡**：生词/例句/语法/原文 callout 的背景、描边再调淡一档、降饱和度。
- **分享成图「默认视图」**：按笔记内页的 callout 样式生成图（生词蓝框/例句绿框/语法紫框），share-modal 加默认视图。
- **日语精读片假名上标平假名（furigana）**：精读生成的原文+例句里，连续片假名转平假名用 `<ruby>` 标在上方，平假名/汉字跳过；纯字符映射、不用 AI。⚠️ 这里只做「精读输出」范围，不是素材库那条已砍掉的「全站自动注音」。

## 待确认
1. **手机端部署方案**（见待办第 2 条）：是否部署、线上转录能力怎么办。
2. **闪卡背面自动补全**（音标/词性/解释/搭配/相关词/例句）：是否做、如何与手写内容融合——讨论中，倾向「单卡按需补全、只填空、预览确认」，不塞进「一键转成闪卡」。
3. **按来源「合集卡」是否加批量删除、两个 tab 卡片列表是否彻底统一成一种展示**（翻面 or 平铺）——暂保留现状，需要再定。
4. **一键补全缺的释义（批量补释义）**——决定不做（2026-08-21）：用户手动记录即可，已有单点「解释」功能，不想再加太多入口。以后真要再说。
