// ui-to-canvas-capture.mjs — turns any real, already-built webpage into a
// self-contained "Main.dc.html" file: an editable Design Component that
// Claude Design's canvas editor (claude.ai/design, or the equivalent
// preview inside Claude Code) can open and let you drag/restyle freely.
//
// Requires Node.js and Playwright (`npm install playwright`) — no other
// setup. Works regardless of what built the page (React, plain JS, a
// framework, a static site) because it never reads that source at all; it
// only reads what a real browser renders.
//
// Core idea: don't copy CSS source rules by selector (a `.hero`, a `.btn`)
// — that misses anything that doesn't happen to share a class with your
// target, most dangerously a global reset. Instead, ask the BROWSER ITSELF
// for each element's fully resolved computed style, after every cascade,
// token and reset has already been applied, and bake that directly onto
// the element as an inline `style="..."` attribute. This can never miss a
// rule "that doesn't share a classname," because it never looks at
// stylesheet rules at all — only the browser's own final answer.
//
// Output: one flat HTML file with zero external CSS dependency. Open it in
// Claude Design's canvas (or hand it to Claude to publish there) to edit
// every element freely. There is no separate "return to code" tool here —
// mapping an edit back into your real source is a manual, judgment-driven
// step, not something this script does.
//
// Usage: node ui-to-canvas-capture.mjs <url> <selector> <outDir> [viewportWidth] ["click:sel|hover:sel|wait:ms|group:sel1,sel2|..."]

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [, , url, selector, outDir, vw, stepsArg] = process.argv;
if (!url || !selector || !outDir) {
  console.error('usage: node ui-to-canvas-capture.mjs <url> <selector> <outDir> [viewportWidth] ["click:sel|hover:sel|wait:ms|group:sel1,sel2|..."]');
  process.exit(1);
}
// Steps run in order before capture: click:<selector>, hover:<selector>,
// wait:<ms>. Needed for any state that takes more than one interaction to
// reach (sign in, then switch tab, then hover a specific bar to freeze its
// tooltip) — a single clickSelector couldn't express that sequence.
const STEPS = (stepsArg || '').split('|').filter(Boolean).map((s) => {
  const idx = s.indexOf(':');
  return { kind: s.slice(0, idx), arg: s.slice(idx + 1) };
});
const viewportWidth = parseInt(vw || '390', 10); // real default: iPhone-class width, not a guess

fs.mkdirSync(outDir, { recursive: true });

// Visually-relevant computed properties. Deliberately NOT "every CSS
// property" (there are ~300, most irrelevant to look) — this is the same
// curated-allowlist approach real "inline the page" tools use.
const PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'zIndex',
  'boxSizing', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'boxShadow', 'opacity', 'visibility', 'overflow', 'objectFit', 'objectPosition',
  'color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'textAlign', 'textDecoration', 'textTransform', 'whiteSpace', 'textWrap', 'verticalAlign',
  'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf',
  'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'rowGap', 'columnGap',
  'gridTemplateColumns', 'gridTemplateRows',
  'cursor', 'transform', 'direction', 'listStyleType',
];

// Tags whose captured height gets dropped when they're wrapping text (see
// the styleAttr() comment below) — declared once, up top, since both the
// in-browser capture pass and the Node-side renderer need the same set.
const TEXT_FLOW_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'li', 'label']);

const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
const page = await browser.newPage({ viewport: { width: viewportWidth, height: 1000 }, ignoreHTTPSErrors: true });

// Route around the known "Supabase CDN blocked -> whole page blank" bug
// (already logged, not this tool's job to fix) so capture can proceed.
await page.addInitScript(() => {
  window.supabase = window.supabase || { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    from: () => ({ select: async () => ({ data: [], error: null }) }),
  }) };
});

// 'networkidle' never fires on pages with continuous background traffic
// (ad networks, analytics beacons, live-price polling — Yahoo Finance is a
// real example) even though the actual content finished rendering long
// ago. Falling back to 'load' + a fixed settle time still gets a fully
// rendered page in that case, instead of the whole capture failing on a
// site that was never actually broken.
try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
} catch (e) {
  console.error('networkidle timed out, falling back to load:', e.message);
  await page.goto(url, { waitUntil: 'load', timeout: 20000 });
}
await page.waitForTimeout(800);

