# Multi-Agent Next Todos

更新时间：2026-06-30

这份清单只记录当前已经明确、但还没有真正接通的多智能体后续任务，分成两条主线：

1. 主智能体真实生成 todo list
2. Skills 中心 / 工具中心真实发布到 `subAgent-pi`

## 一、主智能体真实生成 todo list

当前问题：

- 聊天页右侧展示的执行路径仍然偏前端拼装，缺少真实规划结果来源
- 主智能体虽然已经有“多智能体协作模式”入口，但没有形成可信的计划产物
- todo list 还没有变成主智能体执行过程中的第一阶段输出

### 待办

- [ ] 明确主智能体在收到用户消息后的首段执行协议
  - 目标：先做需求理解，再决定是否进入多智能体协作
  - 输出：意图类型、约束条件、交付目标、风险点

- [ ] 定义真实的 plan/todo 数据结构
  - 建议字段：
    - `plan_id`
    - `session_id`
    - `user_goal`
    - `mode`（普通问答 / 单智能体执行 / 多智能体协作）
    - `steps`
    - `status`
    - `selected_subagents`
    - `updated_at`

- [ ] 定义 `steps` 的最小结构
  - 建议字段：
    - `id`
    - `title`
    - `description`
    - `type`（理解 / 检索 / 规划 / 调用子智能体 / 汇总 / 交付）
    - `status`（pending / running / completed / failed / skipped）
    - `owner`（Hermes / sub-agent id）
    - `depends_on`
    - `output_summary`
    - `error`

- [ ] 将“生成 todo list”接入聊天链路第一阶段
  - 用户消息发出后，先由主智能体产出 plan
  - plan 返回后，再决定后续是否调用子智能体
  - 不再由前端直接写死任务路径

- [ ] 在聊天页右侧把执行路径切换为真实 plan 渲染
  - 右侧只展示当前会话 plan
  - 节点状态来自主智能体/子智能体事件流
  - 不再在前端本地提前生成“已完成”节点

- [ ] 增加主智能体计划修正机制
  - 用户补充需求后，允许 plan 增量更新
  - 新 plan 与旧 plan 需要有版本或更新时间

- [ ] 定义“是否调用子智能体”的决策边界
  - 什么时候由主智能体自己处理
  - 什么时候拆给问数、文档、浏览器、代码等子智能体
  - 置信度和理由要可展示

- [ ] 为 plan 增加前端可消费的事件流
  - `plan.created`
  - `plan.updated`
  - `plan.step.started`
  - `plan.step.completed`
  - `plan.step.failed`
  - `plan.finished`

- [ ] 补主智能体真实 plan 的联调测试
  - 用户提问
  - 主智能体返回 plan
  - 右侧执行路径按 plan 更新
  - 子智能体执行后回写节点状态

## 二、Skills 中心 / 工具中心真实发布链路

当前问题：

- 管理页已经有 Skills 中心和工具中心，但现在还是“装配层”
- 勾选后能进入子智能体草稿配置，但还没有变成真正可安装、可同步的发布机制
- 中心条目缺少正式 manifest 结构和发布状态

### 待办

- [ ] 定义 Skills 中心 manifest 结构
  - 建议字段：
    - `id`
    - `name`
    - `version`
    - `description`
    - `category`
    - `tags`
    - `source_project`
    - `delivery_mode`
    - `artifact_url`
    - `entry`
    - `files`
    - `provides`
    - `compatibility`

- [ ] 定义工具中心 manifest 结构
  - 与 skill 类似，但增加工具协议描述
  - 需要明确工具名、入口、依赖、暴露能力

- [ ] 梳理问数智能体现有 skills / tools 的正式映射
  - 把当前问数智能体的 skills 和工具整理成标准 manifest
  - 补全真实 artifact 地址或安装源

- [ ] 设计“勾选 -> 生成 agent config”的映射规则
  - 选中哪些 skills
  - 选中哪些工具
  - 如何落到 `subAgent-pi` 需要的配置结构

- [ ] 调研并确定 `subAgent-pi` 安装/同步接口
  - 查询已安装
  - 校验配置
  - 安装 skill/tool
  - 回写安装结果

- [ ] 把“发布配置”拆成可追踪阶段
  - `manifest.resolve`
  - `config.generate`
  - `remote.validate`
  - `remote.install`
  - `runtime.refresh`
  - `publish.done`

- [ ] 让安装结果回流到管理台
  - 每个阶段要有状态
  - 每个 skill/tool 要能看到成功或失败
  - 失败原因要可见，不能吞错

- [ ] 为中心条目增加状态字段
  - 未配置
  - 可分发
  - 已同步到当前子智能体
  - 远端已安装
  - 安装失败

- [ ] 增加“从运行时反查已安装能力”的同步机制
  - 从 `subAgent-pi` 拉取已安装 skill/tool
  - 映射回管理台中的中心条目和子智能体配置

- [ ] 补这条链路的联调与错误测试
  - 错误 URL
  - 安装失败
  - 校验失败
  - 远端未返回可视结果

## 三、建议的实现顺序

### 第一阶段

- [ ] 先做主智能体真实 plan/todo 输出
- [ ] 把聊天页右侧节点改成只消费真实 plan 事件

### 第二阶段

- [ ] 再做 Skills 中心 / 工具中心 manifest 化
- [ ] 再接 `subAgent-pi` 的真实安装与同步接口

### 第三阶段

- [ ] 把 plan 中“选择哪个子智能体”的决策，与管理页中配置的能力中心打通
- [ ] 形成“主智能体规划 -> 子智能体路由 -> 能力执行 -> 阶段回传”的闭环

## 四、当前结论

短期内优先级最高的是：

- [ ] 去掉假的 todo 路径
- [ ] 让主智能体先真实产出 plan
- [ ] 再用这个 plan 驱动右侧执行节点

Skills 中心 / 工具中心这一块，先作为后续专项任务保留，不在这一轮继续扩展实现。
