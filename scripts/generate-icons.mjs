// 生成 PWA 图标（PNG）。运行：node scripts/generate-icons.mjs
// 无第三方依赖：用 zlib 手写 PNG 编码，用像素运算绘制「鸟巢」图形。
import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");

// ---------- PNG 编码 ----------
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 绘制 ----------
const TOP = [99, 102, 241]; // #6366f1
const BOTTOM = [124, 58, 237]; // #7c3aed

function roundedRectSDF(u, v, r) {
  const qx = Math.abs(u - 0.5) - (0.5 - r);
  const qy = Math.abs(v - 0.5) - (0.5 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

// 在居中的 s×s 区域内判断是否为白色字形（蛋 + 碗）
function inGlyph(u, v, s) {
  const x = (u - 0.5) / s + 0.5;
  const y = (v - 0.5) / s + 0.5;
  // 蛋：白色圆
  const dx = x - 0.5;
  const dy = y - 0.46;
  if (dx * dx + dy * dy <= 0.16 * 0.16) return true;
  // 碗：下半椭圆
  if (y < 0.6) return false;
  const bx = x - 0.5;
  const by = y - 0.6;
  return (bx * bx) / (0.28 * 0.28) + (by * by) / (0.2 * 0.2) <= 1;
}

function render(size, { rounded, glyphScale }) {
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const v = (py + 0.5) / size;
      let a = 255;
      if (rounded && roundedRectSDF(u, v, 0.22) > 0) a = 0;
      const t = Math.min(1, Math.max(0, v));
      let r = Math.round(TOP[0] + (BOTTOM[0] - TOP[0]) * t);
      let g = Math.round(TOP[1] + (BOTTOM[1] - TOP[1]) * t);
      let b = Math.round(TOP[2] + (BOTTOM[2] - TOP[2]) * t);
      if (inGlyph(u, v, glyphScale)) {
        r = 255;
        g = 255;
        b = 255;
      }
      const i = (py * size + px) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return buf;
}

mkdirSync(outDir, { recursive: true });

const targets = [
  { name: "icon-192.png", size: 192, rounded: true, glyphScale: 1 },
  { name: "icon-512.png", size: 512, rounded: true, glyphScale: 1 },
  { name: "icon-maskable-512.png", size: 512, rounded: false, glyphScale: 0.72 },
  { name: "apple-touch-icon.png", size: 180, rounded: true, glyphScale: 1 },
];

for (const t of targets) {
  writeFileSync(join(outDir, t.name), encodePNG(t.size, t.size, render(t.size, t)));
  console.log("✓", t.name);
}
