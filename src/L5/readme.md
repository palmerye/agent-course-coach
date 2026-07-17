# 第 5 课：复用别人的 MCP Server——高德 + 浏览器 + 文件系统

> 背景：前端工程师转 agent 开发。L4 学了「自己写 MCP server」，这课学「**用别人写好的现成 MCP server**」——体会「不写一行 server 代码，连上就能用」的爽感，并做了一个「异常自动截图 + 生成报告」的测试闭环雏形。

---

## 1. 核心认知

### 1.1 这课和 L4 的区别：从「造轮子」到「用轮子」

L4 你手写 `my-mcp-server`，一个 `query_user` 工具写半天。L5 你连了 4 个 server，**3 个是别人写的现成 MCP**（高德、filesystem、chrome-devtools），`npx` 一拉、`url` 一指就跑。29 个浏览器工具、地图能力、文件操作，**一行 server 代码没写**全到手。

这就是 MCP 生态的价值：**别人把能力协议化做了几千行，你连上就用**。像前端 `npm install`——不重复造轮子。

### 1.2 复用现成 MCP 的判断标准

不是所有工具都该用现成的。判断框架：

| 维度 | 适合自己写 | 适合用现成的 |
|---|---|---|
| 数据敏感度 | 数据敏感、不能外流（内部用户表） | 数据本来就要发外部（地图、GitHub） |
| 定制化程度 | 业务特殊、频繁改 | 通用能力（读文件、操作浏览器） |
| 成熟度 | 这领域没现成的 | 已有成熟 MCP 生态 |
| 复用价值 | 只这项目用 | 多项目/多 client 都要用 |

你的 `my-mcp-server`（查内部用户）= 敏感 + 定制 → 自己写。高德地图 = 数据本就外发 + 人家专业 → 用现成。

**关键线：数据外流。** HTTP 传输的 server（如高德）数据会发外部；本地 stdio server 数据不出本机。**敏感数据优先 stdio 本地 server。**

---

## 2. 逐段拆解

### ① 导入与初始化（第 1-19 行）

- `MultiServerMCPClient`：能同时连多个 server（L4 讲过多 server 架构）。
- `fs` / `path`：本课新增，用来把截图 base64 存成 png 文件 + 写报告。
- model 配置走 `.env`。

### ② 配置 4 个 server（第 21-43 行）—— 本课重点

```js
mcpServers: {
  "my-mcp-server": { command: "node", args: [".../my-mcp-server.mjs"] },     // 自己写的，stdio
  "amap-maps-streamableHTTP": { url: "https://mcp.amap.com/mcp?key=..." },  // 高德，HTTP
  filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", ...ALLOWED_PATHS] }, // 官方，stdio
  "chrome-devtools": { command: "npx", args: ["-y", "chrome-devtools-mcp@latest", "--ignore-https-errors"] }, // 第三方，stdio
}
```

四种来源、两种传输，正好覆盖 MCP 的典型形态。逐个看配置要点：

- **`my-mcp-server`**：L4 自己写的，`command: "node"` + 路径，stdio 传输。
- **高德**：`url` 而非 `command` → **HTTP 传输**，server 跑在高德云端，不用本地启动。要 `AMAP_MAPS_API_KEY`。
- **filesystem**：`npx -y @modelcontextprotocol/server-filesystem` + `ALLOWED_PATHS` 白名单路径。`-y` 自动确认下载（agent 场景必须加，否则卡在等确认）。
- **chrome-devtools**：`npx -y chrome-devtools-mcp@latest --ignore-https-errors`。`--ignore-https-errors` 是本课踩坑后加的——内网自签证书不加会报 `ERR_CERT_AUTHORITY_INVALID`。

### ③ `ALLOWED_PATHS` 的展开 + 兜底（第 32-35 行）

```js
args: [
  "-y",
  "@modelcontextprotocol/server-filesystem",
  ...(process.env.ALLOWED_PATHS.split(",") || []),   // 展开白名单路径
],
```

- `ALLOWED_PATHS` 是 filesystem server 的**允许访问目录白名单**——这个 server 只能在这些路径下读写，路径外一律拒绝。安全机制。
- `.split(",")` 把 `"/a,/b"` 拆成 `["/a","/b"]`，`...` 展开到 args。
- `|| []` 兜底：没配时 `undefined.split` 会崩，`|| []` 退化成空数组至少不炸。
- **小坑**：空字符串 `""` 时 `"".split(",")` 返回 `[""]`（不是空数组），`||` 不触发，会传个空路径。更稳是先判空再 split。

