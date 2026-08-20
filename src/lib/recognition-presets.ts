// 闪卡识别规则的预设：给不同语言提供一组「正面 / 背面 / 拓展」表头关键词，
// 用户在设置里选一个预设或自行增删，命中这些关键词的表格列会被正确归到对应角色。

import type { RecognitionRules } from "@/lib/types";

export type RecognitionPreset = {
  key: string;
  label: string;
  rules: RecognitionRules;
};

export const RECOGNITION_PRESETS: RecognitionPreset[] = [
  {
    key: "thai",
    label: "泰语",
    rules: {
      front: ["泰语", "泰文", "生词", "单词", "词汇"],
      back: ["释义", "意思", "中文", "翻译"],
      extra: ["例句", "拓展", "补充"],
      separator: null,
      calloutOnly: false,
    },
  },
  {
    key: "korean",
    label: "韩语",
    rules: {
      front: ["韩语", "韩文", "单词", "词汇"],
      back: ["释义", "中文", "意思", "翻译"],
      extra: ["例句", "拓展"],
      separator: null,
      calloutOnly: false,
    },
  },
  {
    key: "japanese",
    label: "日语",
    rules: {
      front: ["日语", "日文", "单词", "词汇"],
      back: ["释义", "中文", "翻译", "意思"],
      extra: ["例句", "拓展"],
      separator: null,
      calloutOnly: false,
    },
  },
  {
    key: "english",
    label: "英语",
    rules: {
      front: ["英语", "英文", "word", "term", "词汇"],
      back: ["释义", "中文", "meaning", "definition", "翻译"],
      extra: ["例句", "example", "拓展"],
      separator: null,
      calloutOnly: false,
    },
  },
  {
    key: "cn-en",
    label: "中英对照",
    rules: {
      front: ["中文", "汉字", "原文"],
      back: ["英文", "翻译", "translation"],
      extra: ["例句", "拓展"],
      separator: null,
      calloutOnly: false,
    },
  },
];

export const EMPTY_RULES: RecognitionRules = {
  front: [],
  back: [],
  extra: [],
  separator: null,
  calloutOnly: false,
  reading: "back",
  wrapBackSpaces: true,
  splitBySemicolon: false,
  customRules: [],
};
