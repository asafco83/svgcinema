// SVGcinema — agent/describe
// How each tool call reads in the panel's step list: an icon, a short label and a quieter line under
// it. Worked out when the step runs (layer names may change or vanish later) and stored with it.
import { propLabel, r3 } from '../core/constants';
import { layerById } from '../core/state';
import { presetById } from '../core/presets';
import type { StepEvent } from './loop';
import { money } from './images';

export type StepIcon = 'look' | 'add' | 'draw' | 'image' | 'place' | 'edit' | 'key' | 'time' | 'del' | 'err';
export interface StepView extends StepEvent {
  icon: StepIcon;
  label: string;
  meta: string;
  /** an image made without asking: the line under it with its cost (and "Ask first again") */
  costLine?: string;
}

/** "$0.04" when the service reported it, "about $0.04" from the price list, '' when unknown. */
export const costText = (c: any) => (c && typeof c.usd === 'number' ? (c.exact ? '' : 'about ') + money(c.usd) : '');

const nm = (id: unknown) => {
  const l = typeof id === 'string' ? layerById(id) : null;
  return l ? `“${l.name}”` : 'a layer';
};
const list = (xs: string[], n = 3) =>
  xs.length > n ? `${xs.slice(0, n).join(', ')} +${xs.length - n}` : xs.join(', ');
const s = (n: number) => `${r3(n)} s`;

/** The first sentence of a refusal, without the list of what would have been accepted. */
export function gist(m: string) {
  const first = m.split(/(?<=[.!?])\s+(?=[A-Z])/)[0].replace(/\s+(Use|Call|Try) .*$/, '');
  return first.length > 140 ? first.slice(0, 138) + '…' : first;
}

