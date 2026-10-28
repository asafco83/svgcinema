// SVGcinema — model/types
// The editor's document model. The runtime's EngineLayer is the exported subset of Layer.
import type { ShapeParams } from '../geometry/nodes';
import type { Ease, EngineSubPath, Keyframe } from '../runtime/engine';

export type { Ease, Keyframe };

export type Vec2 = [number, number];

/** Cubic path node: anchor x,y, in-handle x,y, out-handle x,y (6 numbers). */
export type PathNode = number[];
/** `c`: closed, `n`: nodes */
export type SubPath = EngineSubPath;
export type PathData = SubPath[];

export type LayerType = 'group' | 'rect' | 'ellipse' | 'path' | 'text' | 'image' | 'bone' | 'raw';

/** Animatable properties. `org` is stored on `Layer.o`, the rest on `Layer.b`. */
export type PropKey =
  | 'p0'
  | 'p1'
  | 'rad'
  | 'ts'
  | 'te'
  | 'to'
  | 'pos'
  | 'org'
  | 'rot'
  | 'scl'
  | 'skw'
  | 'op'
  | 'fill'
  | 'fo'
  | 'stk'
  | 'so'
  | 'sw'
  | 'dof'
  /** size [w, h]: the shape's box, grown around the origin */
  | 'sz'
  /** dash pattern: a list of dash / gap lengths ([] = solid) */
  | 'da'
  | 'd'
  /** filter parameter: fx.<filter id>.<param> */
  | `fx.${string}`
  /** pin position / rotation: pin<n>, pinr<n> */
  | `pin${number}`
  | `pinr${number}`;
/** a pin that bends its path: number (stable, not reused) and rest position in the layer's space */
export interface PinDef {
  n: number;
  /** rest position (layer space); a pin bound to a bone keeps its rest place here too */
  x: number;
  y: number;
  /** bound to a bone (Pin tool › Bind to bones, or the Bind tool): it follows the bone and turns with it */
  bone?: string;
  /** a bound pin's offset from the bone's joint, in the bone's own space (the Bind tool binds a pin
   *  where it is); none: at the joint */
  bo?: Vec2;
}

/** Unanimated values. */
export interface BaseValues {
  pos: Vec2;
  rot: number;
  scl: Vec2;
  op: number;
  fill: string;
  stk: string;
  sw: number;
  d?: PathData;
  /** skew x/y in degrees */
  skw?: Vec2;
  /** fill / stroke opacity 0–1 */
  fo?: number;
  so?: number;
  /** stroke dash offset */
  dof?: number;
  [extra: string]: any;
}

/** Animated tracks keyed by PropKey (string-indexed to match the runtime's EngineLayer). */
export type Tracks = Record<string, Keyframe[]>;

/**
 * Shape geometry. Which fields are present depends on `Layer.type`:
 * rect x,y,w,h,rx · ellipse cx,cy,rx,ry · text x,y,text,size,family,weight,anchor ·
 * image x,y,w,h,asset · bone x,y,len,ang · raw markup.
 */
