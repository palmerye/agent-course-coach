# course-study-coach Skill 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"每节课陪练敲码 → 提问查漏 → 生成 notes.md"这套固定流程固化成一个可复用 skill,落在 `.claude/skills/course-study-coach/`,开源到 GitHub。

**Architecture:** 按 writing-skills 的 TDD 节奏实现——先跑无 skill 基线测试(RED)记录 agent 自然会怎么"陪练 + 写笔记"及其失败,再写最小 skill(GREEN),再验证堵漏(REFACTOR)。skill 本体是 `SKILL.md` 文档,不是代码。

**Tech Stack:** Markdown skill 文档;subagent 做基线测试与验证;真实样本为 L1/L3 两节缺笔记的课。

## Global Constraints

- skill 落在 `.claude/skills/course-study-coach/SKILL.md`(spec 第 7 节已定)。
- name 用字母数字连字符:`course-study-coach`。
- description 以 "Use when..." 开头,只写触发条件,不写流程摘要(SDO 铁律)。
- 提问只问设计意图类,不问事实题;不评分不打勾叉(spec 第 4 节)。
- 前端类比只在和前端思想差异大的地方用,不刻意(spec 第 7 节)。
- 笔记结构 7 部分,内容驱动结构,不强制凑满(spec 第 3 节)。
- TDD Iron Law:没有先看到基线失败,不写 skill。

---

## File Structure

| 文件 | 责任 | 创建/修改 |
|---|---|---|
| `.claude/skills/course-study-coach/SKILL.md` | skill 本体:6 步流程 + 7 部分笔记结构 + 提问补缺方法论 + 触发边界 | 创建 |
| `docs/superpowers/plans/baseline-L1.md` | L1 基线测试记录(无 skill 时 agent 怎么做、失败在哪) | 创建(临时,验证后可删) |
| `docs/superpowers/plans/baseline-L3.md` | L3 基线测试记录 | 创建(临时) |
| `src/L1/notes.md` | L1 笔记(基线副产物,补齐缺失笔记) | 创建 |
| `src/L3/notes.md` | L3 笔记(基线副产物) | 创建 |
| `Readme.md` | 笔记索引,补 L1/L3 链接 | 修改 |

---

## Task 1: RED — 跑 L1 无 skill 基线测试,记录失败

**目的:** 按 Iron Law,先看 agent 在没有 skill 时自然会怎么"陪练 + 写笔记",记录真实失败,才知道 skill 该教什么。

**Files:**
- Create: `docs/superpowers/plans/baseline-L1.md`(基线记录)

**Interfaces:**
- Consumes: `src/L1/hello-langchain.mjs`(L1 代码,已存在)
- Produces: baseline-L1.md(供 Task 3 写 skill 时对照失败模式)

- [ ] **Step 1: 派 subagent 跑 L1 基线场景**

派一个 general-purpose subagent,给它这个 prompt(模拟无 skill 的裸 agent):

```
你是一个 AI 编程助手。用户是个前端工程师,正在学一门 Agent 课程。
用户说:"开始学第 1 课:hello-langchain"。

请按你认为合理的方式,帮用户完成这节课的学习陪练 + 笔记沉淀。
具体要求:
1. 在 src/ 下建好 L1 目录(若已存在则跳过建目录,直接用)
2. 陪用户敲代码(用户会对照课程敲 src/L1/hello-langchain.mjs)
3. 敲完后向用户提问查漏补缺
4. 生成 src/L1/notes.md

注意:你现在没有任何 skill 指导,完全凭你自己的判断怎么做。
请把你的完整执行计划写出来:你打算怎么建目录、怎么陪练、会问什么问题(列出具体问题)、notes.md 会写哪些部分。
不要真的执行,只输出你的计划。
```

- [ ] **Step 2: 记录基线失败到 baseline-L1.md**

读 subagent 返回的计划,对照 spec 第 2/3/4 节,记录它自然会犯的错。预期失败模式(以实测为准,subagent 实际说的为准):

- 是否跳过了"建目录"或"更新 Readme"?
- 提问是否变成事实题(如"ChatOpenAI 是什么")而非设计意图题?
- 是否一次抛太多/太少问题?是否标注考察点?
- 答错是否直接给答案而非追问?
- 笔记结构是否偏离 7 部分?是否强行凑满或缺失关键部分?
- 是否每处都生硬套前端类比,而非只在差异大处?