// The requested "just this" region is often several loose sibling elements
// in the real DOM (a heading block + a separately-bordered table, with no
// shared wrapper) rather than one element with a single selector. `group`
// moves those real elements (not clones — their own computed layout must
// travel with them) into one new wrapper div, in the order given, and that
// wrapper becomes the capture root. Their own inline spacing (e.g. a
// `margin-top` already on one of them) still applies once they're siblings
// inside the wrapper, so relative spacing is preserved without extra rules.
let rootSelector = selector;
let groupMeta = null; // set only by a `group` step — see below for why capture must NOT move DOM nodes
for (const step of STEPS) {
  if (step.kind === 'click') { await page.click(step.arg); await page.waitForTimeout(400); }
  else if (step.kind === 'hover') { await page.hover(step.arg); await page.waitForTimeout(200); }
  else if (step.kind === 'wait') { await page.waitForTimeout(parseInt(step.arg, 10)); }
  else if (step.kind === 'group') {
    const sels = step.arg.split(',');
    // NEVER move the real elements to build the group (an earlier version
    // did, via appendChild into a synthetic wrapper). Real, reproducible
    // bug found capturing 4 real dashboard panels: one used a CSS
    // container query to pick `flex-direction: column` vs `row` based on
    // ITS OWN rendered width/context. Re-parenting it into a new wrapper
    // changed that context, and its computed style silently flipped to a
    // different layout than the one actually on the page — confirmed by
    // reading the real page's computed style directly (`column`) against
    // the moved copy's (`row`). getComputedStyle is only ground truth for
    // an element that never left its real position. So: elements are
    // stamped in place with an id attribute (metadata only, changes
    // nothing visually or structurally) and their real positions are
    // recorded here; the actual grouping happens later, in the main
    // per-element style walk, by serializing each element AT ITS REAL
    // DOM POSITION and only THEN placing the resulting (already-correct)
    // node into a synthetic wrapper in the output tree — never in the
    // live page.
    groupMeta = await page.evaluate((sels) => {
      const els = sels.map((s) => {
        const el = document.querySelector(s);
        if (!el) throw new Error(`group: selector "${s}" not found`);
        return el;
      });
      const rects = els.map((el) => el.getBoundingClientRect());
      const unionLeft = Math.min(...rects.map((r) => r.left));
      const unionTop = Math.min(...rects.map((r) => r.top));
      const unionRight = Math.max(...rects.map((r) => r.right));
      const unionBottom = Math.max(...rects.map((r) => r.bottom));
      const items = els.map((el, i) => {
        const id = `__capture_group_item_${i}__`;
        el.setAttribute('data-capture-group-id', id);
        return { id, left: rects[i].left - unionLeft, top: rects[i].top - unionTop };
      });
      return { unionW: unionRight - unionLeft, unionH: unionBottom - unionTop, items };
    }, sels);
  }
  else { console.error(`unknown step kind "${step.kind}" in "${step.kind}:${step.arg}"`); process.exit(1); }
}

// A webfont (Heebo/Inter here) can still be swapping in when steps finish —
// networkidle only proves the font FILE arrived, not that the font FACE has
// applied and reflowed text. Measuring the root's height before that swap
// bakes a too-short height (fallback-font line metrics) into this hardcoded
// `height:__px;overflow:hidden` wrapper, while the deeper per-element walk
// below runs a moment later and reads the taller, post-swap row heights —
// so real content quietly clips against the too-small shell. Waiting for
// fonts.ready first makes both measurements agree.
await page.evaluate(() => document.fonts.ready);

let rootBox;
if (groupMeta) {
  // The union rect was already measured, live, before anything else ran —
  // that IS the real root box; no single live element to re-measure.
  rootBox = { width: groupMeta.unionW, height: groupMeta.unionH };
} else {
  const rootHandle = await page.$(rootSelector);
  if (!rootHandle) {
    console.error(`selector "${rootSelector}" not found on ${url}`);
    process.exit(1);
  }
  rootBox = await rootHandle.boundingBox();
}

