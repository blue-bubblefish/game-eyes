/**
 * game_windows / game_see / game_click / game_key
 *
 * 不碰游戏内存、不编译 DLL，就一层：抓窗口画面 → 我看 → 点它 → 按键。
 * 走 `scripts/game.ps1`（PrintWindow 优先，全黑就退回屏幕复制），任何游戏都能上桌。
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from 'cortico/core/language.ts';
import type { ToolDef, ToolOutcome, World, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { DeepPartial } from 'cortico/world.ts';
import { resolveConfig, type GameEyesConfigSection } from './config.ts';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/game.ps1', import.meta.url));

export const GAME_EYES_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'game_windows',
    description: '列出当前可见的顶层窗口：前台标记、pid、尺寸、位置、窗口类名、标题。'
      + '找游戏窗口用它，拿到 pid 或标题关键词再喂给 game_see / game_click。',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'game_see',
    description: '抓一个窗口的画面，回一张 png 附件。PrintWindow 抓不到（全黑）就退回屏幕复制。'
      + '不给 title/pid 就抓前台窗口。回执里有窗口矩形，点的时候换算是窗口内相对坐标。',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '窗口标题的一部分，不区分大小写。' },
        pid: { type: 'integer', description: '窗口所属进程 pid，优先于 title。' },
        bring: { type: 'boolean', description: '抓之前先把窗口切到前台。' },
      },
    },
  },
  {
    name: 'game_click',
    description: '在窗口内相对坐标 (x, y) 处点一下左键。坐标以 game_see 那张图的左上角为原点。'
      + '会移动真实鼠标；需要管理员权限的窗口点不动，回执会报错。',
    tags: ['write', 'input'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'integer', description: '窗口内横坐标（像素）。' },
        y: { type: 'integer', description: '窗口内纵坐标（像素）。' },
        title: { type: 'string', description: '窗口标题的一部分。' },
        pid: { type: 'integer', description: '窗口所属进程 pid。' },
        bring: { type: 'boolean', description: '点之前先把窗口切到前台（默认按配置）。' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'game_key',
    description: '先把窗口切到前台，再按一串键。写法同 .NET SendKeys：`{ENTER}`、`{ESC}`、`{TAB}`、'
      + '`+{F1}`（Shift+F1）、`^a`（Ctrl+A）。只能对前台窗口生效。'
      + '**注意**：它只发一条 WM_CHAR，吃 RawInput 的 Unity 游戏会无视——那种改用 game_keyv。',
    tags: ['write', 'input'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        keys: { type: 'string', description: 'SendKeys 写法的一串键，例如 `{ENTER}` 或 `^s`。' },
        title: { type: 'string', description: '窗口标题的一部分。' },
        pid: { type: 'integer', description: '窗口所属进程 pid。' },
      },
      required: ['keys'],
    },
  },
  {
    name: 'game_keyv',
    description: '按一个物理键（硬件级 keybd_event），游戏和普通程序都认。给 Windows 虚拟键码：'
      + 'A–Z 是 65–90，0–9 是 48–57，回车 13，Esc 27，空格 32，Tab 9，方向键 37/38/39/40，'
      + 'F1–F12 是 112–123。game_key 打不动的游戏用这个。',
    tags: ['write', 'input'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        vk: { type: 'integer', description: 'Windows 虚拟键码，例如 79 是字母 O。' },
        title: { type: 'string', description: '窗口标题的一部分。' },
        pid: { type: 'integer', description: '窗口所属进程 pid。' },
      },
      required: ['vk'],
    },
  },
  {
    name: 'game_ocr',
    description: '抓一次窗口画面，然后用 Windows 自带 OCR 读上面的字，每行回成 `x,y,w,h<TAB>文字`；'
      + '坐标是窗口内相对坐标，可以拿去 game_click。没有画面附件。想看图用 game_see。',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '窗口标题的一部分。' },
        pid: { type: 'integer', description: '窗口所属进程 pid。' },
        bring: { type: 'boolean', description: '抓之前先把窗口切到前台。' },
        lang: { type: 'string', description: '识别语言，例如 `zh-Hans-CN`、`en-US`；留空按系统设置。' },
      },
    },
  },
];

interface RunResult { ok: boolean; output: string }

function runScript(args: string[], timeoutSeconds: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, ...args],
      { timeout: Math.round(timeoutSeconds * 1000), windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = `${stdout ?? ''}${stderr ? `\n[stderr] ${stderr}` : ''}`.trim();
        resolve({ ok: !err, output: out });
      },
    );
  });
}

export interface GameEyesOptions {
  cfg: GameEyesConfigSection;
  persist(patch: DeepPartial<GameEyesConfigSection>): void;
  /** 抓屏落盘的位置，默认系统临时目录。测试可注入。 */
  tempDir?: string;
}

