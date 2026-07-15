# 第 3 课：让 Node 执行系统 shell 命令（spawn / child_process）

> 30 行代码，让 Node 跑起 `ls -la`。这是 agent 第一次拥有「真实副作用」——不只是读文件、输出文字，而是能驱动操作系统。

---

## 1. 核心认知

### 1.1 spawn 不是「调函数拿返回值」，是「注册回调等事件」

前端工程师的直觉：`const result = await fetch(url)` —— 调一下，等一个返回值。

`spawn` 完全不是这个模型。`spawn(...)` 返回的不是一个「命令的结果」，而是一个 **ChildProcess 对象**——进程刚启动，结果还没产生。你要拿到结果，得**监听它的事件**：`child.on('close', ...)`、`child.on('error', ...)`。

这更像前端的 `addEventListener`：

|            | 前端直觉（错）                   | 实际（对）                          |
| ---------- | -------------------------------- | ----------------------------------- |
| 心智模型   | `const out = run('ls')` 拿返回值 | `child.on('close', cb)` 注册回调    |
| 类比       | `await fetch()`                  | `btn.addEventListener('click', cb)` |
| 结果何时来 | 同步/await 立刻有                | 异步，事件触发时才有                |

**一句话**：spawn 是「点火 + 装监听器」，不是「调一下拿结果」。命令什么时候跑完、跑没跑成功，全靠事件告诉你。

### 1.2 这是 agent 获得真实副作用能力的起点

L1/L2 的 agent 只会「读文件 / 输出文字」，碰不到操作系统。一旦能 spawn shell，agent 就能：装软件、改文件、跑测试、起服务、部署……能力边界一下从「文本世界」扩到「整个机器」。

> 威力大 = 危险大。这课的代码 30 行就能让 Node 删库（`rm -rf`），所以第 5 节的安全部分要认真看。

---

## 2. 逐段拆解

### ① 导入 spawn（第 1 行）

```js
import { spawn } from "node:child_process";
```

`child_process` 是 Node 内置模块，专门「从 Node 里生一个子进程」。`spawn` 是其中最底层的一个 API——另外两个（exec / execFile）都是它的上层封装（见第 4 节）。

### ② 定义命令 + 工作目录（第 3-4 行）

```js
const command = "ls -la";
const cwd = process.cwd();
```

- `command`：要跑的命令字符串。这里写死成 `ls -la`（列当前目录）。
- `cwd`：子进程的工作目录。`process.cwd()` 取的是**父进程**（你这个 Node 脚本）的当前目录，传给子进程，让它在同一个目录下跑。不传的话子进程也默认继承父进程的 cwd，这里显式传是为了「可控制」——以后能让 agent 指定在哪个目录跑命令。

### ③ 解析命令和参数（第 5-6 行）

```js
const [cmd, ...args] = command.split(" ");
```

把 `"ls -la"` 拆成 `cmd = "ls"`、`args = ["-la"]`。spawn 的签名是 `spawn(cmd, args, options)`，所以要拆开。

**这是全文件最脆的一行**：`split(" ")` 是个极其朴素的解析器，遇到带空格的参数（`echo "hello world"`、`cat "my file.txt"`）会直接断成错乱的样子。带引号、带转义全处理不了。见第 5 节踩坑。

### ④ spawn 启动子进程 + options（第 8-12 行）

```js
const child = spawn(cmd, args, {
  cwd,
  stdio: "inherit",  // 实时输出到控制台
  shell: true,
});
```

三个 option 各有讲究：

- `cwd`：见上。
- `stdio: "inherit"`：子进程的输入输出**直接复用父进程的**（也就是你的终端）。`ls` 的输出会直接打到你的屏幕上，不用你自己读。详见第 3 节。
- `shell: true`：不直接执行 `ls` 这个二进制，而是**先起一个 shell**（macOS/Linux 是 `/bin/sh`），让 shell 去解释这条命令。好处是能用管道、通配符（`ls *.js`、`a && b`）；坏处是**命令注入风险**（见第 5 节）。

`spawn` 一调用，子进程**立刻就启动了**（不像 exec 要等回调）。返回的 `child` 是个 ChildProcess 对象，本身是个 EventEmitter——后面两行 `.on(...)` 就是往它上面挂监听器。

### ⑤ 闭包变量 errorMsg（第 14 行）

