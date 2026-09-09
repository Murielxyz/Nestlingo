// SM-2 间隔重复算法（简化版）。评分后算出下一次复习间隔。
// 输入上次状态，输出新状态；客户端把结果 upsert 到 review_state 表。

export type Rating = 1 | 2 | 3 | 4; // 忘记 / 困难 / 一般 / 简单

export interface ReviewSchedule {
  ease: number; // 难度系数 EF，越低越难
  intervalDays: number;
  reps: number; // 连续答对次数
  lapses: number; // 忘记次数
}

export const DEFAULT_SCHEDULE: ReviewSchedule = {
  ease: 2.5,
  intervalDays: 0,
  reps: 0,
  lapses: 0,
};

const MIN_EASE = 1.3;
const MAX_EASE = 4.0;

export function scheduleReview(
  prev: ReviewSchedule,
  rating: Rating
): ReviewSchedule {
  let { ease, intervalDays, reps, lapses } = prev;

  if (rating === 1) {
    // 忘记：重新开始，次日再看（不再当天即到期，避免被复习会话立刻再捞起死循环）
    reps = 0;
    lapses += 1;
    intervalDays = 1;
    ease = Math.max(MIN_EASE, ease - 0.2);
  } else if (rating === 2) {
    // 困难：间隔缓增，难度略降；基数 ≤1 时乘 1.2 会原地踏步（round(1*1.2)=1），改按连续答对次数递增
    reps += 1;
    intervalDays =
      reps <= 1
        ? 1
        : intervalDays <= 1
          ? reps
          : Math.max(1, Math.round(intervalDays * 1.2));
    ease = Math.max(MIN_EASE, ease - 0.15);
  } else if (rating === 3) {
    // 一般：标准 SM-2
    reps += 1;
    intervalDays =
      reps === 1 ? 1 : reps === 2 ? 6 : Math.max(1, Math.round(intervalDays * ease));
  } else {
    // 简单：间隔快增，难度略升
    reps += 1;
    intervalDays =
      reps === 1
        ? 3
        : reps === 2
          ? 8
          : Math.max(1, Math.round(intervalDays * ease * 1.3));
    ease = Math.min(MAX_EASE, ease + 0.15);
  }

  return { ease, intervalDays, reps, lapses };
}

/** 把间隔天数转成到期时间（ISO 字符串）。 */
export function dueAtFrom(intervalDays: number, now: number = Date.now()): string {
  return new Date(now + intervalDays * 86400000).toISOString();
}
