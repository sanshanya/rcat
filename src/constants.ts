// src/constants.ts

// 使用 as const 锁定字面量类型，TS 会由 string 变为具体的 "click-through-state"
// 这样在代码里写错一个字母，编译器直接标红
export const EVT_CLICK_THROUGH_STATE = "click-through-state" as const;

// 以后如果有其他事件，继续往下加
// export const EVT_CPU_UPDATE = "cpu-update" as const;