```js
let errorMsg = "";
```

一个定义在外层、用 `let` 声明的空字符串。它的作用是**在两个独立事件之间传话**：`error` 事件先触发时把错误信息写进去，`close` 事件后触发时再读出来。为什么必须这么绕，见第 3 节。

### ⑥ error 事件监听（第 16-18 行）

```js
child.on("error", (error) => {
  errorMsg = error.message;
});
```

`error` 事件 = **进程根本没起来**（比如 shell 二进制都找不到、没权限 spawn）。注意它不处理「命令跑失败了」——那是 `close` 的事。这里只把错误信息暂存到 `errorMsg`，不直接退出，留给 `close` 统一收尾。

### ⑦ close 事件监听 + 退出逻辑（第 20-29 行）

```js
child.on("close", (code) => {
  if (code === 0) { process.exit(0); }
  else {
    if (errorMsg) { console.error(`错误: ${errorMsg}`); }
    process.exit(code || 1);
  }
});
```

`close` = 进程结束 + 所有 stdio 流都关闭了，是「彻底完事」的可靠信号。`code` 是退出码：0 = 成功，非 0 = 失败。

- 成功（code === 0）→ `process.exit(0)`，让这个 Node 脚本也以成功退出。
- 失败 → 如果有 `errorMsg`（说明是 spawn 阶段就挂了），打印出来；然后 `process.exit(code || 1)` 退出。`code || 1` 是兜底：万一 code 是 null（拿不到退出码），就用 1 退出，保证不会误判成成功。

**为什么不在 error 里直接退出、要绕到 close？** 因为 close 是「唯一一定会触发」的终结事件（error 之后也会触发 close）。把退出逻辑统一放在 close，能保证「无论成功失败，只走一条收尾路径」，不会出现 error 退一次、close 又退一次的竞争。

---

## 3. 关键机制详解

### 3.1 spawn 的事件流：为什么需要 error 和 close 两个事件

ChildProcess 是个 EventEmitter，关键事件有三个：

- `error`：**进程没能启动**（spawn 本身失败）。只在 spawn 阶段出问题时触发。
- `exit`：进程退出了，给了退出码。但 stdio 流可能还在（管道里有缓冲没读完）。
- `close`：进程退出 **且** 所有 stdio 流都关闭了。是「彻底结束」的信号。

**为什么需要 error + close 两个，而不是只监听 close？**

因为 close 的 `code` 在 spawn 失败时不可靠（可能是 null 或非零，但**给不出原因**）。`error` 事件才带具体的错误信息（`ENOENT`、`EACCES` 之类）。所以这课的做法是：

1. `error` 触发 → 把 `error.message` 存进 `errorMsg`（只存不退）。
2. `close` 触发 → 读 `errorMsg`，结合 `code` 统一决定怎么退。

**时序图：**

```
正常成功：
spawn() ──► [shell 起来跑 ls] ──► stdout 流 ──► exit(code=0) ──► close(code=0)
                                                              │
                                                              └─► process.exit(0)

命令不存在（shell:true 下）：
spawn() ──► [shell 起来，但 ls 找不到] ──► shell 退出码 127 ──► close(code=127)
   （没有 error 事件！shell 自己起来了，只是命令没找到）              │
                                                                   └─► errorMsg 为空
                                                                       只 exit(127)

spawn 本身失败（极少见，如 /bin/sh 都没有）：
spawn() ──► error 事件(存 errorMsg) ──► close(code=null/非0)
                │                              │
                └──── errorMsg = "spawn ..." ──┘─► 打印 errorMsg + exit(1)
```

**关键反直觉点**：`shell: true` 时，「命令找不到」**不会**触发 `error` 事件——因为 shell 这个进程是成功起来的，只是它内部跑的命令没找到，shell 自己用退出码 127 表示失败。`error` 只在「连 shell 都起不来」时才触发。所以别指望靠 `error` 事件捕获「命令写错了」。

> 监听 `close` 而不是 `exit`：`exit` 触发时 stdio 管道里可能还有没读完的输出，`close` 保证所有流都关闭了、输出都读完了。用 `close` 才不会丢输出。

### 3.2 stdio 三种模式：pipe / inherit / ignore

`stdio` 选项控制子进程的标准输入/输出怎么接。三种模式：

