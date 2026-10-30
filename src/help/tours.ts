// SVGcinema — help/tours
// What each guided tour's steps do in the editor, by topic. The words of every step (its title, the text on
// the website and in the Help panel, the short line on the tour card) are in help/content.json; the topics'
// files (help/topics/<group>.ts) have, for the same steps in the same order, what each does (help/kit
// TourStep: target, enter, done, show, clip). Every topic with a page has its steps here, also those
// without a guided tour: the website's step clips are recordings of their "Show me" (site/captures.py).
// tests/browser/help.py runs every one with Show me alone, so a change to the editor that breaks a step
// fails the tests.
import type { TourStep } from './kit';
import * as start from './topics/start';
import * as create from './topics/create';
import * as style from './topics/style';
import * as animate from './topics/animate';
import * as rigging from './topics/rigging';
import * as timing from './topics/timing';
import * as io from './topics/io';
import * as agent from './topics/agent';

export type { Ctx, TourStep } from './kit';
export const TOURS: Record<string, TourStep[]> = {
  ...start.tours,
  ...create.tours,
  ...style.tours,
  ...animate.tours,
  ...rigging.tours,
  ...timing.tours,
  ...io.tours,
  ...agent.tours,
};