export function describe(e: StepEvent): StepView {
  const a = e.args || {},
    r = e.result || {};
  let icon: StepIcon = 'edit',
    label = e.name.replace(/_/g, ' '),
    meta = '',
    costLine: string | undefined;
  switch (e.name) {
    case 'generate_image':
    case 'generate_vector': {
      const v = e.name === 'generate_vector',
        what = `${v ? 'vector' : 'image'} “${a.name}”`;
      if (r.cancelled) {
        [icon, label, meta] = ['look', `Didn’t generate the ${what}`, 'cancelled'];
        break;
      }
      const cost = costText(r.cost),
        model = r.model || '';
      icon = v ? 'draw' : 'image';
      label = `Generated ${what}`;
      meta = [
        model,
        v
          ? r.layers
            ? `imported as ${r.layers} layers`
            : ''
          : r.transparent === 'removed'
            ? 'background removed'
            : '',
        r.asked ? 'approved' : '',
        r.asked ? cost : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (!r.asked) costLine = ['Generated', model, cost || 'price unknown'].filter(Boolean).join(' · ');
      break;
    }
    case 'snapshot':
      [icon, label, meta] = ['look', 'Looked at the canvas', `at ${s(r.time ?? a.time ?? 0)}`];
      break;
    case 'place_image': {
      const l = typeof r.id === 'string' ? layerById(r.id) : null,
        b = r.box;
      [icon, label, meta] = [
        'place',
        `Placed ${l ? `“${l.name}”` : 'the image'}`,
        Array.isArray(b)
          ? `x ${Math.round(b[0] + b[2] / 2)} · y ${Math.round(b[1] + b[3] / 2)} · ${Math.round(b[2])} × ${Math.round(b[3])}`
          : '',
      ];
      break;
    }
    case 'get_scene':
      [icon, label] = ['look', 'Looked at the project'];
      break;
    case 'get_layer':
      [icon, label] = ['look', `Looked at ${nm(a.id)}`];
      break;
    case 'list_presets':
      [icon, label] = ['look', 'Checked the presets'];
      break;
    case 'list_assets':
      [icon, label] = ['look', 'Checked the assets'];
      break;
    case 'select':
      [icon, label] = ['look', `Selected ${(a.ids || []).length} layer${(a.ids || []).length === 1 ? '' : 's'}`];
      break;
    case 'seek':
      [icon, label, meta] = ['time', 'Moved the playhead', s(a.time || 0)];
      break;
    case 'add_shape':
      [icon, label, meta] = ['add', `Added “${r.name || a.name || a.kind}”`, a.kind];
      break;
    case 'import_svg':
      [icon, label, meta] = ['draw', `Drew “${a.name}”`, r.layers ? `${r.layers} layers` : ''];
      break;
    case 'update_layer': {
      const l = layerById(a.id),
        ks = [...(r.changed || []), ...(r.keyed || [])].map((k: string) => (l ? propLabel(l, k) : k));
      [icon, label, meta] = [
        r.keyed && r.keyed.length ? 'key' : 'edit',
        `Changed ${nm(a.id)}`,
        list(ks) + (r.keyed && r.keyed.length ? ` · key at ${s(r.time || 0)}` : ''),
      ];
      break;
    }
    case 'group':
      [label, meta] = [`Grouped as “${r.name || a.name || 'Group'}”`, `${(a.ids || []).length} layers`];
      break;
    case 'ungroup':
      label = `Ungrouped ${nm(a.id)}`;
      break;
    case 'duplicate':
      [icon, label] = ['add', `Copied ${nm(a.id)}`];
      break;
    case 'reorder':
      [label, meta] = [`Moved ${nm(a.id)}`, a.to ? `to the ${a.to}` : a.into ? `into ${nm(a.into)}` : ''];
      break;
    case 'delete':
      [icon, label] = r.cancelled
        ? ['look', `Kept ${(a.ids || []).length} layer${(a.ids || []).length === 1 ? '' : 's'}`]
        : ['del', `Deleted ${list(r.deleted || [])}`];
      break;
    case 'apply_preset': {
      const p = presetById(a.preset),
        len = a.length ?? (p ? p.dur : 0);
      [icon, label, meta] = [
        'key',
        p ? p.name : a.preset,
        `${list(r.layers || [])} · ${r3(a.at)}–${s(a.at + len + (a.stagger || 0) * Math.max(0, (r.layers || []).length - 1))}${a.stagger ? ` · stagger ${s(a.stagger)}` : ''}`,
      ];
      break;
    }
    case 'set_keyframes': {
      const l = layerById(a.id),
        ts = (a.keys || []).map((k: any) => k.t);
      [icon, label, meta] = [
        'key',
        `${l ? propLabel(l, a.prop) : a.prop} keys`,
        `${nm(a.id)} · ${ts.length} key${ts.length === 1 ? '' : 's'}${ts.length ? ` · ${r3(Math.min(...ts))}–${s(Math.max(...ts))}` : ''}`,
      ];
      break;
    }
    case 'clear_animation':
      [icon, label] = ['key', `Removed animation from ${nm(a.id)}`];
      break;
    case 'offset_animation':
      [icon, label, meta] = [
        'time',
        'Shifted the timing',
        `${(a.ids || []).length} layer${(a.ids || []).length === 1 ? '' : 's'} by ${s(a.by)}${a.stagger ? ` · stagger ${s(a.stagger)}` : ''}`,
      ];
      break;
    case 'set_document':
      [icon, label, meta] = [
        'time',
        'Changed the project settings',
        list(
          Object.keys(a).map(k =>
            k === 'length' ? `length ${s(a.length)}` : k === 'repeat' ? (a.repeat ? `${a.repeat} plays` : 'loops') : k,
          ),
          4,
        ),
      ];
      break;
  }
  // a refused call: the model reads the whole reason (and usually corrects it); the panel shows its gist
  if (!e.ok) [icon, meta] = ['err', 'Refused: ' + gist(e.error || 'It failed.')];
  return { ...e, icon, label, meta, ...(costLine ? { costLine } : {}) };
}