export interface Geometry {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rx?: number;
  ry?: number;
  cx?: number;
  cy?: number;
  text?: string;
  size?: number;
  family?: string;
  weight?: string;
  anchor?: 'start' | 'middle' | 'end' | string;
  /** text: italic */
  italic?: boolean;
  /** text: CSS text-decoration lines, e.g. 'underline line-through' */
  deco?: string;
  /** text: letter spacing in px */
  ls?: number;
  /** text: keep the box width while typing and wrap lines at `ww` */
  wrap?: boolean;
  ww?: number;
  /** text: line height as a multiple of the font size */
  lh?: number;
  asset?: string;
  len?: number;
  ang?: number;
  markup?: string;
  [k: string]: any;
}

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  /** parent group or bone id */
  parent: string | null;
  geo: Geometry;
  b: BaseValues;
  t: Tracks;
  /** transform origin (layer space); null means the shape's own default */
  o: Vec2 | null;
  /** polygon / star drawn with the shape tools: its settings, so sides, points, ratio and corner
   *  radius stay editable. `sig` is the path it produced; once the path is edited by hand (or morphs)
   *  the settings no longer apply. */
  shape?: ShapeParams & { sig?: string };
  /** frozen tracks: kept aside (not played, exported or keyed) while the property holds the value it
   *  had when frozen; unfreezing moves them back into `t` */
  ft?: Tracks;
  /** group: a mask group ('mask' = by opacity, 'clip' = by shape); its `maskSrc` child is the mask */
  mask?: 'mask' | 'clip';
  /** size anchor: the point an animated size grows around, as a share of the shape's box (0–1 on each
   *  axis); unset = the origin. Imported animations that grow from the shape's corner use it. */
  sa?: [number, number];
  /** stroke alignment on a closed shape: inside or outside its edge (unset = centred, as SVG draws it).
   *  SVG has no stroke alignment, so it is drawn at twice the width, clipped to the shape (inside) or
   *  masked to outside it, with a stroke-less copy of the shape (`-sf`) giving the clip and the fill. */
  al?: 'in' | 'out';
  /** mask group: masks by brightness ('lum', luminance) instead of by opacity (the default) */
  mm?: 'lum';
  /** group: the folder holding a mask group's mask layers */
  maskSrc?: boolean;
  /** hyperlink: clicking the layer in the exported SVG opens it */
  link?: { url: string; target: '_blank' | '_self' };
  /** a group that is an instance of this symbol (doc.symbols) */
  sym?: string;
  /** a symbol instance: its contents' animation starts this many seconds later */
  symOff?: number;
  /** curved motion path */
  sm: boolean;
  /** even speed along curved motion-path segments (by length); off: by the curve's own parameter */
  ev?: boolean;
  /** orient along motion path */
  or: boolean;
  hid: boolean;
  lock: boolean;
  /** extra transform kept from imported SVG */
  xf: string;
  /** extra SVG attributes kept from import or tools */
  extra: Record<string, string>;
  /** filters, applied in order */
  fx?: Array<{ id: string; type: string; name?: string; pos?: string }>;
  /** runtime map for animated filter parameters (derived from fx, see model/filters) */
  fa?: Record<string, [string, string] | [string, string, string?, string?][]>;
  /** compositing: CSS mix-blend-mode and isolation */
  blend?: string;
  iso?: boolean;
  /** bones: inherit the parent bone's scale (default off) */
  inh?: boolean;
  /** pins that bend this path (Pin tool), and how far each pulls (percent, default 100) */
  pins?: PinDef[];
  reach?: number;
  /** images, text and groups with pins: the triangle mesh they bend through (see model/mesh).
   *  `n` = density (about that many triangles over the content's bounds), `h` = a hash of the content
   *  it was built for (rebuilt when that changes) */
  mesh?: { n?: number; v: number[][]; t: number[][]; h?: string };
  /** top bones: "Key whole rig" (posing any bone keys the whole rig); undefined = on */
  kr?: boolean;
  /** top bones: the rig's own draw order, back to front (ids of the artwork attached to its bones);
   *  undefined = drawn by nesting (see model/draw-order) */
  dord?: string[];
  /** bones: IK pin */
  pin?: boolean;
  /** bones: rotation limit */
  lim?: boolean;
  lmin?: number;
  lmax?: number;
}

export interface EasingPreset {
  name: string;
  v: Ease;
}

export interface ExportSettings {
  mode: 'js' | 'css';
  trigger: 'load' | 'click' | 'hover' | 'scroll' | 'api';
  /** what happens on mouse out (hover trigger) */
  out: 'pause' | 'reverse' | 'restart' | 'start' | 'none' | string;
  size: 'resp' | 'fixed';
  ids: 'gen' | 'names';
  fill: 'forwards' | 'backwards' | 'none' | string;
  speed: number;
  fps: number;
  prefix: string;
  /** fixed output width/height */
  w: number;
  h: number;
  /** keep aspect ratio */
  lock: boolean;
  /** responsive: largest expected display width, for image sizing */
  maxW: number;
  /** image optimization */
  opt: boolean;
  fmt: 'auto' | 'keep' | 'png' | 'jpeg' | 'webp' | 'avif' | string;
  q: number;
  /** 2x images for high-DPI screens */
  hi: boolean;
  /** web fonts: converted to outlines (default) or embedded */
  fonts?: 'outline' | 'embed';
  /** visitors who ask their system for less motion: play anyway (default), or show one still frame */
  rm?: 'play' | 'first' | 'last';
  /** carry the editable project inside the SVG (opening the SVG in SVGcinema restores it) */
  proj?: boolean;
  /** JS export: the player inside the SVG (default) or linked from outside */
  player?: 'embed' | 'external';
  /** Export › Image: one frame as a picture */
  img?: StillSettings;
}