把这些逐条写进 `docs/superpowers/plans/baseline-L1.md`,每条格式:`失败模式 → spec 要求 → 差距`。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/baseline-L1.md
git commit -m "test: 记录 L1 无 skill 基线失败模式(RED)"
```

---

## Task 2: RED — 跑 L3 无 skill 基线测试,记录失败

**目的:** 第二个样本,确认失败模式不是 L1 个例,而是系统性的。L3 比 L1 复杂(用了 spawn/child_process),能暴露更多失败。

**Files:**
- Create: `docs/superpowers/plans/baseline-L3.md`

**Interfaces:**
- Consumes: `src/L3/node_exec.mjs`(L3 代码,已存在)
- Produces: baseline-L3.md(供 Task 3 对照)

- [ ] **Step 1: 派 subagent 跑 L3 基线场景**

派 general-purpose subagent,prompt 同 Task 1 的 Step 1,但把"第 1 课:hello-langchain"换成"第 3 课:node-exec",代码指向 `src/L3/node_exec.mjs`。同样要求只输出计划不执行。

- [ ] **Step 2: 记录基线失败到 baseline-L3.md**

同 Task 1 Step 2 的方法,逐条记录 L3 的失败模式。重点看 L3 的复杂点(spawn 的 stdio/shell、错误处理、exit code)是否让 agent 的提问和笔记结构更偏离。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/baseline-L3.md
git commit -m "test: 记录 L3 无 skill 基线失败模式(RED)"
```

---

## Task 3: GREEN — 写最小 SKILL.md,针对基线失败

**目的:** 基于 Task 1/2 记录的真实失败,写一个最小 skill,正好堵住这些失败,不多写。

**Files:**
- Create: `.claude/skills/course-study-coach/SKILL.md`

**Interfaces:**
- Consumes: `docs/superpowers/plans/baseline-L1.md` + `baseline-L3.md`(失败模式清单)
- Produces: `SKILL.md`(供 Task 4 验证)

- [ ] **Step 1: 写 frontmatter(name + description)**

description 严格只写触发条件,不写流程(SDO 铁律):

```markdown
---
name: course-study-coach
description: Use when a learner following a hands-on course says "开始学第N课" or "学第N课" with a topic, and wants guided coding practice, gap-checking questions, and a notes.md per lesson under src/Ln/.
---
```

- [ ] **Step 2: 写 Overview(核心原则一句话)**

```markdown
# 课程学习陪练

## Overview
跟着一门有实操的课程,每节课走固定流程:建目录 → 陪练敲码 → 提问查漏 → 互动补缺 → 生成 notes.md → 更新 Readme 索引。核心是用提问逼主动回忆、暴露盲区,而非出题打分。
```

- [ ] **Step 3: 写 6 步流程(正向配方,针对基线跳步失败)**

把 spec 第 2 节的 6 步写成契约式清单,每步明确"做什么 + 不做什么"。针对基线里"跳过建目录/Readme"的失败,把这两步显式列为必须项。完整内容直接写进 SKILL.md 的 `## 流程` 节,照搬 spec 第 2 节 6 步,每步补一句"基线易漏点"提示。

- [ ] **Step 4: 写笔记 7 部分结构(针对笔记形状跑偏)**

照搬 spec 第 3 节 7 部分,每部分一句话定义 + "何时省略"提示。强调"内容驱动结构,不强制凑满"——针对基线里"强行凑满 7 部分"或"缺失关键部分"的失败。

- [ ] **Step 5: 写提问补缺方法论(针对提问变事实题、答错直接给答案)**

照搬 spec 第 4 节。关键针对基线失败加显式约束:
- 提问规则:只问设计意图类,给 3 个反例(事实题)和 3 个正例(意图题);一次 3-5 个,每个标注考察点;基于刚敲的代码。
- 补缺规则:先判对错;答错先追问(最多 2 轮)再讲;补缺要点进笔记。
- 反模式表:列出基线里出现的具体 rationalization(如"问 ChatOpenAI 是什么"→ "这是事实题,查文档即可,不占提问额度")。

- [ ] **Step 6: 写触发与边界(针对误触发/重复覆盖)**

照搬 spec 第 5 节。重点:重复课先问"重学/补笔记/跳过"不覆盖;陪练阶段零散提问直接答不走 6 步。

- [ ] **Step 7: 写前端类比策略(只在差异大处)**

针对基线里"生硬类比"失败,写一节:

```markdown
## 前端类比策略
学习者是前端工程师。用前端类比挂载新知识,但**只在和前端思想差异大的地方**用。
- 差异大(重点类比):如"模型只会输出文字,真正干活的是你的程序"——这与前端"用户点按钮触发动作"的直觉相反,必须类比。
- 差异不大(不强行类比):如"用 let 因为要重新赋值"——这是通用编程常识,不需要类比。
判断标准:这个概念如果用前端直觉去理解会得出**错误结论**,就重点类比;否则不类比。
```

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/course-study-coach/SKILL.md
git commit -m "feat: 写 course-study-coach skill(GREEN,针对基线失败)"
```

---

## Task 4: REFACTOR — 用 skill 重跑 L1/L3,验证堵漏

**目的:** 同样的 L1/L3 场景,这次给 subagent 注入刚写的 skill,看失败是否被堵住。

**Files:**
- Create: `docs/superpowers/plans/verify-L1.md`
- Create: `docs/superpowers/plans/verify-L3.md`
- Modify: `src/L1/notes.md`(若验证通过,产出真实笔记)
- Modify: `src/L3/notes.md`

**Interfaces:**
- Consumes: `.claude/skills/course-study-coach/SKILL.md`(Task 3 产物)+ baseline 记录(对照)
- Produces: verify 记录 + L1/L3 真实 notes.md

- [ ] **Step 1: 派 subagent 带 skill 重跑 L1**

派 general-purpose subagent,prompt 头部注入 SKILL.md 全文(作为系统指令),再给同样的"开始学第 1 课"任务。要求输出完整执行计划(建目录/陪练/提问清单/笔记结构)。

- [ ] **Step 2: 对照 baseline-L1.md 逐条验证**

读 subagent 返回的计划,对照 baseline-L1.md 里记录的每条失败,看是否被堵住:
- 建目录 + Readme 是否都在?
- 提问是否变成设计意图题?是否标注考察点?数量是否 3-5?
- 答错是否追问?
- 笔记结构是否符合 7 部分?是否内容驱动?
- 前端类比是否只在差异大处?

逐条写进 `verify-L1.md`,格式:`基线失败 → 是否堵住(是/否) → 证据`。

- [ ] **Step 3: 派 subagent 带 skill 重跑 L3**

同 Step 1,换 L3 场景。

- [ ] **Step 4: 对照 baseline-L3.md 逐条验证**

同 Step 2,写进 `verify-L3.md`。

- [ ] **Step 5: 若有未堵住的失败,回 Task 3 补 skill**

如果 verify 发现新失败,回 Task 3 对应 step 补显式约束,再重跑。直到 L1/L3 两条样本的主要失败都被堵住。

- [ ] **Step 6: 让 subagent 真实产出 L1/L3 的 notes.md**

验证通过后,派 subagent 真实执行(不只输出计划):对 L1、L3 各产出一份 `src/Ln/notes.md`,按 skill 的 7 部分结构写。这两份笔记同时补齐了项目里缺失的笔记。

- [ ] **Step 7: 更新 Readme.md 补 L1/L3 链接**

把 `Readme.md` 改成索引格式,补 L1/L3 行(spec 第 5 节格式):

```markdown
# Agent 学习笔记索引

- [L1 hello-langchain](src/L1/notes.md)
- [L2 tool-file-read](src/L2/notes.md)
- [L3 node-exec](src/L3/notes.md)
```

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/plans/verify-L1.md docs/superpowers/plans/verify-L3.md src/L1/notes.md src/L3/notes.md Readme.md
git commit -m "test: 用 skill 重跑 L1/L3 验证堵漏(REFACTOR)+ 补齐笔记"
```

---

## Task 5: 清理临时记录 + 开源就绪

**目的:** 基线/验证记录是过程产物,验证完成后清理或归档;确保仓库对开源就绪。

**Files:**
- Delete: `docs/superpowers/plans/baseline-L1.md`, `baseline-L3.md`, `verify-L1.md`, `verify-L3.md`(或归档到 docs/superpowers/baseline-records/ 留档)
- Modify: `Readme.md`(补一段说明这个 skill 是什么、怎么用,方便开源用户理解)

- [ ] **Step 1: 决定基线记录去留**

问用户:基线/验证记录是删掉,还是归档留档(开源时展示 TDD 过程)?默认归档到 `docs/superpowers/baseline-records/`。

- [ ] **Step 2: 执行归档或删除**

按 Step 1 决定执行。

- [ ] **Step 3: 给 Readme.md 补 skill 说明**

在 Readme.md 顶部加一段,说明本仓库含一个 `course-study-coach` skill(路径 `.claude/skills/course-study-coach/`),作用是陪练课程 + 生成笔记,触发方式"开始学第N课"。方便开源用户一眼看懂。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: 清理基线记录 + 开源就绪"
```

- [ ] **Step 5: 推送到 GitHub**

确认远程仓库配置后推送(若用户要求开源)。先问用户远程仓库地址/是否已配置 remote。

---

## Self-Review(写计划后自检)

**1. Spec 覆盖:** 逐节对照 spec——
- 第 2 节 6 步流程 → Task 3 Step 3 ✅
- 第 3 节笔记 7 部分 → Task 3 Step 4 ✅
- 第 4 节提问补缺方法论 → Task 3 Step 5 ✅
- 第 5 节触发边界 → Task 3 Step 6 ✅
- 第 7 节前端类比策略 → Task 3 Step 7 ✅
- 第 7 节 skill 路径 → File Structure + Task 3 ✅
- 第 7 节基线测试 → Task 1/2 ✅
- 无遗漏。

**2. 占位符扫描:** 无 TBD/TODO;每个 step 都有具体内容或具体 prompt。✅

**3. 一致性:** skill name `course-study-coach`、路径 `.claude/skills/course-study-coach/`、笔记路径 `src/Ln/notes.md`、Readme 格式,跨任务一致。✅