// Walk the subtree in-browser: for each element, dump tag, attrs, computed
// style (only props that differ from a bare <div>'s defaults, to keep output
// readable), and recurse. Images noted for extraction, not inlined here.
const tree = await page.evaluate(({ rootSel, PROPS, textFlowTags, groupMeta }) => {
  const IMG_URL_RE = /url\((['"]?)(.*?)\1\)/;
  const TEXT_FLOW_TAGS_BROWSER = new Set(textFlowTags);

  function computedOf(el) {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of PROPS) out[p] = cs[p];
    return out;
  }

  function serialize(el) {
    if (el.nodeType === Node.TEXT_NODE) {
      const t = el.textContent;
      if (!t) return null;
      // A whitespace-only text node (e.g. the literal " " between
      // `<span>+60.75</span> <span>+0.80%</span>`) still renders as a real
      // separating space when it sits between inline content — dropping it
      // via a bare `.trim()` check (real bug: a price and its percent
      // change came out jammed together with no space) silently ate that
      // space. Collapse it to one space instead of discarding it outright;
      // harmless when it's actually insignificant block-boundary
      // whitespace, since that just adds an invisible extra space there.
      return t.trim() ? { type: 'text', text: t } : (/\s/.test(t) ? { type: 'text', text: ' ' } : null);
    }
    if (el.nodeType !== Node.ELEMENT_NODE) return null;
    const cs = getComputedStyle(el);
    // NOSCRIPT: invisible in a real browser with JS on, but the canvas
    // editor's frame-safety scanner refuses to preview ANY artboard that
    // contains one at all (can't verify what it hides with scripting on) —
    // so a full-page ("body") capture of any SPA must drop it, not just
    // elements that are actually display:none.
    if (cs.display === 'none' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') return null;

    // SVG icons: their visual content lives in attributes (d, viewBox, fill,
    // stroke-width...) that plain getComputedStyle().style flattening never
    // captures, so decomposing an <svg> into styled children renders empty
    // boxes. Keep the whole subtree as one raw HTML blob instead — icons are
    // small and self-contained, and their own inline sizing/color already
    // travels via currentColor + the wrapper's captured layout style.
    //
    // Exception: a chart-style SVG's fill/stroke can be set by anything the
    // stylesheet does — a literal `var(--token)` reference, or a :hover/
    // :focus-visible rule (e.g. a transparent hit-target that darkens on
    // hover) — never assume the raw attribute is the final answer. The
    // captured page never ships that stylesheet, so a literal var() or a
    // pseudo-class rule both resolve to nothing once replayed. Fix: always
    // read the LIVE computed fill/stroke (getComputedStyle reflects the
    // truth right now, hover state included) and bake that into a clone
    // before taking its outerHTML — never mutate the live page itself, and
    // never trust the static attribute over what's actually rendering.
    if (el.tagName === 'svg') {
      const live = [el, ...el.querySelectorAll('*')];
      const resolved = live.map((node) => {
        const hasFillAttr = node.hasAttribute && node.hasAttribute('fill');
        const hasStrokeAttr = node.hasAttribute && node.hasAttribute('stroke');
        const ncs = getComputedStyle(node);
        return {
          fill: hasFillAttr ? ncs.fill : null,
          stroke: hasStrokeAttr ? ncs.stroke : null,
          // A chart SVG's own inline <style> block (e.g. a stroke-dasharray
          // rule, sometimes gated behind a @container query) works fine
          // rendered standalone, but a viewer that sanitizes embedded HTML
          // before display can legitimately strip <style> tags — including
          // ones nested inside an SVG — as an XSS precaution, silently
          // undoing whatever that rule did. Bake the resolved dash pattern
          // straight onto the element as an attribute so the line/area
          // chart looks right with or without that stylesheet surviving.
          strokeDasharray: hasStrokeAttr ? ncs.strokeDasharray : null,
        };
      });
      const clone = el.cloneNode(true);
      const cloned = [clone, ...clone.querySelectorAll('*')];
      cloned.forEach((node, i) => {
        if (resolved[i].fill) node.setAttribute('fill', resolved[i].fill);
        if (resolved[i].stroke) node.setAttribute('stroke', resolved[i].stroke);
        if (resolved[i].strokeDasharray) node.setAttribute('stroke-dasharray', resolved[i].strokeDasharray);
      });
      // Every value this SVG needs is now baked directly onto its elements
      // as attributes (fill/stroke/stroke-dasharray above; d/viewBox/etc.
      // were already real attributes) — an inline <style> block only ever
      // set presentation details that are now redundant, and removing it
      // means nothing breaks if a viewer's sanitizer strips <style> tags
      // (including ones nested inside SVGs) before display.
      clone.querySelectorAll('style').forEach((s) => s.remove());
      // A chart SVG sized only via CSS (style="width:100%;height:100%"),
      // with no width/height ATTRIBUTE and only a viewBox, relies on the
      // embedding page's own box model to resolve that percentage — a
      // viewer with a different CSS reset or box-sizing default for SVG
      // can resolve it against the wrong box and render the chart
      // stretched, clipped, or collapsed. Pin real width/height attributes
      // (using the just-measured layout size) alongside the CSS, so sizing
      // no longer depends on how any particular viewer computes percentages
      // for an un-attributed SVG.
      if (!clone.hasAttribute('width') && !clone.hasAttribute('height')) {
        const liveRect = el.getBoundingClientRect();
        if (liveRect.width > 0 && liveRect.height > 0) {
          clone.setAttribute('width', String(Math.round(liveRect.width)));
          clone.setAttribute('height', String(Math.round(liveRect.height)));
        }
      }
      // A sprite-sheet icon (`<use href="#chevron-down-icon">`) points at a
      // <symbol> defined once, elsewhere in the real page's DOM (often a
      // hidden sprite injected near <body>) — never inside this SVG's own
      // subtree. Copied as raw outerHTML in isolation, that id doesn't
      // exist anywhere in the output file, so the <use> resolves to
      // nothing and the icon silently vanishes. Fix: resolve every <use>
      // against the LIVE document right now and inline a clone of whatever
      // it points to as a local <defs>, so the reference still works once
      // this SVG is the only thing left in the file.
      const uses = clone.querySelectorAll('use');
      if (uses.length) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        uses.forEach((use) => {
          const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
          const id = href.startsWith('#') ? href.slice(1) : null;
          if (!id) return;
          const target = document.getElementById(id);
          if (target) defs.appendChild(target.cloneNode(true));
        });
        if (defs.children.length) clone.insertBefore(defs, clone.firstChild);
      }
      return { type: 'raw', html: clone.outerHTML, style: computedOf(el) };
    }

    // <canvas> (charts drawn via the Canvas/WebGL API) and <iframe> (a
    // YouTube embed, any cross-origin widget) both have NOTHING for
    // getComputedStyle or DOM-walking to find — one paints pixels with no
    // markup, the other's content lives in a different, inaccessible
    // document entirely. Rather than emit an empty/blank box (found live:
    // a real YouTube embed on a real dashboard rendered as a solid black
    // rectangle), flag it here (a live DOM mutation: a stamped id) so the
    // Node side can screenshot the actual element with Playwright right
    // before closing the browser, and swap in that screenshot as a plain
    // image. The visual result survives; only fine-grained editing of
    // what's INSIDE it doesn't — the same trade this tool already makes
    // for SVG icons, extended to the other cases where decomposition is
    // impossible in principle, not just impractical.
    if (el.tagName === 'CANVAS' || el.tagName === 'IFRAME') {
      const id = `__capture_shot_${window.__captureShotCounter = (window.__captureShotCounter || 0) + 1}__`;
      el.setAttribute('data-capture-shot-id', id);
      return { type: 'screenshot-placeholder', shotId: id, style: computedOf(el) };
    }

    const node = {
      type: 'el',
      tag: el.tagName.toLowerCase(),
      style: computedOf(el),
      children: [],
    };
    if (el.tagName === 'IMG') {
      node.src = el.currentSrc || el.src;
      node.alt = el.getAttribute('alt') || '';
      node.naturalW = el.naturalWidth;
      node.naturalH = el.naturalHeight;
    }
    if (el.tagName === 'A') node.href = el.getAttribute('href') || '#';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      node.placeholder = el.getAttribute('placeholder') || '';
      node.inputType = el.getAttribute('type') || 'text';
    }
    // Text that is CURRENTLY one line (not actually using its width to wrap)
    // gets its width captured as the exact content width with zero slack —
    // any host that renders a fraction of a pixel narrower (different font
    // hinting, subpixel rounding, an editor's own chrome) tips it into
    // wrapping. Flag it so the Node-side renderer can drop the exact width
    // and force nowrap instead, which real wrapping text still needs its
    // width for and keeps.
    //
    // Guarded to elements that actually HAVE text: a purely decorative,
    // empty tag (a legend swatch, a bullet/status dot — a <span> sized only
    // via CSS, no text node inside it) is not "one line of text" at all,
    // but its own scrollHeight (its literal box height, e.g. 10px) nearly
    // always sits under the ambient line-height it inherits — the same
    // check meant for text false-positives on it, and BOTH width and
    // height then get silently dropped from a real, explicitly-sized box,
    // collapsing it to nothing. Real bug, found capturing an ordinary
    // colored-dot legend swatch.
    if (TEXT_FLOW_TAGS_BROWSER.has(el.tagName.toLowerCase()) && el.textContent.trim()) {
      node.singleLine = el.scrollHeight <= parseFloat(cs.lineHeight) * 1.3;
    }
    const bgMatch = IMG_URL_RE.exec(cs.backgroundImage);
    if (bgMatch && bgMatch[2] && !bgMatch[2].startsWith('data:')) {
      node.bgImageUrl = new URL(bgMatch[2], location.href).href;
    }
    for (const child of el.childNodes) {
      const s = serialize(child);
      if (s) node.children.push(s);
    }
    return node;
  }

  // Group mode: each real element is serialized IN PLACE (still attached
  // at its real DOM position, so container queries and any other
  // context-dependent CSS resolve exactly as they do on the live page),
  // and only the already-correct RESULT is placed into a synthetic
  // wrapper node — the live page itself is never touched. See the `group`
  // step above for the real bug this replaced (moving elements first
  // corrupted a container-query-driven layout).
  if (groupMeta) {
    const children = groupMeta.items.map((item) => {
      const el = document.querySelector(`[data-capture-group-id="${item.id}"]`);
      if (!el) return null;
      const node = serialize(el);
      if (!node) return null;
      node.style.position = 'absolute';
      node.style.left = item.left + 'px';
      node.style.top = item.top + 'px';
      node.style.right = 'auto';
      node.style.bottom = 'auto';
      node.style.margin = '0px';
      return node;
    }).filter(Boolean);
    const wrapperStyle = Object.fromEntries(PROPS.map((p) => [p, '']));
    wrapperStyle.position = 'relative';
    wrapperStyle.width = groupMeta.unionW + 'px';
    wrapperStyle.height = groupMeta.unionH + 'px';
    wrapperStyle.display = 'block';
    return { type: 'el', tag: 'div', style: wrapperStyle, children };
  }

  const root = document.querySelector(rootSel);
  const tree = serialize(root);

  // Floating companions (tooltips, popovers): position:fixed, so they're
  // WHATEVER is visible in the viewport, not necessarily inside `root` at
  // all (a tooltip is typically appended to <body> for z-index/overflow
  // reasons, wherever its trigger lives). If root doesn't already contain
  // one, look outside it: any visible fixed-position element not inside
  // root is almost certainly a hover/focus companion meant to be read
  // alongside whatever's captured. Splice it in, repositioned relative to
  // root's own box instead of the viewport — a fixed element's numbers are
  // meaningless without the exact scroll position they were measured at,
  // which a static capture can never reproduce.
  if (tree) {
    const rootRect = root.getBoundingClientRect();
    const candidates = [...document.querySelectorAll('body *')].filter((elCand) => {
      if (root.contains(elCand)) return false;
      const s = getComputedStyle(elCand);
      return s.position === 'fixed' && s.display !== 'none' && s.visibility !== 'hidden' && elCand.getBoundingClientRect().width > 0;
    });
    for (const floater of candidates) {
      const node = serialize(floater);
      if (!node) continue;
      const fr = floater.getBoundingClientRect();
      node.style.position = 'absolute';
      node.style.left = (fr.left - rootRect.left) + 'px';
      node.style.top = (fr.top - rootRect.top) + 'px';
      node.style.right = 'auto';
      node.style.bottom = 'auto';
      tree.children.push(node);
    }
  }
  return tree;
}, { rootSel: rootSelector, PROPS, textFlowTags: [...TEXT_FLOW_TAGS], groupMeta });

// Screenshot every <canvas>/<iframe> placeholder while the browser (and the
// real page) is still open — this MUST happen before browser.close(), and
// each one is queried fresh by its stamped id rather than reused from
// earlier, since the group step (if any) never moves elements and this is
// the first point some of them get individually addressed.
const screenshotNodes = [];
(function collectScreenshotNodes(node) {
  if (!node) return;
  if (node.type === 'screenshot-placeholder') screenshotNodes.push(node);
  if (node.children) node.children.forEach(collectScreenshotNodes);
})(tree);
let shotCounter = 0;
for (const node of screenshotNodes) {
  shotCounter += 1;
  const handle = await page.$(`[data-capture-shot-id="${node.shotId}"]`);
  if (!handle) { console.error(`screenshot placeholder "${node.shotId}" vanished before capture`); continue; }
  const filename = `shot${shotCounter}.jpg`;
  try {
    await handle.screenshot({ path: path.join(outDir, filename), type: 'jpeg', quality: 70 });
    node._filename = filename;
  } catch (e) {
    console.error('canvas/iframe screenshot failed:', node.shotId, e.message);
  }
}

await browser.close();

// ---- Collect + fetch images referenced anywhere in the tree ----
const images = []; // {url, filename}
function collectImages(node) {
  if (!node || node.type !== 'el') return;
  if (node.src) images.push(node);
  if (node.bgImageUrl) images.push({ src: node.bgImageUrl, isBg: true, node });
  node.children.forEach(collectImages);
}
collectImages(tree);

let counter = 0;
for (const img of images) {
  const src = img.src;
  if (!src) continue;
  counter += 1;
  const ext = (src.split('.').pop() || 'jpg').split('?')[0].slice(0, 4);
  const rawPath = path.join(outDir, `_raw_${counter}.${ext}`);
  let buf;
  try {
    const resp = await fetch(src);
    buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(rawPath, buf);
  } catch (e) {
    console.error('image fetch failed:', src, e.message);
    continue;
  }
  // Real UIs commonly use an SVG as a background-image (decorative patterns,
  // gradients, icons) or as an <img> src — Pillow can only decode raster
  // formats and throws UnidentifiedImageError on one, crashing the whole
  // capture. Detected by CONTENT, not the URL's extension: a URL can serve
  // an SVG with no ".svg" in it at all (found capturing a real external
  // site's banner). An SVG is already small vector text, so it's copied
  // through as-is rather than run through the raster downsample pipeline.
  const isSvg = /^\s*(<\?xml|<svg)/i.test(buf.slice(0, 256).toString('utf8'));
  const finalName = isSvg ? `img${counter}.svg` : `img${counter}.jpg`;
  if (isSvg) {
    fs.renameSync(rawPath, path.join(outDir, finalName));
  } else {
    // downsample/recompress to keep each asset well under the canvas's per-image budget
    execSync(`python3 -c "
from PIL import Image
im = Image.open('${rawPath}').convert('RGB')
w,h = im.size
scale = min(1, 700/w)
im2 = im.resize((max(1,int(w*scale)), max(1,int(h*scale))))
im2.save('${path.join(outDir, finalName)}', format='JPEG', quality=62)
"`);
    fs.unlinkSync(rawPath);
  }
  if (img.isBg) img.node._bgFilename = finalName;
  else img._filename = finalName;
}

// ---- Render tree back to HTML with inline styles ----
// Forcing a literal height on a text-wrapping element freezes it at capture
// time's line count; if the flattened re-render wraps even slightly
// differently (sub-pixel width rounding, font timing), the text overflows
// that frozen box and visually overlaps the next sibling instead of
// reflowing. Width alone reproduces the same wrap point; height must stay
// auto for these tags, like real text does. Structural/leaf tags (img, div,
// section, picture) keep their captured height — they have no text to reflow.
// 'a'/'button' are excluded on purpose: they're usually white-space:nowrap
// (single line, deterministic height), where forcing height is safe and
// keeps consistent control sizing.
const RADIUS_KEYS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];

