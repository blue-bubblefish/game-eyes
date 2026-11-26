/** 游戏之眼：给任何游戏配一双眼睛和一只手。配置很少，故意如此。 */

export interface GameEyesConfigSection {
  /** 默认窗口：标题关键词。留空就用前台窗口。 */
  defaultTitle: string;
  /** 动手之前先把窗口切到前台。 */
  bringToFront: boolean;
  /** 单次抓屏/点击的超时（秒）。 */
  timeoutSeconds: number;
}

export const GAME_EYES_DEFAULTS: GameEyesConfigSection = {
  defaultTitle: '',
  bringToFront: true,
  timeoutSeconds: 20,
};

export function resolveConfig(cfg: Partial<GameEyesConfigSection> | undefined): GameEyesConfigSection {
  const raw = cfg ?? {};
  const timeout = Number(raw.timeoutSeconds);
  return {
    defaultTitle: typeof raw.defaultTitle === 'string' ? raw.defaultTitle : GAME_EYES_DEFAULTS.defaultTitle,
    bringToFront: typeof raw.bringToFront === 'boolean' ? raw.bringToFront : GAME_EYES_DEFAULTS.bringToFront,
    timeoutSeconds: Number.isFinite(timeout) && timeout >= 3 && timeout <= 120
      ? timeout
      : GAME_EYES_DEFAULTS.timeoutSeconds,
  };
}