### ④ 发现工具 + 读资源（第 45-56 行）

```js
const tools = await mcpClient.getTools();        // 所有 server 的工具摊平成一个数组
const modelWithTools = model.bindTools(tools);   // 一起绑给模型
const res = await mcpClient.listResources();    // 列资源
// ... 遍历读资源内容，塞进 resourceContent
```

- `getTools()` 把 **4 个 server 的所有工具**拉成一个扁平数组，server 边界对模型透明。
- 资源读取逻辑和 L4 一样，读出来塞 `SystemMessage` 当背景。

### ⑤ 截图 + 报告的辅助函数（第 68-107 行）—— 本课扩展

```js
function extractImageBlocks(result) { ... }      // 从工具返回值提取图片 base64
async function captureScreenshot(tools, label) {  // 调 take_screenshot，存 png，返回文件名
  const shotTool = tools.find((t) => t.name === "take_screenshot");
  const result = await shotTool.invoke({});
  const images = extractImageBlocks(result);
  const base64 = img.data || img.image_url?.url?.split(",")[1] || "";
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));  // base64 存成二进制 png
  return fileName;
}
```

**关键认知**：`take_screenshot` 返回的是 **base64 图片数据**（不是文件路径）。要导出图片，得用 `fs.writeFileSync` + `Buffer.from(base64, "base64")` 把 base64 存成二进制 png。MCP 工具链处理二进制图片不顺手，**「存二进制图」用代码做，比 MCP 顺手**。

### ⑥ agent 循环 + 异常截图（第 109-166 行）—— 本课核心改造

```js
for (let i = 0; i < maxIterations; i++) {
  const response = await modelWithTools.invoke(messages);
  messages.push(response);
  lastFinalReply = response.content;   // 每轮存最新回复，maxIterations 兜底用

  if (没有 tool_calls) {
    await generateReport(...);  // 正常结束出报告
    return;
  }

  for (const toolCall of response.tool_calls) {
    try {
      toolResult = await foundTool.invoke(toolCall.args);
    } catch (e) {
      // 工具抛异常 → 记录 + 自动截图
      const shot = await captureScreenshot(tools, `${toolCall.name}-${i+1}`);
      incidents.push({ step: i+1, toolName: toolCall.name, error: e.message, screenshot: shot });
      toolResult = `工具调用失败：${e.message}。已自动截图存证。`;  // 错误喂回模型
    }
    messages.push(new ToolMessage({ content: toolResult, tool_call_id: toolCall.id }));
  }
}
// maxIterations 兜底：用 lastFinalReply（不能引用循环内 response，作用域已出）
await generateReport(query, lastFinalReply, incidents);
```

三个关键改造点：
1. **`try/catch` 包工具调用**：失败不崩，错误变字符串喂回模型（L2 讲过的点，多 server 场景更关键）。
2. **失败时自动截图**：`captureScreenshot` 存 png，记进 `incidents`。
3. **`incidents` 提到模块级**：这样崩溃兜底也能读到已收集的异常。

### ⑦ 崩溃兜底 + 报告生成（第 168-231 行）

```js
try {
  await runAgentWithTools(testQuery);
} catch (e) {
  // LLM 429 限流等中途崩溃 → 兜底出报告
  const crashReply = `${lastFinalReply}\n\n> ⚠️ 执行中途中断：${e.message}`;
  await generateReport(testQuery, crashReply, incidents);  // incidents 是模块级，能读到
}
await mcpClient.close();
```

`generateReport` 生成 md：含任务、结果、AI 回复、**异常清单 + 截图 markdown 引用**（`![异常截图](xxx.png)`）。任何 md 预览器打开，图文一体渲染。

---

## 3. 关键机制详解

### 3.1 stdio vs HTTP：传输方式由「能力在哪」决定

| | stdio（command+args） | HTTP（url） |
|---|---|---|
| server 代码在哪跑 | **本机**（spawn 子进程） | **云端**（外部服务器） |
| 数据经过哪 | 本机进程间管道，不出机器 | 公网 |
| 启动方式 | client spawn 出 server | 不用启动，指 url |
| 适合 | 操作本机能力（文件、浏览器、本地 DB） | 远程服务（地图、第三方 API） |
| 本课例子 | filesystem / chrome-devtools / my-mcp-server | 高德 |

