# Agent 学习笔记

> 基于 `src/tool-file-read.mjs` 这个最小 agent 示例整理。
> 背景：前端工程师转 agent 开发。

---

## 0. 核心认知（前端转 agent 最容易卡的地方）

**大模型本身只会「输出文字」，它不能读文件、不能跑代码。**

所谓「工具调用」，是模型在回复里说「我想调用 `read_file` 这个函数，参数是 xxx」，然后**你的程序**替它真正执行，再把结果喂回给它。

- 模型决定「调不调、调哪个、传什么参数」
- 你的程序负责「真正干活」

类比前端：就像「按钮点击 → 调 API → 拿结果渲染」，只不过这里「决定调不调 API」的是模型，不是用户点按钮。

---

## 1. zod 是干啥的

文件第 4、34-36 行用到 `zod`：

```js
schema: z.object({
  filePath: z.string().describe('要读取的文件路径')
})
```

作用三件事：

1. **声明输入结构** — 告诉 LangChain「这个工具接收一个对象，里面有一个 `filePath` 字段」。
2. **类型校验** — `z.string()` 规定 `filePath` 必须是字符串，运行时校验。
3. **生成描述** — `.describe()` 给字段加说明。LangChain 会把 schema 转成 JSON Schema 发给大模型，模型靠它知道「该工具要什么参数、每个参数什么意思」。

**zod = 给工具入参定一个「合同」，既给模型看（怎么调），也给程序看（校验对不对）。**

> 踩坑提醒：用 `z` 必须在顶部 `import { z } from 'zod'`，否则报 `z is not defined`。

---

## 2. 整个文件在做什么

做一个能「自己读文件、再解释代码」的 AI agent。

### 逐段拆解

**① 导入与初始化（第 1-20 行）**

- `ChatOpenAI`：和 OpenAI 兼容接口通信的客户端（用了 `BASE_URL`，可能接第三方/代理）。
- `tool`：把一个函数包装成「模型可调用的工具」的工厂函数。
- `z`：zod，给工具入参定结构 + 校验。
- `fs`：Node 文件 API，真正读文件靠它。
- 三种 `Message`：对话历史里的三种角色。

`temperature: 0` → 让模型回答更稳定，agent 场景希望它「按规则办事」而非「发挥创意」。

**② 定义工具（第 22-38 行）**

```js
const readFileTool = tool(
  async ({ filePath }) => { ... },   // 真正干活的函数
  {
    name: "read_file",                // 给模型看的「函数名」
    description: "用此工具来读取文件内容……",  // 给模型看的「什么时候该用它」
    schema: z.object({ ... }),        // 给模型看的「参数结构」
  },
);
```

`tool()` = 执行函数 + 元信息对象。

类比 React 组件：函数体是「渲染逻辑」，`name/description/schema` 是「props 类型 + 文档」，只不过这份文档给**模型**看。

> **核心手艺**：模型完全靠 `description` 判断「现在该不该调这个工具」。description 写得好不好，直接决定 agent 好不好用。

**③ 把工具绑定到模型（第 40-42 行）**

```js
const modelWithTools = model.bindTools(tools);
```

`bindTools` 不是「立刻调用」，而是告诉模型「你这次对话里**可以**用这些工具」。底层会把工具转成 OpenAI 的 `functions`/`tools` 参数一起发出去。

**④ 准备初始对话（第 44-56 行）**

```js
const messages = [
  new SystemMessage(`你是一个代码助手……工作流程：1…2…3…`),
  new HumanMessage("请读取 ./src/tool-file-read.mjs 文件内容并解释代码"),
];
```

- `SystemMessage`：人设 + 规则，相当于「岗位职责说明书」。
- `HumanMessage`：用户的实际请求。
- `messages` 是一个**会不断增长的数组**，整个 agent 的「记忆」就是它。

**⑤ Agent 循环本体（第 58-98 行）—— 全文最核心**

**⑥ 输出最终回复（第 100-101 行）**

---

## 3. Agent 循环详解（第 58-98 行）

### 整体结构

```js
let response = await modelWithTools.invoke(messages);  // ① 第一次问模型
messages.push(response);                                // ② 把回复存进历史

while (response.tool_calls && response.tool_calls.length > 0) {  // ③ 判断要不要进循环
  // 执行工具 + 记账
  response = await modelWithTools.invoke(messages);    // ④ 循环里再问
}

console.log(response.content);  // ⑤ 退出循环后输出最终回复
```

### 关键点：第 58 行是「引子」，不是循环的一部分

