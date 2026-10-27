// SVGcinema — io/extras
// Extra files a .SVGcinema project can carry beside the document (the design agent's chat). Modules
// register here instead of the project code importing them:
//   write: a file to add when the project is saved (null: nothing to add)
//   reset: the project was replaced (opened, new, sample…): forget what belonged to the old one
//   read:  a .SVGcinema file was opened: load your file from it, if it has one
import type { ZipInput, ZipReader } from './zip';

export const EXTRAS = {
  write: [] as Array<() => ZipInput | null>,
  reset: [] as Array<() => void>,
  read: [] as Array<(z: ZipReader) => Promise<void>>,
};

/** the design agent's chat, when the project has one (the Save dialog offers to leave it out) */
export const CHAT_EXTRA = 'agent-chat.json';
export function extraFiles(): ZipInput[] {
  return EXTRAS.write.map(f => f()).filter((x): x is ZipInput => !!x);
}
export function resetExtras() {
  EXTRAS.reset.forEach(f => f());
}
export async function readExtras(z: ZipReader) {
  for (const f of EXTRAS.read) await f(z);
}
