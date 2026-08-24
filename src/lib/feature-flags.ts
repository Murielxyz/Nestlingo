// 功能开关：部署到「无 yt-dlp」的环境（如 Vercel）时，在环境变量里设
// NEXT_PUBLIC_DISABLE_YTDLP=1，禁用依赖本机 yt-dlp 的三项功能：
//   - YouTube 抓字幕（含自动字幕）
//   - 无字幕视频的「听声转录」
//   - 合辑一键导入
// 这三项都靠 `python3 -m yt_dlp` + 本机 Chrome 登录态 + 临时文件，函数即服务给不了。
// 后期买服务器部署（真实 Node 环境、装了 yt-dlp）不设此变量即可自动恢复，代码零改动。
// 带 NEXT_PUBLIC_ 前缀，客户端也能读（构建时内联）；服务端路由同样按环境变量读取。
export const YTDLP_DISABLED = process.env.NEXT_PUBLIC_DISABLE_YTDLP === "1";
