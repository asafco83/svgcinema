// SVGcinema — help/content
// The help topics (help/content.json, shared with the website's help pages: site/build.mjs reads the same
// file). A topic with `ready` has its page; `tour` marks the ones with a guided tour (help/tours.ts).
import DATA from './content.json';

export interface HelpStep {
  title: string;
  /** the step on the website and in the Help panel (HTML: <b>, <kbd>, and {◆} for a keyframe diamond) */
  text: string;
  /** the short line on the tour card */
  do: string;
  /** false: the step is done outside the editor (on your page, in your files), so it has no clip */
  clip?: boolean;
}
export interface HelpTopic {
  id: string;
  group: string;
  title: string;
  ready?: boolean;
  /** a guided tour: the topic's steps run in a practice editor (every topic with a page has its steps in
   *  help/tours, for its clips; `tour` offers them as a tour) */
  tour?: boolean;
  /** one of the cards under Start here on the website's help hub */
  start?: boolean;
  minutes?: number;
  intro?: string;
  goal?: string;
  steps?: HelpStep[];
  note?: string;
  keys?: string[][];
  related?: string[];
}
export interface HelpGroup {
  id: string;
  title: string;
  sub: string;
}
export const GROUPS: HelpGroup[] = DATA.groups;
export const TOPICS: HelpTopic[] = DATA.topics as HelpTopic[];
/** the topics that have their page */
export const READY = TOPICS.filter(t => t.ready);
export const topic = (id: string) => TOPICS.find(t => t.id === id && t.ready) || null;

/** The keyframe diamond token, as markup with the given class. */
export const rich = (html: string, dm = 'hp-dm') => html.replace(/\{◆\}/g, `<i class="${dm}" aria-label="◆"></i>`);
/** "Shift P" → <kbd>Shift</kbd> <kbd>P</kbd> */
export const keyHTML = (k: string) => {
  const ps = k.split(' ');
  // "Alt + drag": the + between keys and a word for the pointer (drag, click, scroll) are plain text
  return ps.map(p => (ps.length > 1 && (p === '+' || /^[a-z]{2,}$/.test(p)) ? p : `<kbd>${p}</kbd>`)).join(' ');
};