**判断标准：「能力在哪，传输就跟到哪。」** 能力在云端 → HTTP；能力在本机 → stdio。chrome-devtools 用 stdio 是因为要驱动**本机** Chrome；如果有个云端浏览器服务，就会是 HTTP。

### 3.2 危险面 = 能力 × 可达范围（安全边界）

| server | 能碰什么 | 危险面 | 要不要限路径 |
|---|---|---|---|
| 高德 | 只读高德自己的数据 | 小（碰不到你机器） | ❌ |
| filesystem | 你本机文件系统（读写删） | 大 | ✅ 白名单 |
| chrome-devtools | 本机浏览器 + 文件 | 大 | ✅ 限制临时目录 |

**本质**：高德是远程服务，碰不到你机器，危险面小不用限。filesystem/chrome-devtools 是本地进程，有本机权限，**能力越强越要圈养**——用白名单收窄可达范围。

**安全原则**：危险面 = 能力 × 可达范围。能力强（能碰本机）的 server，必须收窄可达范围；能力弱（只给数据）的不用限。这和浏览器给网页「默认最小权限 + 按需授权」是同一套逻辑。也呼应 L3：`node_exec` 能执行任意命令（危险面最大），接进 agent 必须做白名单/沙箱。

### 3.3 错误处理：agent 自主性的来源

**throw**：错误冒泡，循环崩，模型不知道发生了什么，没机会反应。
**喂回错误字符串**：模型收到「工具失败：xxx」反馈，能基于反馈调整下一步。

模型收到失败后能做的：换策略重试（重新 snapshot 找新 uid）、降级处理、报告放弃、诊断问题（截图看为啥失败）。**这四种反应只有喂回错误才做得了——throw 等于剥夺 agent 自主性。**

> **agent 的自主性 = 基于「反馈」调整下一步的能力。** 没有反馈（throw 掉了），就没有自主性，就只是个脆脚本。反馈越完整（错误 + 截图 + console 日志），模型调整越准。

本课改造本质：**给 agent 的「感知-决策-行动」闭环补全「感知」环**——失败时先感知到发生了什么，才能决策怎么办。

### 3.4 多 server 协作：靠 description 路由，server 边界对模型透明

模型靠什么分配「查地点用高德、写文件用 filesystem」？**靠每个工具的 description 匹配语义**。

- `getTools()` 把所有 server 工具摊平成一个数组，一起 `bindTools`。
- 模型看到的不是「4 个 server」，而是「一堆带 description 的工具」。
- query「杭州南站在哪 + 生成文档」→ 「查地点」命中高德 description，「写文件」命中 filesystem description。

**机制从头到尾没变**：L2 手写 1 个工具靠 description，L5 自动拉一堆工具还是靠 description。变的是「工具从哪来、有多少」。

**多 server 的坑**：工具多了，description 模糊容易撞车（两个都能写文件 → 模型可能选错）。多 server 时 **description 精度要求更高**，要写清差异（如「写到指定路径」vs「写到临时目录」）。

### 3.5 chrome-devtools 的 29 个工具（6 类）

| 类 | 工具 | 干啥 |
|---|---|---|
| 导航 | navigate_page / new_page / select_page / close_page / list_pages | 开/关/切页面 |
| 交互 | click / hover / drag / fill / fill_form / type_text / press_key / upload_file / handle_dialog | 像人一样操作页面 |
| 内容获取 | **take_snapshot** / take_screenshot / take_heapsnapshot / wait_for | 让 AI「看见」页面 |
| 调试 | list_console_messages / list_network_requests / evaluate_script / emulate | DevTools 本职能力 |
| 性能 | performance_start/stop_trace / lighthouse_audit | 性能测试 |
| 其他 | resize_page | 测响应式 |

**`take_snapshot` vs `take_screenshot`**（最易混）：
- `take_snapshot`：读页面 **a11y 树**，产出**文本**，便宜、准、AI 首选。模型靠它读页面结构（元素、文字、禁用状态）。
- `take_screenshot`：截**像素图** PNG，贵、看渲染效果。snapshot 读不到的视觉信息靠它。

AI 浏览器自动化 = snapshot 理解内容 + screenshot 看视觉 + click/fill 操作。

---

## 4. 概念辨析

### 4.1 本课 4 个 server 对比

| server | 谁写的 | 传输 | 危险面 | 要 Key | 能力 |
|---|---|---|---|---|---|
| my-mcp-server | 自己（L4） | stdio | 中（本机 DB） | 无 | 查用户 |
| 高德 | 高德官方 | HTTP | 小（远程只读） | AMAP_MAPS_API_KEY | 地图/路线 |
| filesystem | MCP 官方 | stdio | 大（本机文件） | 无 | 读写文件（白名单） |
| chrome-devtools | 第三方 | stdio | 大（浏览器+文件） | 无 | 29 个浏览器工具 |