- **第 58 行** = 第一轮调用（**无条件**先问一次，因为得先有模型回复，才能判断它要不要调工具）。
- **第 63 行 `while`** = 判断「模型这次回复里有没有 `tool_calls`」。
  - 有 → 进循环执行工具 → 再问一次
  - 没有 → 跳过循环，直接到第 100 行输出最终回复

### 模型第一次回复的两种情况

**情况 A：模型决定调工具**（命中 `tool_calls`）

```
第 58 行 invoke → 模型说「我要调 read_file」
                          ↓
第 63 行 while 判断 → 有 tool_calls → 进循环
                          ↓
              执行工具 → 塞回 messages → 第 97 行再问
                          ↓
              再判断…（可能再来一轮）
                          ↓
              某轮没有 tool_calls 了 → 退出循环 → 输出
```

**情况 B：模型直接给答案**（没命中 `tool_calls`）

```
第 58 行 invoke → 模型直接说「这个文件是…」（没调工具）
                          ↓
第 63 行 while 判断 → tool_calls 为空 → 不进循环
                          ↓
              直接到第 100 行输出最终回复
```

比如「请读取文件并解释」→ 大概率走 A；「1+1 等于几」→ 走 B，循环一次都不执行。

### 为什么用 `let` 不用 `const`

第 58 行是 `let`，循环里第 97 行会**重新给 `response` 赋值**。每轮循环结束前，`response` 都被更新成「最新一次模型的回复」，`while` 条件重新判断的就是这个新回复。

---

## 4. 为什么 `while` 里先 `map` 又来 `forEach`

模型一次可能要调**多个**工具，`response.tool_calls` 是个数组。

### 第一个 `map`（第 67-84 行）：执行工具，拿结果

```js
const toolResults = await Promise.all(
  response.tool_calls.map(async (toolCall) => {
    const tool = tools.find((t) => t.name === toolCall.name);
    ...
    const result = await tool.invoke(toolCall.args);   // 真正干活
    return result;                                      // ← 把结果返回出去
  }),
);
```

- **目的：执行每个工具调用，收集结果。**
- `map` 会**返回一个新数组**——`toolResults` 就是结果数组。
- `async` + `Promise.all` 是为了**并行**执行多个工具调用（两个文件可以同时读）。
- 这一步**只管「执行+拿结果」**，不管消息历史。

类比前端：`const results = await Promise.all(urls.map(fetch))`——并行请求，收集响应。

### 第二个 `forEach`（第 87-94 行）：把结果塞回对话历史

```js
response.tool_calls.forEach((toolCall, index) => {
  messages.push(
    new ToolMessage({
      content: toolResults[index],      // ← 用上一步的结果
      tool_call_id: toolCall.id,        // ← 配对 id
    }),
  );
});
```

- **目的：构造 `ToolMessage`，追加到 `messages` 数组。**
- `forEach` **不返回东西**，只是「遍历着做副作用」——副作用就是 `messages.push(...)`。
- 需要 `toolCall.id` 来配对（OpenAI 协议要求工具结果必须指明回答的是哪次调用）。
- 依赖上一步的 `toolResults`，靠 `index` 取对应结果。

类比前端：`data.forEach(item => list.appendChild(createDom(item)))`——遍历着往 DOM 里塞东西。

### 为什么不能合成一个循环

1. **职责分离** — `map` = 执行（可能慢、可能失败、要并行）；`forEach` = 记账（往消息历史写）。
2. **错误处理边界** — `map` 里有 `try/catch`，失败时返回错误字符串。合并会让错误处理和消息构造缠在一起。
3. **`Promise.all` 要「纯执行数组」** — 如果边执行边 `push` 到 `messages`，顺序会和「执行完成顺序」耦合；而协议要求工具结果要和 `tool_calls` 顺序对应。先 `map` 出干净的结果数组，再按固定顺序 `forEach` 写进 `messages`，顺序才稳。

### 流程图

```
response.tool_calls（模型要调的，比如 2 个）
        │
        ▼  map + Promise.all   ← 第一步：并行执行，拿结果
toolResults = ['内容A', '内容B']
        │
        ▼  forEach             ← 第二步：按顺序塞回 messages
messages += [ToolMessage(id=call_1), ToolMessage(id=call_2)]
        │
        ▼  再 invoke 一次       ← 把带结果的对话历史发给模型
```

**一句话**：`map` 是「执行 + 收集结果」（要返回值，要并行）；`forEach` 是「把结果记账到对话历史」（不要返回值，要副作用 + 配对 id）。一个干活，一个记账，所以是两个循环。

