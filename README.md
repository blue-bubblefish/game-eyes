# 游戏之眼（cortico-world-game-eyes）

**这是给 AI 用的，不是给人用的。**

给人的工具是「一个鼠标、一个键盘」；这个不一样——它给 AI 一双眼睛：看得见窗口画面、
读得出屏幕上的字、算得出按钮在哪一格。**「看图、找按钮、算坐标」这些判断由 AI 自己完成，
它只负责伸手和按下去。** 所以它没有脚本宏、没有录制回放、没有一键连招；
那些是给人的，这套是给会看的那个东西的。

## 给 AI 的用法（按这个顺序）

1. `game_windows` —— 先看有哪些窗口。拿到标题关键词或 pid。**别猜标题，先列。**
2. `game_see` —— 抓一帧看现在是什么画面。回执里的 `rect=左,上 宽x高` 就是坐标原点。
3. 在心里把「我要点的那个东西」换算成**窗口内相对坐标**（图左上角 = 0,0）。
4. `game_click(x, y)` 点下去 —— **点图形中心，不要点 tooltip 出现的位置**。
5. 再 `game_see` 一次，确认真的动了。**每一步都要看一眼，不要连着点。**

要读字的时候用 `game_ocr`（回 `x,y,w,h<TAB>文字`，坐标能直接喂给 `game_click`）。
按键优先用 `game_keyv`（硬件级）；`game_key` 只发 WM_CHAR，很多游戏不吃。

**成本要说清楚**：每次 `game_see` 都是一张图，很贵；`game_ocr` 便宜得多。
能读字解决的就别截图。同一个界面别反复看，记住坐标。

## 六个工具

| 工具 | 干什么 |
|---|---|
| `game_windows` | 列出可见的顶层窗口：前台标记、pid、尺寸、位置、类名、标题 |
| `game_see` | 抓某个窗口 → 一张 png 附件；回执带窗口矩形 |
| `game_click` | 在窗口内相对坐标点左键（会移动真实鼠标） |
| `game_key` | 先把窗口切前台，再发一串 SendKeys（只发 WM_CHAR） |
| `game_keyv` | 按一个物理键（`keybd_event`），吃 RawInput 的游戏也认 |
| `game_ocr` | 抓一次画面，用系统 OCR 读字，每行 `x,y,w,h<TAB>文字` |

## 装到别人的机器上（2026-11-26 写）

前提：Windows、Node ≥ 22、已经装了 Coopanion。

1. 把这个 `game-eyes` 文件夹放到任意位置，比如 `D:\worlds\game-eyes`。
2. 打开 `Coopanion\data\extensions`，在那儿开一个终端，跑：
   ```
   pnpm add "link:D:\worlds\game-eyes"
   ```
   用 `link:` 不用 `file:`——`file:` 会把包复制成副本，你改源码它吃不到。
3. 改 `Coopanion\data\home\companion\config.json`，在 worlds 里把 `game-eyes` 设成 `true`，重启 Coopanion。
4. **要操作游戏，Coopanion 自己必须以管理员身份运行**，否则 Windows 的 UIPI 会把点击和按键挡掉。

怎么确认活着：问一句「列一下窗口」，`game_windows` 能回一串窗口就是好了。

## 怎么工作

全部落在 `scripts/game.ps1`：

- 抓屏先试 `PrintWindow(..., 2)`，窗口被盖住也能抓；
- 抓回来抽样判亮度，全黑就退回 `CopyFromScreen`（Unity / 某些全屏游戏必须走这条）。
- 点击按 `GetWindowRect` 换算成屏幕坐标，`SetCursorPos` + `mouse_event`。
- 找窗口：标题包含（不区分大小写）或 pid。

## 已知限制

- **需要管理员权限的窗口点不动**（`SetCursorPos` 会直接失败）——那种只能人去点；反过来，**如果 Coopanion 本身不是管理员，很多游戏也点不动**（Windows 的 UIPI）。玩 3D 游戏前先把 Coopanion 用管理员方式打开。
- 只支持 Windows（`process.platform !== 'win32'` 时激活会被 `preflight` 拒掉）。
- `game_click` 动的是真实鼠标，会跟人抢鼠标玩。
- `game_key` 走 `SendKeys`，发的是一条 WM_CHAR；**吃 RawInput 的 Unity 游戏会直接无视**。那种改用 `game_keyv`（`keybd_event`，硬件级）。

## 实战踩出来的四条（2026-11-26，深空当铺）

1. **按钮点图形中心，不要点 tooltip 出现的位置。** 悬停区往往比可点区大一圈；点偏了会以为「游戏不听我的」。
2. **抓屏坐标 = 窗口内相对坐标**，窗口挪了不用改；但窗口最小化时 `rect` 是 `-32000,-32000 199x34`，脚本会标 `MIN` 并拒绝抓。
3. PowerShell 5.1 没有 BOM 时按 ANSI 读 `.ps1`，**C# 块里绝不要写中文**——会编译失败（`常量中有换行符`）。
4. 想把中文窗口标题正确回传，脚本开头要设 `[Console]::OutputEncoding = [Text.Encoding]::UTF8`。