**pipe（默认）**：子进程的 stdio 通过管道连到父进程。父进程要去读 `child.stdout`（一个可读流）才能拿到输出。

```
pipe 模式：
子进程 stdout ──► [管道] ──► child.stdout(可读流) ──► 父进程监听 'data' 事件收集
                                  你能拿到内容 → 能喂回模型
```

**inherit**：子进程直接复用父进程的 stdio（共享同一个终端）。输出直接打到你的屏幕，你不用管。

```
inherit 模式：
子进程 stdout ──► 直接复用 ──► 父进程的 stdout(你的终端)
                                  实时打到屏幕，但你拿不到内容
```

**ignore**：接到 `/dev/null`，丢弃。

```
ignore 模式：
子进程 stdout ──► /dev/null(丢弃)
```

**对比表：**

| 模式         | 父进程能拿到输出吗      | 要自己读流吗       | 典型场景               |
| ------------ | ----------------------- | ------------------ | ---------------------- |
| pipe（默认） | 能，自己读 child.stdout | 要，监听 data 事件 | agent 要把输出喂回模型 |
| inherit      | 不能，直接打到屏幕      | 不用管             | 人看输出 / 调试        |
| ignore       | 不能，丢弃              | 不用管             | 不关心输出             |

**这课为什么用 inherit？** 省事——`ls -la` 的输出直接打到屏幕，人能立刻看到，不用写一堆「读流 + console.log」的样板代码。

**但 inherit 有代价**：你**拿不到输出内容**。输出直接进了终端，不在你的 Node 变量里。如果以后要把这段包成 agent 的工具（让模型看到命令输出），inherit 就不行了——得换回 pipe，自己收集 stdout 喂回模型。这是下一步练习要解决的。

---

## 4. 概念辨析

### 4.1 spawn vs exec vs execFile

`child_process` 三个 API，都是生子进程，差别在「怎么给命令」和「怎么拿输出」：

|            | spawn                          | exec                               | execFile                     |
| ---------- | ------------------------------ | ---------------------------------- | ---------------------------- |
| 返回       | ChildProcess（流式，立刻返回） | Promise/回调（一次性缓冲）         | Promise/回调（一次性缓冲）   |
| 输出       | 流式，边跑边出                 | 全部缓冲到内存，跑完一次性给       | 全部缓冲到内存，跑完一次性给 |
| 默认 shell | false                          | true（走 shell）                   | false                        |
| 缓冲上限   | 无                             | 有（maxBuffer 默认 1MB，超了报错） | 有                           |
| 适合       | 大输出 / 长跑 / 实时           | 命令字符串 + 管道 + 少量输出       | 跑某个文件、参数数组         |

**记忆点**：spawn 是「最底层、流式、不缓冲」；exec/execFile 是「上层封装、一次性给你全部输出」。exec = 走 shell 的 execFile；execFile = 不走 shell 的 spawn + 缓冲。

> 这课用 spawn 而不用 exec，是因为 spawn 能流式 + 不受 1MB 缓冲限制——agent 跑命令时输出可能很大（比如 `ls -la` 一个大目录、`npm install` 的日志），用 exec 容易被 maxBuffer 截断报错。

### 4.2 error 事件 vs close 事件

|              | error 事件                         | close 事件                                 |
| ------------ | ---------------------------------- | ------------------------------------------ |
| 何时触发     | 进程**没能启动**（spawn 本身失败） | 进程结束 **且** stdio 流都关闭             |
| 触发顺序     | 先（如果发生）                     | 后（**无论成功失败都会触发**，是终结信号） |
| 带退出码吗   | 不带（进程没起来，没码）           | 带 code                                    |
| 单独监听够吗 | 不够，不知道正常结束               | 不够，spawn 失败时拿不到具体原因           |
| 本课用法     | 存 errorMsg                        | 读 errorMsg + 用 code 决定退出码           |

**结论**：两个都要监听。error 负责「spawn 失败的原因」，close 负责「最终结果 + 退出」。两者配合才完整。

---

## 5. 踩坑提醒

### 5.1 `shell: true` 是命令注入的大门

`shell: true` 意味着命令字符串会**经过 shell 解释**，shell 会识别 `;`、`&&`、`|`、`$()`、反引号这些元字符。

