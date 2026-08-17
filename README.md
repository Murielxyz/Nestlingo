# 语巢 · Nestlingo

> 记录即背诵 —— 你的语言学习工作台。

表面是一个笔记本：建文件夹、写笔记、粘贴任何内容（泰语生词、韩语课文、泰语新闻、Excel 表格）。每一篇笔记都能**一键变成闪卡**，随手记录，当场就能背。

支持泰语、韩语、英语、中文（及更多语言）。网页 + 手机响应式（PWA，可「添加到主屏幕」），云同步，免费/低成本运行。

---

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 阶段 0 | 脚手架 + 单用户登录 + 应用外壳 + PWA | ✅ 已完成 |
| 阶段 1 | 笔记核心（文件夹 / 富文本 / 粘贴识别） | ✅ 已完成 |
| 阶段 2 | 闪卡与复习（集合 / 间隔重复 SM-2 / 综合测试 / 词群） | ✅ 已完成 |
| 阶段 3 | 精读（生词/例句/语法分区转卡 / 单卡详情 / 分享图） | ✅ 已完成 |
| 阶段 4 | 媒体学习（YouTube/播客嵌入 + AI 转录 + AI 精读笔记） | ✅ 已完成 |
| 阶段 5 | 搜索 / 离线同步 / 上线加固 | ⬜ 待开发 |

完整技术方案见 [`.claude/plans/supabase-snazzy-puzzle.md`](../.claude/plans/supabase-snazzy-puzzle.md)（或由 Claude 生成的那份计划）。

---

## 一、准备工作

你只需要装一样东西：

- **Node.js 18.18 或更高**（[nodejs.org](https://nodejs.org) 下载安装，装完可在终端运行 `node -v` 验证）

本项目不需要自己装数据库 —— 数据存在 [Supabase](https://supabase.com)（免费云服务）。

---

## 二、本地运行

```bash
# 1. 进入项目目录
cd "Language Nest"

# 2. 安装依赖
npm install

# 3. 配置 Supabase（见下一节）

# 4. 启动开发服务器
npm run dev
```

浏览器打开 **http://localhost:3000** 即可看到应用。

---

## 三、配置 Supabase（登录必做）

### 1. 创建项目

1. 打开 [supabase.com](https://supabase.com)，用 GitHub/邮箱注册登录。
2. 点 **New project**，填一个项目名（如 `language-nest`），设置数据库密码（自己记好），地区选离你近的（如 Singapore / Tokyo）。
3. 等几分钟项目创建完成。

### 2. 拿到连接信息

1. 进入项目控制台，左侧 **Settings → API**。
2. 复制两样东西：
   - **Project URL**（形如 `https://xxxx.supabase.co`）
   - **anon public** 这一行的 key（形如 `eyJhbGciOi...`，很长一串）
3. 打开项目根目录的 `.env.local` 文件（没有就新建），填入：

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

4. **重启** `npm run dev`（改环境变量后要重启才生效）。

### 2.5 配置 AI 功能（可选，媒体页用）

「媒体」页可以把 YouTube 视频 / 播客音频转成文字稿，再让 AI 整理成「生词 / 例句 / 语法」精读笔记。需要两个可选的 Key：

```
ANTHROPIC_API_KEY=   # AI 精读笔记（Claude）：https://console.anthropic.com
ANTHROPIC_MODEL=claude-opus-5   # 可选，想省钱可改成 claude-haiku-4-5
OPENAI_API_KEY=      # 语音转录（Whisper）：https://platform.openai.com/api-keys
```

- **不填也没关系**：其余功能照常用，只是「媒体」页会提示这两项「未配置」。
- 语音转录只对**音频直链**（mp3/m4a/…）生效；YouTube 视频请用「显示文字稿」复制文字后粘贴。
- 填完记得重启 `npm run dev`。

### 3. 创建你的登录账号

这是单用户应用，账号在 Supabase 后台手动创建：

1. 左侧 **Authentication → Users → Add user → Create new user**。
2. 填一个邮箱 + 密码，点 Create user。
3. 回到应用，用这个邮箱密码登录。

> 提示：如果想让邮箱验证关闭（免去验证邮件），到 **Authentication → Sign In / Providers → Email**，把 **Confirm email** 关掉。后台手动创建的账号本身不需要邮件验证。

---

## 四、部署上线（可选，免费）

### 部署到 Vercel（前端）

1. 把项目推到 GitHub 仓库。
2. 打开 [vercel.com](https://vercel.com)，**Add New → Project**，导入你的仓库。
3. 框架会自动识别为 Next.js。
4. 在 **Environment Variables** 里加上同样的两个变量：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. 点 **Deploy**。

部署后拿到一个 `https://你的项目.vercel.app` 地址。

### 部署后设置 Supabase 的站点地址

1. Supabase 控制台 **Authentication → URL Configuration**。
2. **Site URL** 填你的 Vercel 地址（如 `https://你的项目.vercel.app`）。
3. **Redirect URLs** 添加 `https://你的项目.vercel.app/**`。

### 手机安装成 App

手机浏览器打开你的网址（或 Vercel 地址），用系统自带的「**添加到主屏幕**」即可像 App 一样使用。

---

## 五、成本

- **Vercel**：免费（个人项目）
- **Supabase**：免费额度（500MB 数据库 + 1GB 存储，单用户远远够用）
- **Claude API**（后续「AI 识别」功能）：按量计费，默认用最便宜的 Haiku 模型，正常使用每月几块钱

**固定成本 ≈ 0 元/月。**

---

## 六、项目结构

```
src/
├── app/                  # 页面路由（App Router）
│   ├── (app)/            # 登录后的主界面（带侧边栏）
│   │   ├── notes/        # 笔记
│   │   ├── folders/      # 文件夹
│   │   ├── review/       # 今日复习
│   │   ├── cards/        # 全部卡片
│   │   ├── groups/       # 词群（按主题归类的生词）
│   │   ├── media/        # 媒体学习（视频/播客 + AI 转录 + 精读笔记）
│   │   └── api/ai/       # AI 路由（analyze 精读 / transcribe 转录）
│   ├── login/            # 登录页
│   ├── auth/callback/    # 邮箱验证回调
│   ├── manifest.ts       # PWA 清单
│   ├── icon.svg          # 网站图标
│   ├── layout.tsx        # 根布局
│   └── globals.css       # 全局样式
├── components/           # 可复用组件（侧边栏、空状态等）
├── lib/supabase/         # Supabase 客户端（浏览器/服务端/代理）
├── proxy.ts              # 登录守卫（Next.js 16 的 middleware）
scripts/
└── generate-icons.mjs    # 生成 PWA 图标的脚本（node scripts/generate-icons.mjs）
public/
├── sw.js                 # Service Worker（离线缓存基础）
└── icons/                # 已生成的图标
```

---

## 七、常用命令

```bash
npm run dev      # 本地开发（改代码自动刷新）
npm run build    # 打包生产版本（会做类型检查）
npm run start    # 运行打包后的生产版本
npm run lint     # 代码规范检查
node scripts/generate-icons.mjs   # 重新生成 PWA 图标
```

---

## 八、技术栈速览

- **前端**：Next.js 16（App Router）+ React 19 + TypeScript + Tailwind CSS 4
- **后端/数据库**：Supabase（Postgres + 登录 + 存储 + 行级安全）
- **富文本**：TipTap（表格、分栏、高亮、Callout）
- **间隔重复**：SM-2（自实现 `src/lib/srs.ts`）
- **AI**：Claude（精读笔记）+ OpenAI Whisper（语音转录），均通过服务端路由直接调用
- **离线**：Service Worker + PWA（基础缓存）