function styleAttr(style, node) {
  const decls = [];
  // Emit the 4 computed corner values as ONE shorthand `border-radius`
  // declaration, not 4 longhand ones. The canvas editor's "Radius" panel
  // field is bound to the shorthand property only — longhand corners render
  // correctly but read back as 0 in the panel, and the first edit through
  // that field then writes `border-radius:0` inline, silently squaring off
  // corners that were actually rounded. Collapsing here keeps panel and
  // render in sync from the start.
  if (RADIUS_KEYS.every((k) => style[k] !== undefined && style[k] !== null && style[k] !== '')) {
    decls.push(`border-radius:${RADIUS_KEYS.map((k) => style[k]).join(' ')}`);
  }
  // node.children.length === 0 catches the same empty-decorative-tag case
  // as the browser-side textContent check above: a childless <span>/<label>
  // etc. isn't flowing text at all, so it must keep its real height (an
  // empty, explicitly-sized swatch/dot would otherwise collapse to nothing).
  const dropHeight = TEXT_FLOW_TAGS.has(node.tag) && style.whiteSpace === 'normal' && !!(node.children && node.children.length > 0);
  // A single-line label's captured width is its exact content width with
  // zero slack (see the singleLine flag set during capture) — drop it and
  // force nowrap so a host that renders a hair narrower can't wrap it.
  // Real wrapping text (singleLine === false) keeps its width; that's what
  // fixes the wrap POINT.
  const dropWidthForNowrap = dropHeight && node.singleLine === true;
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || v === null || v === '') continue;
    if (RADIUS_KEYS.includes(k)) continue; // already emitted as shorthand above
    if (k === 'height' && dropHeight) continue;
    if (k === 'width' && dropWidthForNowrap) continue;
    if (k === 'whiteSpace' && dropWidthForNowrap) { decls.push('white-space:nowrap'); continue; }
    // Modern Chrome's `text-wrap` is a separate longhand from the legacy
    // `white-space` keyword, and when both are present as literal inline
    // declarations, `text-wrap` wins — so the captured page's real
    // `text-wrap:wrap` (present on ordinary paragraph/heading text) was
    // silently overriding the `white-space:nowrap` just forced above,
    // un-fixing the exact wrap-fragility bug that fix exists for. A real
    // title visibly wrapped to 2 lines in the canvas because of this.
    if (k === 'textWrap' && dropWidthForNowrap) { decls.push('text-wrap:nowrap'); continue; }
    const cssKey = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    let val = v;
    // `position:fixed` is relative to the VIEWPORT, which only means anything
    // in a live, scrollable browser tab — a static capture has no viewport of
    // its own, just the artboard's own coordinate space. A tooltip/popover
    // shown via a hover step keeps its exact left/top numbers (baked at
    // capture time, still correct within the artboard) but needs to anchor
    // to the artboard container instead of "the viewport", which is exactly
    // what position:absolute does here since the root wrapper is
    // position:relative and starts at the same (0,0) the fixed coords were
    // measured from.
    if (k === 'position' && v === 'fixed') val = 'absolute';
    if (k === 'backgroundImage' && node && node._bgFilename) {
      val = `url("${node._bgFilename}")`;
    } else if (k === 'backgroundImage' && val.includes('url(')) {
      continue; // no local file resolved for this one — drop rather than ship a broken/remote url
    }
    // A computed value can legitimately contain a literal double-quote —
    // font-family is the common case (`"Segoe UI", sans-serif`). This whole
    // declaration string is about to be embedded inside an HTML
    // `style="..."` attribute, itself double-quoted; an unescaped `"` here
    // closes that attribute early, and every declaration after it in
    // property order is silently dropped from the parsed HTML — a real,
    // serious bug (found because "text-decoration:none", positioned after
    // font-family in the property list, never took effect: the whole
    // attribute string was truncated right after `font-family:"Segoe`).
    // CSS accepts single quotes for the exact same string, so swapping
    // avoids needing full HTML-entity escaping.
    if (typeof val === 'string' && val.includes('"')) val = val.replace(/"/g, "'");
    decls.push(`${cssKey}:${val}`);
  }
  return decls.join(';');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const VOID = new Set(['img', 'br', 'hr', 'input']);