如果 `command` 来自用户输入或模型生成，一条 `ls -la; rm -rf ~` 就能把家目录清空。**agent 场景尤其危险**——模型生成的命令如果直接拼进 shell，等于给了模型一个不受限的 shell（在权限范围内想干啥干啥）。

**堵法**：能不用 shell 就不用。用 `shell: false` + **参数数组**（不拼字符串，直接传 `['ls', '-la']`），shell 不参与解释，注入面就没了。代价是失去管道、通配符等 shell 特性——需要时再显式处理。

### 5.2 `split(" ")` 是个玩具解析器

`"ls -la".split(" ")` 对简单命令没问题，但遇到带空格的参数就断：

```
'echo "hello world"'.split(" ")
→ ['echo', '"hello', 'world"']   // 引号被当普通字符，参数断成三段
```

带引号的路径（`cat "my readme.md"`）、带转义、带管道（`a | b`）全处理不了。**别拿它解析真实命令**。正确做法是从一开始就用参数数组，别走「拼字符串再 split」这条路。

### 5.3 只监听 close 会漏掉 spawn 失败的原因

如果你只写 `child.on('close', ...)` 不写 `error`：spawn 失败时，close 的 `code` 可能是 null 或非零，你只知道「失败了」，但**拿不到 ENOENT / EACCES 这种具体原因**——这些信息只在 `error` 事件的 `error.message` 里。

这课的做法（error 存 errorMsg、close 读 errorMsg）就是为了补这个。**两个事件缺一不可。**

### 5.4 `let errorMsg` 闭包捕获是必须的，不是多余

有人会问：为什么不直接在 `close` 里拿错误信息？因为 `error` 和 `close` 是**两个独立的事件回调**，不是同步调用。`error` 先触发，那时 `close` 还没跑；等 `close` 触发时，`error` 回调早已结束、它的局部变量也释放了。

`errorMsg` 定义在外层作用域（spawn 之后、两个回调之外），是个**闭包变量**——两个回调都能访问到同一份。`error` 回调往里写，`close` 回调从里读，靠它「跨事件传话」。

```
[外层 let errorMsg = ""]  ← 两个回调共享这一个变量
        │
   error 回调 ──写──► errorMsg = "spawn ENOENT"
        │
   close 回调 ──读──► if (errorMsg) console.error(...)
```

如果用 `const`（不可变）或定义在回调里（访问不到），这条传话链就断了。所以这里必须是 `let` + 外层定义。

### 5.5 监听 `exit` 而不是 `close` 会丢输出

`exit` 触发时进程退出了，但 stdio 管道里可能还有**没读完的缓冲数据**。如果你在 `exit` 里就 `process.exit()`，子进程还没输出完的尾巴就被截断了。`close` 保证「进程退出 + 所有流关闭」，用 `close` 才不会丢输出。

---

## 6. 下一步

### 6.1 把 `split` 换成安全参数数组，堵住注入

把第 3-6 行从「拼字符串再 split」改成直接传参数数组 + `shell: false`：

```js
const child = spawn("ls", ["-la"], {
  cwd,
  stdio: "inherit",
  shell: false,   // 不走 shell，从源头杜绝注入
});
```

对比改动前后：命令不再经过 shell 解释，`rm -rf` 这种就算混进参数也只会被当成普通字符串参数（找不到叫 `rm -rf` 的文件而报错），不会被当命令执行。这是给 agent 跑命令时的安全基线。

### 6.2 把这段包成 `run_command` 工具，接进 L2 的 agent 循环

目标：让 L2 那个 agent 能自主跑 shell 命令。要做两件事：

1. **封装成工具**：把这段逻辑包进一个 `tool()`，`name: "run_command"`，`description` 写清「执行 shell 命令并返回输出」，`schema` 收一个 `{ command: string }`。
2. **stdio 从 inherit 换成 pipe**：因为 agent 要把输出**喂回模型**，inherit 是直接打到屏幕、拿不到内容的。换成 pipe 后自己监听 `child.stdout` 的 `data` 事件收集输出，拼成字符串 return 出去——这样 L2 的 while 循环就能把命令输出塞进 messages 让模型看到。

> 注意：一旦 agent 能跑命令，第 5.1 节的注入风险就从「理论」变成「现实」——模型生成的命令会真的执行。务必先做 6.1 的安全参数化，再接进循环；或者加白名单（只允许特定命令）、确认机制（危险命令先问人）。