---

## 5. SystemMessage vs skill vs tool vs agent

### 5.1 SystemMessage 可以理解为 skill 吗？

**部分可以，但有差别。**

你代码里那个 `SystemMessage` 做了三件事：人设 + 流程性知识 + 规则。跟「skill = 一套可执行的方法论/流程」在感觉上像。

但本质不同，差在一个词：**「常驻」vs「按需」**。

|                  | `SystemMessage`                      | skill（通常理解）                             |
| ---------------- | -------------------------------------- | --------------------------------------------- |
| 何时生效         | **每次对话都在**，常驻背景       | **按需加载**，需要时才触发进来          |
| 作用             | 设定角色/规则/全局基调                 | 提供一段**可复用的流程+知识**，扩展能力 |
| 是否增加能力边界 | 不增加，只是「叮嘱」模型怎么用现有能力 | 算扩展，相当于给模型一个新「技能包」          |
| 类比（前端）     | 全局`App.tsx` 里的 Provider/Context  | 按路由懒加载的某个功能模块                    |

更准确的说法：

- **`SystemMessage` ≈ 岗位职责说明书 / 系统提示词**。一直在，告诉模型「你是谁、底线规则是什么」。
- **`tool`（带 `description`）≈ 模型能主动调用的技能**。这才是真正「扩展能力」的地方。`description` 就是这个技能的「使用说明」。
- **skill ≈ 一整套打包好的「流程+工具+知识」**，通常带「触发条件」，用到时才加载。

> skill ≈ 可动态拼装的 SystemMessage 片段。如果哪天发现 `SystemMessage` 越写越长、且不同任务只需要其中一部分，就该把它拆成多个「skill」按需加载了。

### 5.2 为什么说 `read_file` 比 `SystemMessage` 更接近 skill 本意

因为 skill 的本意是**「一项你原本没有的能力」**。

|              | `SystemMessage`                 | `read_file` 工具                                       |
| ------------ | --------------------------------- | -------------------------------------------------------- |
| 是否扩展能力 | ❌ 模型本来就会说话，只是「叮嘱」 | ✅ 模型本来**读不了文件**，有了它才会              |
| 是否按需触发 | ❌ 常驻，每次都在                 | ✅ 有`description`，模型**根据上下文决定**调不调 |
| 是否自包含   | ❌ 只是一段文字                   | ✅ 名字+说明+执行逻辑，一个完整能力单元                  |

「扩展能力」+「按需触发」正是 skill 的两个标志。`SystemMessage` 两条都不沾，所以工具更像 skill。

补充：单个 tool 比 skill **窄**。skill 通常打包「一整套流程+可能多个工具+资源」，而 tool 是其中一个**原子动作**。
**tool 是 skill 的零件，skill 是把零件+流程组装好的能力包。**

### 5.3 skill 和 agent 的区别

一句话：**skill 是「怎么做」的知识包，agent 是「去做」的执行者。**

- **skill = 被动的能力包**：一段流程说明+工具+资源，被「加载进」模型。它自己不会跑，得有人/有循环去执行它。
- **agent = 主动的自主循环**：给定目标，自己决定调什么工具、读什么、改什么，**循环往复直到完成**。

前端类比：

- skill = 一份**操作手册 / 菜谱**（写清楚步骤）
- tool = 一把**厨具**（具体动作）
- agent = **厨师**：拿到目标「做顿饭」，自己翻菜谱、拿厨具、看锅里情况、火大了就关小、做完为止

关键差别在**「自主循环」**：skill 是静态文本，agent 是会**根据中间结果改主意**的循环。skill 不会自己读文件、不会看到报错去重试——那是 agent 干的。

### 5.4 skill 能做，为什么还要用 agent？优劣势

不是二选一，是不同场景。看任务「步骤是否事先知道」。

**Agent 能做、skill 做不到的（agent 优势）：**

1. **探索未知范围** — 「找出这个项目的 bug 并修掉」，事先不知道要读哪些文件。skill 是固定流程，agent 能边读边决定下一步。
2. **多步依赖** — 第 3 步依赖第 2 步的返回。skill 能「描述」依赖，但**执行不了分支**；agent 循环就是干这个的。
3. **真实副作用** — 读文件、跑测试、改代码。skill 是文本，碰不到文件系统；只有工具（在 agent 里）能真改东西。
4. **错误恢复** — 工具失败了，agent 能看到报错、改参数重试；静态 skill 做不到。

**Agent 的劣势（skill 优势）：**

