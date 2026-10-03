#!/usr/bin/env node
/**
 * Build a browser harness that exercises `lib/client.js` without DSH.
 *
 * The harness fakes only what DSH itself provides:
 *
 *   - `window.__ModuleLoader__`, the self-registration entry point
 *   - the `react` module (fetched from unpkg and cached under `test/.cache`)
 *   - a cordis context whose `documentPreviews.register` and `slots.register`
 *     record what the plugin asked for, instead of mounting it
 *
 * Everything that matters — the renderer definition, the body component, the
 * zoom/pan viewport — is the real code under test, inlined verbatim.
 *
 * The test image is drawn on a canvas at run time, so no binary fixture is
 * committed and the harness stays deterministic.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CACHE = join(HERE, ".cache");

/* React 18 still ships UMD builds, which is what lets the harness run from a
   plain file:// page with no bundler. The plugin itself uses the host's react. */
const REACT_VERSION = "18.3.1";
const VENDOR = {
	"react.development.js": `https://unpkg.com/react@${REACT_VERSION}/umd/react.development.js`,
	"react-dom.development.js": `https://unpkg.com/react-dom@${REACT_VERSION}/umd/react-dom.development.js`
};

/** The canvas card the tests frame, zoom and pan. */
const CARD_W = 1600;
const CARD_H = 1000;

const exists = async (path) => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

async function ensureReact() {
	await mkdir(CACHE, { recursive: true });
	for (const [name, url] of Object.entries(VENDOR)) {
		const target = join(CACHE, name);
		if (await exists(target)) continue;
		process.stdout.write(`fetching ${name} … `);
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
		await writeFile(target, Buffer.from(await response.arrayBuffer()));
		console.log("ok");
	}
}

/** `</script` inside an inlined script would close the tag early. */
const inline = (text) => text.replace(/<\/script/gi, "<\\/script");

async function main() {
	await ensureReact();

	const client = await readFile(join(ROOT, "lib", "client.js"), "utf8");

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>dsh-sidebar-image-zoom · harness</title>
<style>
  html, body { margin: 0; height: 100%; background: #0f1014; color: #ddd;
               font: 13px/1.5 system-ui, sans-serif; }
  #pane  { width: 900px; height: 620px; margin: 20px; border: 1px solid #333;
           border-radius: 10px; overflow: hidden; background: #16171c; }
  #pane2 { width: 420px; height: 320px; margin: 0 20px 20px; border: 1px solid #333; }
</style>
</head>
<body>
<div id="pane"><div id="root" style="width:100%;height:100%"></div></div>
<div id="pane2"><div id="root2" style="width:100%;height:100%"></div></div>

<script src="react.development.js"></script>
<script src="react-dom.development.js"></script>
<script>
/* ---- the test image, drawn here so no binary fixture is committed ---- */
window.__CARD = { w: ${CARD_W}, h: ${CARD_H} };
window.__card = (w = window.__CARD.w, h = window.__CARD.h) => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");

  g.fillStyle = "#fbfbfd";
  g.fillRect(0, 0, w, h);

  g.strokeStyle = "#dfe3ea";
  g.lineWidth = 1;
  for (let x = 0; x <= w; x += 50) {
    g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, h); g.stroke();
  }
  for (let y = 0; y <= h; y += 50) {
    g.beginPath(); g.moveTo(0, y + .5); g.lineTo(w, y + .5); g.stroke();
  }

  const blocks = [
    ["#cfe0f7", 100, 100, 420, 240, "top-left"],
    ["#f9d9d9", w - 520, 100, 420, 240, "top-right"],
    ["#d8ecd8", 100, h - 340, 420, 240, "bottom-left"],
    ["#f7e6c4", w - 520, h - 340, 420, 240, "bottom-right"]
  ];
  g.font = "600 34px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const [fill, x, y, bw, bh, name] of blocks) {
    g.fillStyle = fill;
    g.fillRect(x, y, bw, bh);
    g.strokeStyle = "#9aa3b2";
    g.strokeRect(x + .5, y + .5, bw, bh);
    g.fillStyle = "#2b3240";
    g.fillText(name, x + bw / 2, y + bh / 2);
  }

  g.strokeStyle = "#e05c5c";
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.stroke();
  g.beginPath(); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
  g.beginPath(); g.arc(w / 2, h / 2, 22, 0, Math.PI * 2); g.stroke();

  g.fillStyle = "#111318";
  g.font = "600 28px ui-monospace, Consolas, monospace";
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText(w + " x " + h + "  test card", 40, 52);
  g.fillText("centre " + w / 2 + ", " + h / 2, 40, h - 30);

  return new Promise((done) =>
    canvas.toBlob(async (blob) => done(new Uint8Array(await blob.arrayBuffer())), "image/png")
  );
};

