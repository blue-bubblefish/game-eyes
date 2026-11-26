import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { GAME_EYES_DEFAULTS, type GameEyesConfigSection } from './config.ts';
import { GAME_EYES_DECLS, GameEyesWorld } from './world.ts';

/** 一个给任何游戏配眼睛和手的 World，不碰内存。 */
export const GAME_EYES: WorldDefinition<GameEyesConfigSection> = {
  id: 'game-eyes',
  label: '游戏之眼',
  defaults: () => ({ ...GAME_EYES_DEFAULTS }),
  preflight: () => {
    if (process.platform !== 'win32') throw new Error(`游戏之眼只支持 Windows，当前平台是 ${process.platform}`);
  },
  // `ctx.cfg` 是 `worlds.game-eyes` 的活引用；面板保存经 ctx.persist 写回。
  create: (ctx) => new GameEyesWorld({
    cfg: ctx.cfg,
    persist: (patch) => ctx.persist(patch),
  }),
  describe: {
    tools: describeTools(GAME_EYES_DECLS, {
      game_windows: {
        zh: '列出当前可见的顶层窗口：前台标记、pid、尺寸、位置、类名和标题。',
        en: 'Lists visible top-level windows with the foreground mark, pid, size, position, class and title.',
      },
      game_see: {
        zh: '抓一个窗口的画面回一张 png；PrintWindow 抓成黑的就退回屏幕复制。',
        en: 'Captures a window as a png, falling back to a screen copy when PrintWindow comes back black.',
      },
      game_click: {
        zh: '在窗口内相对坐标点一下左键（会移动真实鼠标）。',
        en: 'Left-clicks at window-relative coordinates, moving the real mouse.',
      },
      game_key: {
        zh: '先把窗口切到前台，再按一串 SendKeys 写法的键。',
        en: 'Brings the window to the front, then sends a SendKeys string.',
      },
    }),
    events: [],
  },
};