1. **贵 + 慢** — agent 是多次 LLM 调用的循环，skill 可能一次就够。成本/延迟差 5~50 倍。
2. **不可控** — 自主性 = 可能跑偏、死循环、幻觉出不存在的工具调用。
3. **难调试** — 长链路、多分支；skill 是线性流程，一眼到底。
4. **杀鸡用牛刀** — 「总结这段话」「写个 commit message」用 skill/强 prompt 足够，上 agent 是浪费。
5. **安全风险** — agent 有工具就能真删文件、真调 API；skill 只是文字，危害面小。

**决策规则：**

- **边界清晰、步骤已知** → 用 skill（强 prompt + 流程），单次或少次调用。
- **需要发现状态、适应变化、多步反应** → 用 agent。
- **好 agent 会用 skill**：skill 提供「怎么做」的流程，agent 提供「自主性和循环」去执行它。两者是**组合**关系。

---

## 6. 回到这个文件：skill 流程在哪

就是 `SystemMessage` 里**写「工作流程 1/2/3」的那几行**（第 45-54 行），尤其是：

```js
new SystemMessage(`你是一个代码助手，可以使用工具读取文件并解释代码。

工作流程：
1. 用户要求读取文件时，立即调用 read_file 工具   ← 这就是 skill 的「流程」部分
2. 等待工具返回文件内容
3. 基于文件内容进行分析和解释

可用工具：
- read_file: 读取文件内容（使用此工具来获取文件内容）
`),
```

对照 skill 三个标志：

| skill 标志           | 对应部分                    |
| -------------------- | --------------------------- |
| 流程性知识（怎么做） | 「工作流程 1/2/3」几行 ✅   |
| 可用能力清单         | 「可用工具：- read_file…」 |
| 角色设定             | 「你是一个代码助手…」      |

其中真正算 **skill 流程**的，就是「**工作流程：1…2…3…**」那三行——告诉模型「遇到这种任务该按什么步骤走」，这正是 skill 的核心：**一段可复用的、步骤化的方法论**。

但它只是「半个 skill」，因为缺了关键一条：**「按需加载」**。现在它是写死在每次对话开头的，不管用户问什么，这段流程都在。

什么时候「升级成真 skill」：当能**根据任务动态拼这段话**的时候——

- 用户问「读代码」→ 才加载「读代码流程」
- 用户问「写测试」→ 换成「写测试流程」
- 用户问「修 bug」→ 换成「调试流程」

把现在这一大段 `SystemMessage` 拆成几个**小片段**，按需取用——那时候每个片段就是一个真 skill。

> 你文件里的 skill 流程 = `SystemMessage` 里那三行「工作流程 1/2/3」。它现在是个**常驻的、写死的迷你 skill**；等它长到需要按任务切换时，就该拆成多个按需加载的真 skill 了。

---

## 7. 这个文件的整体定位

`src/tool-file-read.mjs` 其实已经是个**最小 agent**了：

- `SystemMessage`（第 45 行）→ 扮演了一个**迷你 skill**（给了流程 1/2/3）
- `readFileTool`（第 22 行）→ **tool**（真正的能力）
- `while` 循环（第 63 行）→ **agent 的自主循环**

所以这个文件 = skill(流程) + tool(能力) + loop(自主) = 一个麻雀虽小五脏俱全的 agent。

### 整体流程图

```
用户请求
   │
   ▼
[问模型] ──► 模型要调工具？ ──否──► 输出最终回复 ✅ 结束
   │
   是
   │
   ▼
[程序执行工具] ──► [结果塞回 messages] ──► [再问模型] ──► (回到上面判断)
```

### 给新手的几个关键提醒

1. **`description` 是给模型看的说明书**，写清楚「什么情况下用这个工具」比写代码本身更重要。
2. **`messages` 数组是 agent 的记忆**，每轮只追加、不删改，模型靠它理解上下文。
3. **`tool_call_id` 必须配对**，漏了或对不上，OpenAI 兼容接口会直接报错。
4. **错误也要喂回模型**（第 81 行），别直接 `throw`，否则循环断掉、用户体验差。
5. **这个循环是「手写版」**，生产里一般用 LangChain 的 `AgentExecutor` 或更上层抽象，但手写一遍能让你彻底理解 agent 在干嘛——这步功夫不白花。

---

## 8. 下一步可做

- 加一个「写文件」工具
- 把 `while` 抽成一个可复用的 `runAgent()` 函数
- 把 `SystemMessage` 拆成多个按需加载的真 skill
