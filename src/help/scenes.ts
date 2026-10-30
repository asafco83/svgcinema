// SVGcinema — help/scenes
// The practice scenes, by topic (help/topics/<group>.ts): each tutorial opens its own small scene with only
// what that tutorial needs (never the sample scene, never the user's project). The animation's settings stay
// a new project's defaults (3 s, loop forever, Normal direction), so what a tutorial makes is what the same
// steps make in any project.
import type { Scene } from './kit';
import * as start from './topics/start';
import * as create from './topics/create';
import * as arrange from './topics/arrange';
import * as style from './topics/style';
import * as animate from './topics/animate';
import * as rigging from './topics/rigging';
import * as timing from './topics/timing';
import * as io from './topics/io';
import * as agent from './topics/agent';

export type { Scene } from './kit';
export { allLayers, byName } from './kit';
export const SCENES: Record<string, Scene> = {
  ...start.scenes,
  ...create.scenes,
  ...arrange.scenes,
  ...style.scenes,
  ...animate.scenes,
  ...rigging.scenes,
  ...timing.scenes,
  ...io.scenes,
  ...agent.scenes,
};