function render(node) {
  if (node.type === 'text') return escapeHtml(node.text);
  if (node.type === 'raw') {
    // Wrap so the captured layout/sizing style (margins, flex sizing, color
    // for currentColor icons) still applies, while the inner markup keeps
    // its real d/viewBox/fill attributes untouched.
    return `<span style="${styleAttr(node.style, node)};display:inline-flex">${node.html}</span>`;
  }
  if (node.type === 'screenshot-placeholder') {
    // A <canvas>/<iframe> that got individually screenshotted (see the
    // pass right before browser.close() above) renders as a plain image —
    // same visual result, no pretense of it being editable inside.
    if (!node._filename) return '';
    return `<img style="${styleAttr(node.style, node)}" src="${node._filename}" alt="">`;
  }
  if (node.type !== 'el') return '';
  const attrs = [`style="${styleAttr(node.style, node)}"`];
  if (node.tag === 'a') attrs.push(`href="${node.href}"`);
  if (node.tag === 'img') {
    attrs.push(`src="${node._filename || ''}"`);
    attrs.push(`alt="${escapeHtml(node.alt || '')}"`);
  }
  if (node.tag === 'input' || node.tag === 'textarea') {
    attrs.push(`placeholder="${escapeHtml(node.placeholder || '')}"`);
    if (node.tag === 'input') attrs.push(`type="${node.inputType || 'text'}"`);
  }
  const openTag = `<${node.tag} ${attrs.join(' ')}>`;
  if (VOID.has(node.tag)) return openTag;
  const inner = node.children.map(render).join('');
  return `${openTag}${inner}</${node.tag}>`;
}

