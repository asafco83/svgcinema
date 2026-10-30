# Feature suggestions

Ideas for later, from comparing SVGcinema with SVGator and other animation apps (Rive, Jitter, LottieFiles Creator, Keyshape, After Effects). Export formats are left out on purpose.

Gradients and trim path have been taken off this list and are being built.

## Big impact

- **Stagger / offset**: shift the selected layers' animations by N seconds each, for cascades. This is one of the most requested features in these tools.
- **Text animators**: animate text per letter, word or line, for example fading or sliding letters in one by one.
- **Per-element interactivity**: hover or click on a specific layer plays an animation or jumps to a time. Rive goes further with full state machines.

## Workflow

- **Help & tutorials, the rest of the topics**: three topics have their pages and guided tours (Your first animation, Keyframes and tracks, Easing); the other planned topics (listed in `src/help/content.json` without `ready`) follow a group at a time, with ⓘ tips and the F1 list linking to them, and a keyboard reference page on the website.
- **Path tools**: outline stroke (stroke → fill), offset path, simplify, reverse path direction.
- **Copy / paste extras**: copy and paste a layer's style or animation onto other layers.

## Polish

- **Wiggle / loop modifiers**: random jitter, and repeating part of a track.
- **Accessibility in exports**: title and description (respecting reduced-motion settings is built: Export › Less motion).

## Export

- **External player**: create the player as an external JS player to be run on a page to control JS animated SVGs without an internal player.
- **Export window facelift**: facelift the export window - feels that was skipped in previous facelift.

## animated SVG parsing

- **Open SVG as project**: Open SVG as a project with all layers, structure & animations reconstructed.
- **import SVG asset**: import SVG with all layers, structure & animations reconstructed into existing project.

## Tools

- **Bones improvements**: research and improve bones creation, editing flow, and behaviour.
- **puppet pin tool**: research and use bones -or- a Puppet pin tool to deform shapes and/or images. Check if applicable in CSS/JS export