### 4.2 take_snapshot vs take_screenshot

| | take_snapshot | take_screenshot |
|---|---|---|
| 产出 | 文本（a11y 树） | 图片（PNG） |
| 模型怎么用 | 直接读文本 | 当图片输入（需多模态） |
| 成本 | 低 | 高 |
| 拿文字内容 | ✅ 准 | ❌ 靠视觉识别可能错 |
| 拿布局/颜色 | ❌ | ✅ |

### 4.3 复用 vs 自建 MCP server

| | 自己写 server | 用现成 server |
|---|---|---|
| 适合 | 敏感数据、业务定制、无现成 | 通用能力、成熟生态、数据本就外发 |
| 成本 | 写 + 维护 | `npx`/`url` 一连 |
| 灵活 | 完全可控 | 受限于 server 提供方 |
| 例子 | my-mcp-server | 高德/filesystem/chrome-devtools |

---

## 5. 踩坑提醒

1. **自签证书要加 `--ignore-https-errors`** —— 内网 HTTPS 不加会 `ERR_CERT_AUTHORITY_INVALID`，`new_page` 直接失败。
2. **工具失败要 `try/catch`** —— 不包就崩，agent 循环断。错误变字符串喂回模型，让它能调整。这是 L2 讲过的点，多 server 更关键。
3. **`take_screenshot` 返回 base64 不是文件** —— 要导出图片得用 `fs.writeFileSync` + `Buffer.from(base64,"base64")` 存二进制 png。MCP 处理二进制图片不顺手，存图用代码。
4. **崩溃兜底要能读到中间状态** —— `incidents`/`lastFinalReply` 提到模块级，否则 `catch` 里拿不到崩溃前已收集的异常，白收集。
5. **作用域陷阱** —— 循环内 `const response` 出不了循环，maxIterations 兜底不能引用它，得用提前存好的 `lastFinalReply`。
6. **高德免费 Key 会限流**（`CUQPS_HAS_EXCEEDED_THE_LIMIT`）—— 并发超限，等额度恢复或换轻量 query。
7. **LLM 本身也会限流**（429 `limit_burst_rate`）—— agent 循环每轮调模型太快会撞频率限制，可加 sleep 降速。
8. **`npx` 一定加 `-y`** —— 否则卡在「等用户确认下载」，子进程永远不返回。
9. **`mcpClient.close()` 别忘** —— 否则 server 子进程残留占内存。
10. **MCP Roots 能力没协商** —— LangChain client 默认不启用，filesystem 退回用 args 白名单，chrome-devtools 退回限制临时目录。不影响跑，只是文件能力收窄。

---

## 6. 和前面课程的关系

```
L2  本地 tool（read_file）         手写 1 个工具，靠 description 命中
   ↓
L3  spawn 执行命令（node_exec）     一次性跨进程，危险面最大要沙箱
   ↓
L4  自己写 MCP server（query_user） 跨进程 + JSON-RPC，单 server
   ↓
L5  复用别人的 MCP server          多 server 摊平，靠 description 路由，stdio/HTTP 两种传输
```

L2 学「tool 靠 description」，L3 学「spawn 跨进程 + 安全边界」，L4 学「自己写 MCP server」，L5 把它们合成「**复用生态 + 多 server 协作 + 完整测试闭环**」。L5 还顺手做了一个「异常自动截图 + 生成报告」的 AI 测试工具雏形，触及 agent 测试闭环的「④报告」环。

---

## 7. 下一步

- **错误恢复进阶**：`click` 失败时强制重新 `take_snapshot` 刷新 uid 引用，再让模型重试（解决 uid 反复找不到）
- **业务异常覆盖**：现在只抓工具抛错，没抓「页面弹系统繁忙」这种业务异常（要靠 snapshot 文本判断）
- **测试闭环完整化**：加外部触发（cron/CI）补「①触发 ⑦循环」环；加 GitHub MCP 提 issue 补「④报告入库」
- **testing skill 沉淀**：把「打开页面 → 操作 → 查 console/network → 截图 → 写报告」固化成可复用 skill
- **用 Claude Code + skill + MCP** 替代手写 agent loop（Claude Code 本身是强 agent，不用自己写循环）
