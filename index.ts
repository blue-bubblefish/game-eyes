/** 包入口：默认导出 `WorldDefinition`，加载器按 `cortico.kind === 'world'` 认它。 */
import { GAME_EYES } from './definition.ts';

export default GAME_EYES;
export { GAME_EYES };
export { GAME_EYES_DEFAULTS, resolveConfig } from './config.ts';
export type { GameEyesConfigSection } from './config.ts';