/** Export › Image settings (kept with the project, like the other export settings). */
export interface StillSettings {
  fmt: 'png' | 'jpeg' | 'webp' | 'avif' | 'jxl' | 'svg';
  /** 1–100, for JPEG, WebP, AVIF and JPEG XL */
  q: number;
  /** WebP, AVIF and JPEG XL */
  lossless?: boolean;
  /** AVIF and JPEG XL: how long the encoder looks for a smaller file */
  effort?: 'fast' | 'bal' | 'small';
  /** pixels: 1×, 2× or 3× the canvas, or a size typed in (w × h) */
  scale: '1' | '2' | '3' | 'c';
  w?: number;
  h?: number;
  /** keep the canvas proportions while typing a size */
  lock?: boolean;
  /** still SVG: fills its container, or a fixed size */
  svgFit?: 'resp' | 'fixed';
  bg: 'transparent' | 'doc' | 'colour';
  /** the colour for bg: 'colour' */
  bgc?: string;
  /** Embed: also make the fallback formats, and 2× versions */
  fallbacks?: boolean;
  hi?: boolean;
}

export interface Doc {
  name: string;
  /** ruler guides, in document units: vertical lines at x, horizontal lines at y */
  guides?: { x: number[]; y: number[] };
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** background colour; empty means transparent */
  bg: string;
  /** background opacity 0–1 (default 1) */
  bgA?: number;
  /** seconds */
  dur: number;
  /** iterations, 0 = infinite */
  it: number;
  dir: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse' | string;
  /** <defs> markup kept from imported SVG */
  defs: string;
  layers: Layer[];
  ezPresets: EasingPreset[];
  ex: ExportSettings;
  /** symbols: id → name (and the contents' signature, see core/symbols) */
  symbols?: Record<string, { name: string; sig?: string }>;
}

export interface Asset {
  id: string;
  kind: 'image' | 'svg';
  name: string;
  mime: string;
  /** data URL (raster) */
  data?: string;
  /** source text (svg) */
  text?: string;
  w: number;
  h: number;
  /** bytes */
  size: number;
  [k: string]: any;
}

/** Copied keyframe, relative to the earliest copied key. */
export interface ClipKey {
  lid: string;
  k: PropKey;
  dt: number;
  v: any;
  e: Ease;
}

export interface OpenFile {
  name: string;
  /** File System Access handle when the browser supports overwriting */
  handle?: FileSystemFileHandle | null;
}

export type Tool = 'select' | 'node' | 'rect' | 'ellipse' | 'path' | 'pen' | 'text' | 'bone' | string;

export interface XY {
  x: number;
  y: number;
}

/** An active pointer gesture on the canvas: `move` on every pointermove, `up` on release. */
export interface Drag {
  move?(p: XY, e: PointerEvent): void;
  up?(p: XY, e: PointerEvent): void;
  /** live label drawn next to the pointer */
  lbl?: string;
  /** where to draw the label */
  lp?: XY;
  rot?: any;
  /** rotating several layers: the selection's box as it was, and the angle turned so far */
  gbox?: { x: number; y: number; w: number; h: number; ang: number };
  /** snap the pointer to points / grid / guides while dragging (layers to leave out) */
  snapPt?: Set<string> | true;
  /** a pin drag (its label is drawn by the pin overlay) */
  pin?: boolean;
  /** keys pressed during the gesture (e.g. ↑/↓ for polygon sides); return true if handled */
  key?(k: string, e: KeyboardEvent): boolean;
}

