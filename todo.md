**未完成**

- VRM Debug：增加 VMD 相关开关（快速定位抖动来源）
  - IK on/off（禁用 IK 用于对照是否 IK 导致抖动/瞬移感）
  - includeFingers on/off（手指轨道开关，用于近景/特写质量 vs 低占用）
  - smoothingTau 可调（例如 0.06～0.20，便于不同模型/动作调参）
- VRM Debug：展示渲染性能指标（辅助 Auto 60/30 判断）
  - rafEmaMs / workEmaMs（可直接读 renderFpsStore）
- VMD 质量：为 VMD 动作提供“性能档位”预设（默认低占用）
  - 低：includeFingers=false + IK=on + smoothingTau=0.12（现状）
  - 高：includeFingers=true + IK=on + smoothingTau=0.08（近景用）