export class GameEyesWorld implements World {
  readonly id = 'game-eyes';

  constructor(private readonly opts: GameEyesOptions) {}

  envPromptVars(): null {
    return null;
  }

  /** 没有后台进程要拉起来：工具调用时才现开一个 PowerShell。 */
  async start(): Promise<void> {}

  tools(): ToolDef[] {
    return [
      { ...GAME_EYES_DECLS[0]!, handler: async () => this.list() },
      { ...GAME_EYES_DECLS[1]!, handler: async (args) => this.see(args) },
      { ...GAME_EYES_DECLS[2]!, handler: async (args) => this.click(args) },
      { ...GAME_EYES_DECLS[3]!, handler: async (args) => this.key(args) },
      { ...GAME_EYES_DECLS[4]!, handler: async (args) => this.keyv(args) },
      { ...GAME_EYES_DECLS[5]!, handler: async (args) => this.ocr(args) },
    ];
  }

  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const zh = language.startsWith('zh');
    return {
      label: zh ? '游戏之眼' : 'Game eyes',
      panels: [{
        id: 'basic',
        title: zh ? '默认窗口' : 'Default window',
        description: zh
          ? '填一个窗口标题关键词当默认目标；留空就用前台窗口。这里只改默认值，动手时还能临时指定。'
          : 'A window title keyword used when none is given; blank means the foreground window.',
      }],
      invoke: async (panel, method) => {
        if (panel === 'basic' && method === 'load') {
          return { ok: true, config: resolveConfig(this.opts.cfg) };
        }
        return { ok: true };
      },
    };
  }

  private get cfg(): GameEyesConfigSection {
    return resolveConfig(this.opts.cfg);
  }

  private windowArgs(args: Record<string, unknown>): string[] {
    const cfg = this.cfg;
    const title = typeof args.title === 'string' && args.title.trim()
      ? args.title.trim()
      : cfg.defaultTitle;
    const pid = Number.isInteger(args.pid) ? Number(args.pid) : 0;
    return ['-Title', title, '-Pid2', String(pid)];
  }

  private async list(): Promise<ToolOutcome> {
    const { ok, output } = await runScript(['-Action', 'windows'], this.cfg.timeoutSeconds);
    if (!ok || !output) {
      return { text: `列窗口失败：\n${output || '(没有输出)'}` };
    }
    const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return { text: `可见窗口 ${lines.length} 个（FG = 前台）：\n${lines.join('\n')}` };
  }

  private async see(args: Record<string, unknown>): Promise<ToolOutcome> {
    const cfg = this.cfg;
    const bring = args.bring === undefined ? cfg.bringToFront : args.bring === true;
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const file = join(this.opts.tempDir ?? tmpdir(), `game-see-${stamp}.png`);
    const { ok, output } = await runScript(
      ['-Action', 'see', ...this.windowArgs(args), '-Out', file, '-Bring', bring ? '1' : '0'],
      cfg.timeoutSeconds,
    );
    if (!ok || !/^RESULT:/m.test(output)) {
      return { text: `抓屏失败：\n${output || '(没有输出)'}` };
    }
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(file);
    } catch (err) {
      return { text: `抓屏写盘了但读不出来：${err instanceof Error ? err.message : String(err)}\n${output}` };
    }
    const rect = /RESULT:\s*(.*)$/m.exec(output)?.[1] ?? '';
    return {
      text: `${rect}\n文件 ${file}\n坐标原点在这张图的左上角；图在下一行 [blob …] 里。`,
      blobs: [{ bytes, mime: 'image/png', name: `game-see-${stamp}.png`, fallbackText: `原路径 ${file}` }],
    };
  }

  private async click(args: Record<string, unknown>): Promise<ToolOutcome> {
    const cfg = this.cfg;
    const x = Number(args.x);
    const y = Number(args.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { text: 'game_click 需要整数 x、y（窗口内相对坐标）。' };
    }
    const bring = args.bring === undefined ? cfg.bringToFront : args.bring === true;
    const { ok, output } = await runScript(
      ['-Action', 'click', ...this.windowArgs(args), '-X', String(Math.round(x)), '-Y', String(Math.round(y)),
        '-Bring', bring ? '1' : '0'],
      cfg.timeoutSeconds,
    );
    if (!ok || output.includes('ERR')) {
      return { text: `点击失败（可能需要管理员权限，或者窗口不在）：\n${output || '(没有输出)'}` };
    }
    return { text: output };
  }

  private async key(args: Record<string, unknown>): Promise<ToolOutcome> {
    const keys = typeof args.keys === 'string' ? args.keys : '';
    if (!keys.trim()) return { text: 'game_key 需要一串键，例如 `{ENTER}`。' };
    const { ok, output } = await runScript(
      ['-Action', 'key', ...this.windowArgs(args), '-Keys', keys],
      this.cfg.timeoutSeconds,
    );
    if (!ok || output.startsWith('ERR')) {
      return { text: `按键失败：\n${output || '(没有输出)'}` };
    }
    return { text: output };
  }

  private async keyv(args: Record<string, unknown>): Promise<ToolOutcome> {
    const vk = Number(args.vk);
    if (!Number.isInteger(vk) || vk < 1 || vk > 255) {
      return { text: 'game_keyv 需要 1–255 的整数虚拟键码（A–Z 是 65–90）。' };
    }
    const { ok, output } = await runScript(
      ['-Action', 'keyv', ...this.windowArgs(args), '-Vk', String(vk)],
      this.cfg.timeoutSeconds,
    );
    if (!ok || output.startsWith('ERR')) {
      return { text: `按键失败：\n${output || '(没有输出)'}` };
    }
    return { text: output };
  }

  private async ocr(args: Record<string, unknown>): Promise<ToolOutcome> {
    const cfg = this.cfg;
    const bring = args.bring === undefined ? cfg.bringToFront : args.bring === true;
    const lang = typeof args.lang === 'string' ? args.lang.trim() : '';
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const file = join(this.opts.tempDir ?? tmpdir(), `game-ocr-${stamp}.png`);
    const { ok, output } = await runScript(
      ['-Action', 'ocr', ...this.windowArgs(args), '-Out', file, '-Keys', lang || '', '-Bring', bring ? '1' : '0'],
      cfg.timeoutSeconds,
    );
    if (!ok || output.startsWith('ERR')) {
      return { text: `识别失败：\n${output || '(没有输出)'}` };
    }
    const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const engine = lines.find((line) => line.startsWith('ENGINE:'));
    const rows = lines.filter((line) => !line.startsWith('ENGINE:') && !line.startsWith('CAPTURE:'));
    if (rows.length === 0) {
      return { text: `这一屏没读到字（${engine ?? '未知引擎'}）。` };
    }
    return { text: `${engine ?? ''}\n共 ${rows.length} 行，格式 x,y,w,h<TAB>文字（窗口内相对坐标）：\n${rows.join('\n')}`.trim() };
  }
}