/** Transient editor state (not saved with the project). */
export interface EditorState {
  /** primary selected layer id */
  sel: string | null;
  selSet: Set<string>;
  tool: Tool;
  /** playhead, seconds */
  time: number;
  /** playback time while previewing */
  ptime: number;
  playing: boolean;
  loop: boolean;
  /** timeline pixels per second */
  pps: number;
  zoom: number;
  /** canvas px per document unit */
  scale: number;
  /** expanded rows in the timeline / layers panel, by layer id */
  exp: Record<string, boolean>;
  lexp: Record<string, boolean>;
  /** selected keyframes (references into Layer.t tracks) */
  keys: Set<Keyframe>;
  /** snap guide lines to draw while dragging (doc units) */
  snapLines?: { x: number[]; y: number[] } | null;
  /** the canvas marquee being dragged (document coordinates) and the layers it touches */
  marquee?: { a: { x: number; y: number }; b: { x: number; y: number }; hits: string[] } | null;
  /** export just these layers (Export selection) */
  exportOnly?: Set<string> | null;
  /** where arrow keys act (last area clicked) */
  kbArea?: 'stage' | 'timeline';
  /** selected path node [subpath, node] */
  node: [number, number] | null;
  undo: string[];
  redo: string[];
  /** active pointer gesture */
  drag: Drag | null;
  /** pen tool in progress */
  pen: any;
  last: number;
  /** open colour edit transaction */
  colorEd: { end(o?: any): void } | null;
  swatch: number;
  lockAR: boolean;
  /** inspector: show the free font-name field */
  fontCustom?: boolean;
  /** keep scale proportions in the inspector */
  sclLock?: boolean;
  /** keep size proportions in the inspector (shapes; images use lockAR) */
  szLock?: boolean;
  /** several layers: resizing the selection's box keeps its proportions (on unless turned off) */
  sbLock?: boolean;
  /** the symbol instance being edited (isolation mode) */
  symEdit?: string | null;
  /** the Presets window's preview on the timeline (core/presets PresetPlan) */
  presetPv?: {
    spans: Array<{ lid: string; t0: number; t1: number; props: string[] }>;
    replaced: Keyframe[];
    dur: number;
  } | null;
  ezDir: string;
  tab: string;
  clip: ClipKey[] | null;
  showBones: boolean;
  /** Show pins (Alt+P): every pinned layer's pins outside the Pin tools */
  showPins: boolean;
  /** a pin was just picked with the Select tool: Delete removes it (not the layer) */
  pinFocus?: boolean;
  /** pins picked with the Bind tool (to bind to a bone) */
  bindPins: { lid: string; n: number }[];
  /** the Bind tool's pointer is over empty canvas (a click there unbinds the picks) */
  bindEmpty?: boolean;
  boneDraft: any;
  /** Bind tool: the layers picked as children, the bone under the pointer, the pointer (doc / screen) */
  bindPick: string[];
  bindHover: string | null;
  bindPt: XY | null;
  bindScreen: XY | null;
  /** Scale bone tool: what a drag scales, and the volume squash & stretch keeps */
  boneScaleMode: 'length' | 'thickness' | 'linked' | 'squash';
  boneVolume: 'area' | 'tube';
  /** Pin tools: the selected pin (its number) */
  pinSel: number | null;
  /** Pin tool: the pin whose rotation ring is under the pointer */
  pinRing: number | null;
  /** Pin tool: Bind to bones is on (clicking a bone adds a pin bound to it), and the bone under the pointer */
  pinBind: boolean;
  pinBoneHover: string | null;
  file?: OpenFile | null;
  dirty?: boolean;
  loading?: boolean;
  saveAll?: boolean;
  /** Save: include the design agent's chat in the file (default yes) */
  saveChat?: boolean;
  pickPlace?: boolean;
  lastPt?: XY;
  /** work-area pan offset in screen px */
  pan: XY;
  /** Space held: temporary hand tool */
  spaceHeld?: boolean;
  /** the Space press was used for panning or a tool, so releasing it doesn't toggle playback */
  spaceUsed?: boolean;
  /** last tool used in each toolbar group */
  toolGroup: Record<string, string>;
  polySides: number;
  starPoints: number;
  /** inner/outer radius for new stars */
  starRatio?: number;
  /** pencil stroke in progress (document coordinates) */
  pencil?: XY[] | null;
  /** what the pen would do under the pointer (for the overlay) */
  penHint?: { kind: string; x: number; y: number } | null;
}
