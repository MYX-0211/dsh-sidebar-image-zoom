[English](README.en.md) · **简体中文**

# dsh-sidebar-image-zoom

DSH 右侧边栏的图片查看器：**滚轮以光标为锚点缩放 + 拖拽平移**。

DSH 内置的图片面板只会把位图缩放到适应面板，就到此为止。它唯一的控件是一条 `+` / `−` / `适应窗口` 浮条，鼠标不挪到底边根本不出现；而且缩放始终以面板中心为锚点，你正在看的地方不会跟着你走。**完全没有拖拽平移。** 本插件直接顶替掉这个渲染器。

![在侧边栏里放大查看一张图](docs/screenshot-zoom.png)

## 手势

| 手势 | 效果 |
| --- | --- |
| 滚轮 | 缩放，锚定在光标下的那个像素 |
| 拖拽 | 平移——用 pointer capture，光标可以中途移出面板 |
| 双击 | 在 适应窗口 ⇄ 1:1 之间切换 |
| `F` / `Esc` | 适应窗口 |
| `1` | 100% |
| `+` `-` `=` `_` | 以中心为锚点步进缩放 |
| 底部控制条 | 常驻显示：`适应窗口` · `1:1` · `−` · 百分比 · `+` |

百分比读数跟着实时比例走。自己滚出来的缩放归你自己：**面板尺寸变化不会把它重置**，只有点「适应窗口」或换一张图才会回到适应。

![拖拽平移](docs/screenshot-pan.png)

## 安装

插件没有发布到 npm，所以 DSH 的 *插件 → 添加插件* 流程（它按 registry 规格解析包名）找不到它。把仓库克隆到 profile 旁边，然后手动 stage——Windows 上可以直接用仓库自带的脚本。

```bash
git clone https://github.com/MYX-0211/dsh-sidebar-image-zoom.git
```

然后把包放到你的 profile 能解析到的位置（一般是 `<profile>/node_modules/dsh-sidebar-image-zoom/`），在 profile 的 `package.json` 里同时加进 `dependencies` 和 `dsh.profile.bundles`，重启 DSH。

`install.ps1` / `uninstall.ps1` 就是替你做完这些事（针对标准 profile 路径），底层是 `tools/manifest_edit.py`。那个脚本**逐行编辑** manifest 而不是做 JSON round-trip，所以没被碰过的部分格式原样保留；每次写盘前都会先落一个带时间戳的 `package.json.bak-*`。

```powershell
# Windows：如果执行策略拦 .ps1，用这种方式读取并执行
Invoke-Expression ([IO.File]::ReadAllText(".\install.ps1", [Text.Encoding]::UTF8))
Invoke-Expression ([IO.File]::ReadAllText(".\uninstall.ps1", [Text.Encoding]::UTF8))
```

两个方向都是幂等的；卸载 → 重装的往返比对过，与原始 manifest **逐字节相同**。

**DSH 在 boot 时加载插件，所以装完要重启一次。**

## 接管原理

DSH 允许插件通过 `ctx.documentPreviews` 认领某种文件的渲染器。匹配排序是

```js
right.rank - left.rank || right.length - left.length || left.order - right.order
```

其中 `rank` 为 `priority === "builtin" ? 0 : 1`。内置位图查看器用 `priority: "builtin"` 注册自己，所以**任何别的 priority 值都排在它前面**。本插件用 `priority: "extension"` 注册同样的后缀列表，于是直接接管图片面板——不用配置，也不给用户留开关。

正文必须注册进 keyed 子槽 `sidebar.right.tab.document`，且 key 与注册表 id 完全一致，因为宿主是用 `entryKey: selected.id` 反查的：

```js
ctx.documentPreviews.register({ id: BODY_ID, extensions, binaryExtensions,
                                priority: "extension", loading: "bytes-complete" })
ctx.slots.inject("sidebar.right.tab.document", () =>
  ctx.slots.register({ name: "sidebar.right.tab.document", key: BODY_ID }, Body))
```

两个容易写错的点：

- `binaryExtensions` 必须是 `extensions` 的子集，而且 SVG **故意**不放进 `binaryExtensions`，这样纯文本渲染器仍然可以用来读矢量源码。
- 两处注册都由 `ctx.effect` 持有，正文外面套了 error boundary。渲染器抛错会把**整个侧栏面板**变空白，而不只是当前标签页——这个 boundary 把它变成一条提示，并保留标签页顶部的渲染器下拉菜单作为退路。

没有构建步骤。`lib/client.js` 是手写的，通过 `window.__ModuleLoader__.load` 自注册；只依赖 `react`，由宿主提供。

出错时降级为提示而不是空面板：字节不匹配任何已知签名、后缀承诺的格式与实际字节不符、以及标签页还没拿到内容，各自显示自己的短提示。

## 文件

| 路径 | 作用 |
| --- | --- |
| `lib/client.js` | 插件全部实现（浏览器半） |
| `lib/index.js` | 空的宿主半——只为满足 bundle 契约 |
| `cordis.patch.yml` | 挂载用。`id` 必须保持 `sidebar-image-zoom`——同一个包挂两次会让整棵插件树 boot 失败 |
| `tools/manifest_edit.py` | 逐行的 profile manifest 编辑器 |
| `install.ps1`、`uninstall.ps1` | stage 包并改写 manifest |
| `test/build-harness.mjs` | 生成自包含的 harness 页面 |
| `test/verify.mjs` | 用真实浏览器驱动那个页面 |

## 测试

套件把 `lib/client.js` **原文**载入一个只伪造 DSH 自己那部分的页面——`window.__ModuleLoader__`、`require`、以及一个记录型 cordis 上下文——然后挂载注册好的正文，用真实的鼠标与滚轮事件通过 Edge 或 Chrome 驱动它。测试图在运行时用 canvas 画出来，所以**不提交任何二进制 fixture**。

```bash
npm install
npm test
```

用 `puppeteer-core` 而不是 `puppeteer`，是为了让安装 devDependency 时不要再拖一个 Chromium 下来。运行器按 `PUPPETEER_EXECUTABLE_PATH` → Edge/Chrome 常见路径 → Linux/macOS 常见路径的顺序找一个浏览器。你的浏览器在别处就显式指过去：

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npm test
```

完整一轮是 30 条断言。最能说明问题的是这两条：

```
PASS  zoom is anchored at the cursor            — image point under cursor moved 0.00px
PASS  drag pans by the pointer delta            — moved (-140.0, -90.0), expected (-140, -90)
```

它同时断言注册契约（认领的后缀、`binaryExtensions` ⊆ `extensions`、`priority !== "builtin"`、`loading: "bytes-complete"`、槽位 key === 注册表 id、两处注册都由 effect 持有）、控制条、从固定前置状态出发的双击切换、损坏文件报解码失败而不是留空面板、回退提示留在本面板内、以及 console 干净。

## 兼容性

针对 DSH `0.2.0-rc.2`、`desktop` profile 构建并测试。它伸手进了 DSH 内部——槽位名、注册表结构、以及 `builtin` 的 rank 语义——所以 DSH 任何一次改动都可能让它失效。失效的表现是侧栏面板变空白，处理方式是禁用该 bundle 后重新加载；这个故障不会拖垮其余 UI。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