/* ---- the only things DSH provides that the plugin depends on ---- */
window.__DSH = {
  spec: null,
  module: null,
  captured: { definition: null, slot: null, injectedInto: null, effects: [] }
};

window.__ModuleLoader__ = {
  load(spec) {
    window.__DSH.spec = spec;
    window.__DSH.module = spec.factory(requireShim);
  }
};

function requireShim(name) {
  if (name === "react") return window.React;
  if (name === "react/jsx-runtime") {
    const R = window.React;
    return {
      Fragment: R.Fragment,
      jsx: (type, props, key) => R.createElement(type, props, key),
      jsxs: (type, props, key) => R.createElement(type, props, key)
    };
  }
  throw new Error("harness: unexpected require(" + JSON.stringify(name) + ")");
}

/* ---- the cordis context the plugin is applied to ---- */
const captured = window.__DSH.captured;
const ctx = {
  effect(fn, label) {
    const dispose = fn();
    captured.effects.push({ label, dispose });
    return dispose;
  },
  documentPreviews: {
    register(definition) {
      captured.definition = definition;
      return () => { captured.definition = null; };
    }
  },
  slots: {
    inject(name, factory) {
      captured.injectedInto = name;
      return factory();
    },
    register(descriptor, body) {
      captured.slot = { descriptor, body };
      return () => { captured.slot = null; };
    }
  }
};
window.__ctx = ctx;

/* ---- bytes the tests can mount ---- */
window.__bytes = {
  card: null,
  /* no signature any renderer claims, and no suffix either */
  junk: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
};

window.__roots = {};
window.__render = (data, container, address) =>
  new Promise((resolve) => {
    const body = captured.slot.body;
    const props = {
      content: { kind: "bytes", data },
      resourceAddress: address || "dsh-resource://file/session/card.png",
      wrap: false
    };
    const id = container || "root";
    /* DSH mounts one root per tab and re-renders it; calling createRoot twice on
       the same container is what React warns about, so reuse it like DSH does. */
    if (!window.__roots[id]) window.__roots[id] = ReactDOM.createRoot(document.getElementById(id));
    window.__roots[id].render(React.createElement(body, props));
    setTimeout(resolve, 400);
  });

const banner = console.error;
console.error = (...args) => { window.__errors.push(args.map(String).join(" ")); banner(...args); };
window.__errors = [];
window.addEventListener("error", (e) => window.__errors.push(String(e.message)));
</script>

<script>
/* ---- the module under test, inlined verbatim ---- */
${inline(client)}
</script>

<script>
/* The plugin is applied once, at activation, exactly as cordis does it — the
   registrations must exist before any tab body is rendered. */
if (!window.__DSH.module) throw new Error("client.js did not call __ModuleLoader__.load");
window.__DSH.module.apply(ctx);

window.__boot = async (data, container, address) => {
  if (data === undefined && !window.__bytes.card) window.__bytes.card = await window.__card();
  return window.__render(data === undefined ? window.__bytes.card : data, container, address);
};
</script>
</body>
</html>
`;

	await writeFile(join(CACHE, "harness.html"), html, "utf8");
	const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
	console.log(`wrote test/.cache/harness.html  (${kb} KB)`);
	console.log(`test card: ${CARD_W}x${CARD_H}, drawn at run time`);
}

await main();
