# pigai-unblock-paste

> 批改网（pigai.org）作文正文框的粘贴解锁 + 用时上报改写用户脚本。

一个单文件油猴脚本，解决两件事：把被站点拦掉的粘贴（以及右键菜单）放回来，并让自动保存带上去的「输入总时长」变成一个由字数推算出来的合理值。纯前端实现，不改任何请求以外的页面逻辑，卸载即恢复原状。

---

## 目录

- [功能特性](#功能特性)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [配置项](#配置项)
- [工作原理](#工作原理)
- [兼容性](#兼容性)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [已知限制](#已知限制)
- [免责声明](#免责声明)
- [许可](#许可)

---

## 功能特性

| 功能 | 说明 |
| --- | --- |
| 粘贴解禁 | 在 `window` 捕获阶段截断 `paste` / `beforepaste` 事件传播，页面挂的拦截函数收不到事件 |
| Ctrl/Cmd+V 放行 | 单独截断 `keydown` 里的 `Ctrl+V`、`Cmd+V`、`Ctrl+Shift+V`，兼容只拦快捷键的实现 |
| 右键菜单解禁 | 同样方式放行 `contextmenu` |
| 内联属性清理 | 移除 `onpaste` / `onbeforepaste` / `oncontextmenu`，并用 `MutationObserver` 处理动态插入的节点 |
| Alt+V 兜底 | 完全绕开事件链，直接读剪贴板写入焦点框，兼容 `textarea`、`input`、`contenteditable` |
| 用时上报改写 | 在 XHR / fetch 发出前改写 `time=` 字段，只作用于 `saveCaogao2` 与 `postSave` 两个接口 |
| 可选显示同步 | `syncDisplay` 打开后连页面顶部「用时」一起改成同量级 |

关键取舍：**只 `stopImmediatePropagation()`，不 `preventDefault()`**。浏览器的默认粘贴动作不依赖事件传播，所以事件被截断后粘贴照常发生。

## 环境要求

- 浏览器：Chrome / Edge / Firefox / Safari 的现代版本（需要 `MutationObserver`、`navigator.clipboard`）
- 用户脚本管理器，任选其一：
  - [Tampermonkey](https://www.tampermonkey.net/)
  - [Violentmonkey](https://violentmonkey.github.io/)
  - [Userscripts (Safari)](https://apps.apple.com/app/userscripts/id1463298887)
- 无需 Node.js、构建步骤或任何依赖

## 安装

从 GitHub Raw 地址导入：

```text
https://raw.githubusercontent.com/Estrella-Explore/pigaiorg-unblock-paste/main/pigai-unblock-paste.user.js
```

1. 在浏览器地址栏打开上面的 Raw 链接
2. 脚本管理器会拦截 `.user.js` 并弹出安装页，点「安装」
3. 若没有自动弹出，在管理器面板里选择「从 URL 安装 / Install from URL」，粘贴该地址

> **更新**：脚本头部未声明 `@updateURL`，管理器无法自动检查新版。需要更新时重新从 Raw 链接安装一次即可覆盖旧版本，配置项请自行备份。

## 使用

1. 打开 `https://www.pigai.org/` 的作文编辑页，脚本在 `document-start` 阶段即生效
2. 光标点进正文框，正常 `Ctrl+V` 粘贴即可；被拦时用 `Alt+V`
3. 右下角会出现一条轻提示（`已插入 N 字符` / `剪贴板是空的` / `读取剪贴板被拒，请在弹窗里允许`）
4. 控制台可见以 `[pigai-unblock]` 开头的日志，包含每次改写的字数与秒数：

```text
[pigai-unblock] 已启用：Ctrl+V 放行 / 右键放开 / Alt+V 兜底 / 用时改写
[pigai-unblock] 用时改写：352 词 → 1832s（30.5 分钟）
```

### 快捷键

| 快捷键 | 行为 |
| --- | --- |
| `Ctrl+V` / `Cmd+V` | 原生粘贴，脚本只放行不接管 |
| `Ctrl+Shift+V` / `Cmd+Shift+V` | 纯文本粘贴，同样放行 |
| `Alt+V` | 脚本接管：读剪贴板 → 插入焦点框 → 补发 `input` / `change` 事件 |

## 配置项

全部开关集中在脚本顶部的 `CFG` 对象里，改完保存、刷新页面生效。

```js
const CFG = {
  // —— 粘贴 ——
  unblockPaste: true,
  unblockPasteKey: true,
  unblockContextMenu: true,
  stripInlineHandlers: true,
  altVPaste: true,

  // —— 用时上报 ——
  spoofTime: true,
  wpmMin: 8,
  wpmMax: 14,
  jitter: 0.08,
  matchUrls: /a=(saveCaogao2|postSave)/,
  capToElapsed: false,
  syncDisplay: false,

  debug: true,
};
```

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `unblockPaste` | boolean | `true` | 放行 `paste` / `beforepaste`，核心开关 |
| `unblockPasteKey` | boolean | `true` | 放行 `Ctrl/Cmd+V` 的 `keydown` |
| `unblockContextMenu` | boolean | `true` | 放开右键菜单 |
| `stripInlineHandlers` | boolean | `true` | 清理元素内联拦截属性，并持续监听新节点 |
| `altVPaste` | boolean | `true` | 启用 `Alt+V` 兜底粘贴 |
| `spoofTime` | boolean | `true` | 用时上报改写总开关 |
| `wpmMin` / `wpmMax` | number | `8` / `14` | 随机打字速度区间（词/分钟），含思考停顿 |
| `jitter` | number | `0.08` | 在算出的秒数上再叠 ±8% 抖动 |
| `matchUrls` | RegExp | `/a=(saveCaogao2\|postSave)/` | 只匹配这两个接口，其余请求原样放行 |
| `capToElapsed` | boolean | `false` | 为 `true` 时取 `min(算出值, 真实已用时)`，避免声称的时间超过本页停留时长 |
| `syncDisplay` | boolean | `false` | 为 `true` 时同步改写页面顶部显示的「用时」（会看到计时条回跳） |
| `debug` | boolean | `true` | 控制台日志开关 |

### 常用调整

- **想更保守**：`wpmMin` / `wpmMax` 调到 `6` / `9`，时长更接近慢速手打
- **担心时间虚高**：`capToElapsed: true`
- **不想动页面显示**：保持 `syncDisplay: false`（默认）
- **只要粘贴、不要改写**：`spoofTime: false`
- **完全静默**：`debug: false`

## 工作原理

### 1. 粘贴拦截的绕过

站点常见写法是在 `textarea` 或 `document` 上挂 `paste` 监听并 `preventDefault()`。事件流是 `window → ... → target`（捕获）再回到 `window`（冒泡），因此脚本以 `@run-at document-start` 抢在页面脚本之前，在 `window` 的**捕获阶段**调用 `stopImmediatePropagation()`。页面的处理函数永远收不到该事件，而浏览器默认的「把剪贴板内容插入焦点元素」与事件传播无关，粘贴正常完成。

`MutationObserver` 负责动态渲染的表单，避免页面重新挂上内联属性。

### 2. 用时上报的结构

站点侧（`spss.js`）大致逻辑：

```js
function saveData2() {
  cdata.content = encodeURIComponent($('#contents').val());
  cdata.rid = _rid;
  cdata.time = _c_time / 1000;              // 用时，单位秒
  $.post(_self + "?c=ajax&a=saveCaogao2", cdata, ...);
}

function clock_init() { _c_time += 1000; }  // 每秒 +1s，页面顶部「用时」即此值
```

- 触发时机：每次点「保存数据」，以及 `clock_init` 每 **210 秒**自动调用一次 `saveData()`
- 提交接口 `?c=ajax&a=postSave` **本身不带 `time`**，服务端记的是最后一次 `saveCaogao2` 的值
- 刷新页面后服务端会把这个值塞回 `_c_time`（实测：写入 `1472`，刷新后读到 `1482`，即 `1472s` + 刷新耗时）

因此脚本不去改计时器本身，而是在请求出栈前替换 body：

```js
sec = words / wpm * 60 * (1 ± jitter)
sec = max(60, round(sec))
```

352 词的作文落在 25~44 分钟区间。`XMLHttpRequest.prototype.open/send` 与 `window.fetch` 各包一层，只在 URL 命中 `matchUrls` 时改写；`string` / `URLSearchParams` / `FormData` 三种 body 都支持，二进制与 `null` 原样放行。

## 兼容性

| 浏览器 | 状态 | 备注 |
| --- | --- | --- |
| Chrome / Edge (Chromium 90+) | 已验证 | 剪贴板 API 需要页面处于安全上下文（https） |
| Firefox | 可用 | `navigator.clipboard.readText()` 可能弹权限询问，允许后正常 |
| Safari (Userscripts) | 可用 | `execCommand('insertText')` 路径在 `contenteditable` 上更可靠 |
| 移动端浏览器 | 部分可用 | 无物理键盘，`Alt+V` 快捷键不可用，仅事件放行生效 |

匹配范围：`https://www.pigai.org/*`、`http://www.pigai.org/*`、`https://pigai.org/*`。若站点换域名，改 `@match` 与 `matchUrls` 即可。

## 项目结构

```text
pigaiorg-unblock-paste/
├── pigai-unblock-paste.user.js   # 用户脚本本体（单文件，无依赖）
├── README.md                     # 本文档
├── .gitattributes                # 换行符与二进制文件规则
└── .gitignore                    # 通用忽略规则（Python / IDE / 系统 / 日志等）
```

脚本内部按注释分为四段，便于定位：

1. 捕获阶段截断事件，但不取消默认行为
2. 清掉内联属性 & 后续动态插入的元素
3. 兜底：`Alt+V` 用剪贴板 API 直接写入
4. 用时上报改写（XHR / fetch）

## 常见问题

**Q：装好了但粘贴还是被拦？**
先看控制台有没有 `[pigai-unblock] 已启用`。没有说明脚本没跑（`@match` 不匹配或被其他脚本报错打断）；有日志但仍被拦，通常是页面在 `document-start` 之前就内联执行了拦截，试着把管理器设置里的「注入时机」调到最早，或用 `Alt+V`。

**Q：`Alt+V` 提示「读取剪贴板被拒」？**
浏览器要求 https 安全上下文 + 用户手势。地址栏出现剪贴板图标时点允许即可；Firefox 会在弹窗里询问。

**Q：改写的时长看起来太假？**
调 `wpmMin` / `wpmMax`，或开 `capToElapsed` 把上限压到真实停留时间。抖动 `jitter` 不要设成 0，固定值更容易被看出是按公式算的。

**Q：为什么提交接口也要匹配？**
`postSave` 一般不带 `time`，匹配它只是兜底——万一站点某次把 `time` 也塞进提交体，同样能覆盖。匹配不到时脚本原样放行，不会破坏请求。

**Q：刷新后时间又变回去了？**
服务端会把最后保存的 `time` 写回 `_c_time`，这是预期行为。下一次自动保存会按当前字数重新算，不需要手动干预。

**Q：会不会影响页面的自动保存 / 字数统计？**
`Alt+V` 路径会补发 `input` 与 `change` 事件，字数统计、脏检查、自动保存都能感知。原生 `Ctrl+V` 路径由浏览器触发原生事件，页面逻辑不受影响。

## 已知限制

- 只处理 `XMLHttpRequest` 与 `fetch`，若站点改用 WebSocket 或 `sendBeacon` 上报时长，需要另加钩子
- `syncDisplay` 打开后计时条会回跳，视觉上比较明显，默认关闭
- 不处理风控、指纹、行为轨迹类检测，脚本只覆盖事件层与上报字段
- 页面若把正文框放进跨域 iframe（当前没有），`@match` 需要补充 `@match` / `@include` 规则

## 免责声明

本项目仅用于前端技术学习与个人浏览器环境下的可用性研究，作者不对使用后果作任何担保。请遵守所在学校与平台的学术规范，脚本不应被用于规避考核要求。使用即表示你自行承担全部责任。

## 许可

本项目以 [GNU General Public License v3.0](LICENSE) 发布，完整条款见仓库根目录的 `LICENSE` 文件。

你可以自由使用、修改和再分发本脚本；分发衍生作品时须以同样的许可证公开源代码，且不提供任何担保。
