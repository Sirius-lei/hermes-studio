# 多智能体改造增量记录（2026-06-30）

## 说明

本次提交是一个阶段性快照，不是最终版本。

目标是先把 Hermes Studio 从单一聊天界面推进到“任务规划 + 子智能体委派 + 右侧执行路径展示”的基础形态，便于后续继续迭代。

## 本次已落地内容

### 1. 聊天页加入多智能体协作入口

- 在 `/#/hermes/chat` 的输入区工具栏增加了“多智能体”开关
- 用户开启后，右侧会展开协作面板
- 协作面板不再依赖单纯静态 mock，而是消费运行时路由事件和子智能体事件

相关文件：

- `packages/client/src/components/hermes/chat/ChatInput.vue`
- `packages/client/src/components/hermes/chat/ChatPanel.vue`
- `packages/client/src/stores/hermes/chat.ts`

### 2. 增加任务规划与执行路径的前端展示骨架

- 右侧面板展示：
  - 任务目标
  - 路由结果
  - 当前节点
  - 执行节点列表
  - 子智能体回传活动流
- 节点状态支持 `todo / doing / done / blocked`

当前展示更接近 Plan 模式的可视化侧栏，但仍然是 Hermes 内部状态投影，不是完整通用工作流引擎。

### 3. 增加子智能体管理与任务规划页面骨架

- 增加了子智能体页面和任务规划页面
- 新增了与任务规划相关的前后端接口与存储骨架

相关文件：

- `packages/client/src/views/hermes/SubAgentsView.vue`
- `packages/client/src/views/hermes/TaskPlansView.vue`
- `packages/client/src/api/hermes/task-plans.ts`
- `packages/server/src/controllers/hermes/task-plans.ts`
- `packages/server/src/routes/hermes/task-plans.ts`
- `packages/server/src/db/hermes/task-plan-store.ts`
- `packages/server/src/services/task-planner.ts`

### 4. 增加多智能体路由与子智能体委派链路

- 新增服务端多智能体路由决策模块
- 支持把候选子智能体列表作为运行时参数送入聊天执行
- 命中后可转入子智能体委派模式

相关文件：

- `packages/server/src/services/hermes/run-chat/multi-agent-routing.ts`
- `packages/server/src/services/hermes/run-chat/index.ts`
- `packages/server/src/services/hermes/run-chat/types.ts`
- `packages/client/src/api/hermes/chat.ts`

### 5. 子智能体调用已对齐 `subAgent-pi` 的 OpenAI-compatible 流式接口

当前委派调用格式已经按 `subAgent-pi` 项目实现收敛到：

- `POST /v1/chat/completions`
- `Content-Type: application/json`
- `Accept: text/event-stream`
- `X-Pi-Mono-Session-Id`
- body:
  - `model`
  - `stream`
  - `timeout`
  - `session_id`
  - `messages`

并且补了：

- 子智能体 `session_id` 的保守规范化
- 对 `pi_mono_event` 的流式解析
- 子智能体空正文但有真实执行活动时的最小摘要回退

相关文件：

- `packages/server/src/services/hermes/run-chat/handle-subagent-run.ts`

### 6. 清理右侧执行路径中的脏标签

已增加对以下内容的清理：

- `<dcp-id>...</dcp-id>`
- `<think>...</think>`
- `<thinking>...</thinking>`
- `<reasoning>...</reasoning>`

清理位置：

- 服务端子智能体流解析
- 客户端多智能体侧栏展示兜底

相关文件：

- `packages/server/src/services/hermes/run-chat/handle-subagent-run.ts`
- `packages/client/src/utils/agent-display-text.ts`
- `packages/client/src/stores/hermes/chat.ts`

### 7. 已补基础测试

- 子智能体 `session_id` 规范化测试
- 子智能体输出清洗测试
- 右侧执行路径文本清洗测试
- 多智能体聊天 E2E 基础用例

相关文件：

- `tests/server/handle-subagent-run.test.ts`
- `tests/client/agent-display-text.test.ts`
- `tests/e2e/multi-agent-chat.spec.ts`

## 当前仍存在的问题

### 1. 路由决策仍然偏启发式

当前多智能体路由仍主要基于候选信息、文本命中和置信度规则，不是完整的任务理解与规划引擎。

### 2. 任务规划仍不是完整的通用任务门户实现

右侧执行路径已经具备基础展示能力，但目前更像“运行时节点投影”，还不是统一的任务分解中心。

### 3. 主从智能体通信协议尚未标准化

现在仍然是 Hermes 直连 `subAgent-pi` 运行时。

还没有落成：

- A2A 协议层
- 标准化任务包 schema
- 标准化阶段成果 schema
- 主从网络级身份与回执协议

### 4. 子智能体返回结构仍然不够规范

目前能接收：

- 启动
- 工具调用
- 阶段进展
- 完成/失败

但还缺少更明确的结构化产出字段，例如：

- `progress`
- `artifacts`
- `summary`
- `next_action`

### 5. 旧会话数据不会自动回溯修复

这次清洗逻辑主要影响新事件与新会话。

已经落到历史消息或历史事件里的脏文本，不会自动批量清理。

### 6. 子智能体配置与真实运行环境仍依赖外部地址可达性

如果 `baseUrl/chatPath` 配错，或者子智能体 runtime 未启动，仍会直接失败。

这部分后续需要：

- 连通性探测
- 配置校验
- 健康状态缓存
- 更清晰的错误分类

## 建议的下一阶段改造

1. 把多智能体路由从启发式匹配升级为“任务拆解器 + 执行器选择器”
2. 把右侧侧栏从执行投影升级成真正的任务规划面板
3. 为主智能体下发任务建立结构化 schema
4. 为子智能体回传阶段成果建立结构化 schema
5. 再评估是否切换到 A2A 协议层
6. 为子智能体管理页面接入 `subAgent-pi` 的 agent/config/profile/skills/extensions 等真实接口

## 本次提交范围建议

本次提交建议作为“多智能体阶段快照”保留，后续继续在这个基础上迭代。

不建议把它视为最终可交付版本。
