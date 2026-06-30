# 多智能体主从协作方案

## 当前目标

把 Hermes Studio 从单聊天界面，推进到一个可观测、可编排、可回放的多智能体任务门户。

当前重点不是先做复杂协议，而是先把三层契约稳定下来：

1. 主智能体如何下发任务
2. 子智能体如何回传阶段事件
3. 前端如何展示真实执行过程

## 推荐落地路径

### Phase 1：先稳定现有主从编排链路

由 Hermes Studio 继续承担主智能体编排职责，子智能体承担具体执行职责。

短期内不先全量切 A2A，而是先把现有 `subagent.*` 事件流标准化。

### Phase 2：在标准事件模型上封装 A2A

等任务下发 schema、事件回传 schema、前端消费 schema 稳定后，再把传输层替换或兼容到 A2A。

这样可以避免现在就因为协议切换，把编排、展示、调试三件事绑死。

## 主智能体下发任务 schema

建议主智能体不要只给子智能体塞一段自然语言，而是下发结构化任务包：

```json
{
  "task_id": "uuid",
  "parent_session_id": "session_id",
  "objective": "用户真实目标",
  "constraints": [
    "时效限制",
    "数据范围",
    "输出格式"
  ],
  "context": {
    "user_message": "原始用户消息",
    "history_summary": "上下文摘要",
    "selected_agent": "被选中的子智能体",
    "skills": [],
    "tools": []
  },
  "expected_output": {
    "type": "structured_result",
    "fields": [
      "status",
      "progress",
      "artifacts",
      "summary",
      "next_action"
    ]
  }
}
```

## 子智能体回传事件 schema

建议统一成阶段性结构化事件：

```json
{
  "task_id": "uuid",
  "status": "running|completed|failed",
  "progress": 0.4,
  "stage": "查询数据源",
  "message": "正在读取 8 月海关月报",
  "artifacts": [],
  "summary": "",
  "next_action": ""
}
```

## 前端展示原则

### 聊天主区

继续承载主智能体与用户的对话。

### 右侧协作面板

展示：

1. 任务路径
2. 当前执行节点
3. 子智能体回传事件流
4. 阶段成果

### 展示边界

子智能体消息不要直接混成普通 assistant 文本。

更合理的做法是：

1. 子智能体的执行过程显示为事件流
2. 主智能体最终再把阶段成果汇总成用户可读答复

这样用户才能判断：

1. 当前节点是否真的在运行
2. 子智能体在做什么
3. 是否曲解了任务意图

## A2A 接入建议

不建议现在直接整体切 A2A。

更可执行的路线是：

1. 先标准化现有 `subagent.start / tool / progress / complete`
2. 再把这些事件映射到 A2A 的 transport
3. 让主智能体和子智能体保留同一份任务/事件 schema

也就是说，先统一消息模型，再替换协议层。

## 当前已知风险

1. 任务规划节点目前仍偏静态，容易被看成 mock
2. 子智能体空返回时，不能直接按成功完成处理
3. 主从链路当前仍是 runtime 直连，不是标准网络协议
4. 前端虽然已经开始展示子智能体回传，但还需要继续校验是否与真实运行严格一致

## 下一步建议

1. 用 Playwright 复现当前多智能体聊天问题
2. 锁定“规划节点写死”和“空返回误判完成”的真实触发路径
3. 修正状态机
4. 再开始把 runtime 直连改成结构化任务包模式
