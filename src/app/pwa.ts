// SVGcinema — app/pwa
// The editor as an installable app (PWA; also the Microsoft Store package, made from the site with PWABuilder):
// - the service worker (public/sw.js) keeps the editor so it opens offline, registered in a production build
//   only, and never in a practice editor or the batch converter's frame;
// - opening a .SVGcinema file with the installed app (the manifest's file_handlers) opens it here, through
//   the same steps as File › Open (save first?), keeping the file's handle so Save writes back to it.
import { EPHEMERAL } from '../core/batch-mode';
import { confirmDiscard } from '../io/guard';
import { loadProjectFile } from '../io/open';

export function registerSW() {
  if (!import.meta.env.PROD || EPHEMERAL || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  const go = () =>
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* not available here (a private window, a host that refuses it): the editor works as before */
    });
  // after the page has loaded, so it doesn't compete with the editor's own files
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go);
}

/** Files the installed app was opened with: the first project opens, as File › Open would. */
export async function openLaunchFiles(handles: FileSystemFileHandle[]) {
  const h = handles.find(x => /\.svgcinema$/i.test(x.name));
  if (!h) return false;
  if (!(await confirmDiscard('Opening another project closes this one. Save your changes first?'))) return false;
  return loadProjectFile(await h.getFile(), h);
}

export function initLaunch() {
  const lq = (window as any).launchQueue;
  if (EPHEMERAL || !lq || typeof lq.setConsumer !== 'function') return;
  lq.setConsumer((p: { files?: FileSystemFileHandle[] }) => {
    if (p && p.files && p.files.length) openLaunchFiles(p.files);
  });
}