const bodyHtml = render(tree);
const w = Math.round(rootBox.width);
const h = Math.round(rootBox.height);

// Carry over the page's real Google Fonts <link> tags (the one external
// resource the canvas sandbox actually allows) rather than guessing fonts.
// Also carry over any @font-face rule declared inline in the page's own
// stylesheets — ligature-based icon fonts (Google's "Material Icons" /
// "Google Symbols": the icon is literal text like "settings" or
// "keyboard_arrow_down", substituted for a glyph only once that specific
// font is loaded) are shipped this way, not as a fonts.googleapis.com
// <link>. Without it, font-family is captured correctly (that PROP is in
// the list) but the font itself never arrives, so the browser falls back
// to a system font and the literal icon-name text shows verbatim instead
// of an icon. Real bug, found on a page whose entire icon set (settings,
// search, every dropdown chevron) is built this way.
const fontLinks = await (async () => {
  const b2 = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const p2 = await b2.newPage({ ignoreHTTPSErrors: true });
  await p2.addInitScript(() => { window.supabase = window.supabase || { createClient: () => ({ auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}) }, from: () => ({select: async () => ({data:[],error:null})}) }) }; });
  await p2.goto(url, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
  await p2.waitForTimeout(1000);
  const links = await p2.evaluate(() =>
    [...document.querySelectorAll('link[href*="fonts.googleapis.com"]')].map((l) => l.outerHTML)
  );
  const fontFaceRules = await p2.evaluate(() => {
    const out = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.constructor.name === 'CSSFontFaceRule') out.push(rule.cssText);
        }
      } catch (e) { /* cross-origin sheet — can't read its rules, skip it */ }
    }
    return out;
  });
  await b2.close();
  const styleBlock = fontFaceRules.length ? `<style>\n${fontFaceRules.join('\n')}\n</style>` : '';
  return links.join('\n  ') + '\n  ' + styleBlock;
})();

const dcHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  ${fontLinks}
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin: 0; }
    a { color: inherit; text-decoration: none; }
  </style>
</helmet>
<div style="width:${w}px;height:${h}px;overflow:hidden;position:relative;">
${bodyHtml}
</div>
</x-dc>
</body>
</html>
`;

fs.writeFileSync(path.join(outDir, 'Main.dc.html'), dcHtml);
console.log(`wrote ${path.join(outDir, 'Main.dc.html')} — root captured at ${w}x${h}px (real rendered size @ ${viewportWidth}px viewport), ${images.length} image(s)`);
