// SVGcinema — entry point
import './styles/app.css';
import { init as init0 } from './ui/tools-rail';
import { init as init1 } from './tools/stage-input';
import { init as init2 } from './ui/layers-panel';
import { init as init3 } from './ui/timeline';
import { init as init4 } from './core/keyframes';
import { init as init5 } from './ui/inspector';
import { init as init6 } from './io/assets';
import { init as init7 } from './export/snippets';
import { init as init8 } from './export/size';
import { init as init9 } from './export/images';
import { init as initExportSections } from './export/sections';
import { init as initExportKind } from './export/kind';
import { init as initExportStill } from './export/still';
import { init as init10 } from './ui/topbar';
import { init as init11 } from './ui/file-menu';
import { init as init12 } from './io/save';
import { init as init13 } from './io/guard';
import { init as init14 } from './io/open';
import { init as init15 } from './ui/keyboard';
import { init as init16 } from './app/boot';
import { init as initHand } from './tools/hand';
import { init as initAnim } from './ui/animate-menu';
import { init as initZoom } from './ui/zoom-menu';
import { init as initLayerMenu } from './ui/layer-menu';
import { init as initViewMenu } from './ui/view-menu';
import { init as initGuides } from './render/guides';
import { init as initPicker } from './ui/color-picker';
import { init as initFontPicker } from './ui/font-picker';
import { init as initPresets } from './ui/presets-panel';
import { init as initOnion } from './ui/onion';
import { init as initGraph } from './ui/graph';
import { init as initSymbols } from './ui/symbols-ui';
import { initTheme } from './ui/theme';
import { init as initRanges } from './ui/ranges';
import { initScaleBar } from './tools/bone-edit';
import { initPinBar } from './tools/pins';
import { initDrawOrderDrag } from './ui/inspector';
import { initFilterDrag } from './ui/props-panel';
import { initTlResize } from './ui/tl-resize';
import { initShortcuts } from './ui/shortcuts';
import { initScrub } from './ui/scrub';
import { init as initAgent } from './ui/agent-panel';
import { init as initEasePop } from './ui/ease-pop';

// Same order as the original single-file build
initTheme(); // ui/theme (before the rail renders its button)
initRanges(); // ui/ranges (slider fill)
init0(); // ui/tools-rail
init1(); // tools/stage-input
initScaleBar(); // tools/bone-edit (Scale bone options)
initPinBar(); // tools/pins (Pin tool options: Bind to bones)
initDrawOrderDrag(); // ui/inspector (a rig's own draw order list)
initFilterDrag(); // ui/props-panel (filter cards: drag to reorder, the Add filter menu)
initHand(); // tools/hand
initAnim(); // ui/animate-menu
initZoom(); // ui/zoom-menu
initLayerMenu(); // ui/layer-menu
initViewMenu(); // ui/view-menu
initGuides(); // render/guides
initPicker(); // ui/color-picker
initFontPicker(); // ui/font-picker
initPresets(); // ui/presets-panel
initOnion(); // ui/onion
initGraph(); // ui/graph
initSymbols(); // ui/symbols-ui
init2(); // ui/layers-panel
init3(); // ui/timeline
initTlResize(); // ui/tl-resize (drag the timeline's top edge)
initShortcuts(); // ui/shortcuts (the Keyboard shortcuts window, F1)
initScrub(); // ui/scrub (drag a number field's label to change it)
init4(); // core/keyframes
init5(); // ui/inspector
init6(); // io/assets
init7(); // export/snippets
init8(); // export/size
init9(); // export/images
initExportSections(); // export/sections (the Export dialog's collapsing sections)
initExportKind(); // export/kind (the Export dialog's picker: Animated SVG, Image…)
initExportStill(); // export/still (Export › Image)
init10(); // ui/topbar
init11(); // ui/file-menu
init12(); // io/save
init13(); // io/guard
init14(); // io/open
initAgent(); // ui/agent-panel (the design agent, docked on the right)
initEasePop(); // ui/ease-pop (the Easing panel of the timeline header)
init15(); // ui/keyboard
init16(); // app/boot
