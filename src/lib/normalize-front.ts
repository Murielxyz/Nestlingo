/** 卡片正面的去重归一化：去掉括号读音（`（读音）`/`(读音)`）+ 把连续空白压成单空格 + trim。
 *  用于「同词不重复」比对（忽略括号读音 / 空白差异），不改变卡片实际存储的 front。
 *  三处共用：解释收录（rich-text-editor）、AI 语伴加入笔记（ai-assistant-panel）、转卡预览（convert-to-cards）。 */
export function normalizeFront(front: string): string {
  return (front ?? "")
    .replace(/[（(][^（）()]*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
