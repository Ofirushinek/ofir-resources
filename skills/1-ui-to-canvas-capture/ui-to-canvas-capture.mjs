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
  'boxShadow', 'opacity', 'overflow', 'objectFit', 'objectPosition',
  'color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'textAlign', 'textDecoration', 'textTransform', 'whiteSpace', 'textWrap',
  'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf',
  'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'rowGap', 'columnGap',
  'gridTemplateColumns', 'gridTemplateRows',
  'cursor', 'transform', 'direction',
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

await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
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
for (const step of STEPS) {
  if (step.kind === 'click') { await page.click(step.arg); await page.waitForTimeout(400); }
  else if (step.kind === 'hover') { await page.hover(step.arg); await page.waitForTimeout(200); }
  else if (step.kind === 'wait') { await page.waitForTimeout(parseInt(step.arg, 10)); }
  else if (step.kind === 'group') {
    const sels = step.arg.split(',');
    rootSelector = await page.evaluate((sels) => {
      // Resolve every selector BEFORE moving anything: a selector like
      // ".x + div" is relative to live sibling position, so moving the
      // first match out of place would break the lookup for the next one.
      const els = sels.map((s) => {
        const el = document.querySelector(s);
        if (!el) throw new Error(`group: selector "${s}" not found`);
        return el;
      });
      const wrapper = document.createElement('div');
      wrapper.id = '__capture_group__';
      // The final artboard always wraps its root in `overflow:hidden`
      // (below, once bounding box is baked), which establishes a new block
      // formatting context and stops the first child's top margin from
      // collapsing through to the wrapper's outside — that margin then
      // counts INSIDE the box instead. Setting the same BFC-establishing
      // style here, before measuring, makes this measurement match that
      // final rendering; skipping it would silently bake a height short by
      // exactly that margin, clipping real content under `overflow:hidden`.
      wrapper.style.overflow = 'hidden';
      els[0].parentElement.insertBefore(wrapper, els[0]);
      for (const el of els) wrapper.appendChild(el);
      return '#__capture_group__';
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

const rootHandle = await page.$(rootSelector);
if (!rootHandle) {
  console.error(`selector "${rootSelector}" not found on ${url}`);
  process.exit(1);
}
const rootBox = await rootHandle.boundingBox();

// Walk the subtree in-browser: for each element, dump tag, attrs, computed
// style (only props that differ from a bare <div>'s defaults, to keep output
// readable), and recurse. Images noted for extraction, not inlined here.
const tree = await page.evaluate(({ rootSel, PROPS, textFlowTags }) => {
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
      return t.trim() ? { type: 'text', text: t } : null;
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
        };
      });
      const clone = el.cloneNode(true);
      const cloned = [clone, ...clone.querySelectorAll('*')];
      cloned.forEach((node, i) => {
        if (resolved[i].fill) node.setAttribute('fill', resolved[i].fill);
        if (resolved[i].stroke) node.setAttribute('stroke', resolved[i].stroke);
      });
      return { type: 'raw', html: clone.outerHTML, style: computedOf(el) };
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
}, { rootSel: rootSelector, PROPS, textFlowTags: [...TEXT_FLOW_TAGS] });

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
  try {
    const resp = await fetch(src);
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(rawPath, buf);
  } catch (e) {
    console.error('image fetch failed:', src, e.message);
    continue;
  }
  const finalName = `img${counter}.jpg`;
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
const fontLinks = await (async () => {
  const b2 = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const p2 = await b2.newPage({ ignoreHTTPSErrors: true });
  await p2.addInitScript(() => { window.supabase = window.supabase || { createClient: () => ({ auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}) }, from: () => ({select: async () => ({data:[],error:null})}) }) }; });
  await p2.goto(url, { waitUntil: 'domcontentloaded' });
  const links = await p2.evaluate(() =>
    [...document.querySelectorAll('link[href*="fonts.googleapis.com"]')].map((l) => l.outerHTML)
  );
  await b2.close();
  return links.join('\n  ');
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
