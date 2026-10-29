// The Claude skill: a folder with SKILL.md that points Claude at window.svgcinema. The agent panel zips it in the
// browser (Your AI assistant › Download the skill), and scripts/build-player.mjs writes the same zip to
// dist/downloads/svgcinema-skill.zip for the website. No imports: the build script loads this file on its own.
/** The Claude skill: a folder with SKILL.md that points Claude at window.svgcinema. */
export const SKILL_MD = `---
name: svgcinema
description: Make, edit and animate artwork in SVGcinema (an animated SVG editor open in a browser tab) through its window.svgcinema tools. Use when the user asks for drawing or animation in SVGcinema, or in an svgcinema tab.
---

# SVGcinema

SVGcinema runs in the user's browser tab and has a JavaScript API for assistants: \`window.svgcinema\`.

1. In the SVGcinema tab, run \`window.svgcinema.help()\` with your page-script tool and read all of it: it explains how to work, the rules and every tool, and it follows the user's current settings (for example how to handle images).
2. Follow it: \`svgcinema.start({ task, assistant })\`, then \`await svgcinema.call(name, args)\` (or \`svgcinema.batch([...])\`), then \`svgcinema.done(summary)\`. Everything between start and done is one undo step for the user.
3. Look at your work with a screenshot of the tab, and fix what looks wrong.

If \`window.svgcinema\` is missing, the tab isn't SVGcinema (or it is still loading): ask the user to open their project at https://asafco83.github.io/svgcinema/.
`;
