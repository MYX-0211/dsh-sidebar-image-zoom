#!/usr/bin/env node
/**
 * End-to-end verification for dsh-sidebar-image-zoom.
 *
 * Loads the harness built by `build-harness.mjs`, applies the plugin to a
 * recording cordis context, mounts the registered body with a real bitmap, and
 * drives the viewport with real mouse and wheel input through a real browser.
 *
 * The two assertions that matter most measure the thing the plugin exists for:
 * that the image point under the cursor does not move while zooming, and that
 * dragging translates the image by exactly the pointer delta.
 *
 *   node test/verify.mjs
 *
 * Environment:
 *   PUPPETEER_EXECUTABLE_PATH  browser binary (defaults to a system Edge/Chrome)
 *   PUPPETEER_PATH             module path for puppeteer, if it is not resolvable
 *                              from the current directory
 */

import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, ".cache");
const HARNESS = pathToFileURL(join(CACHE, "harness.html")).href;
const require = createRequire(import.meta.url);

const CANDIDATE_BROWSERS = [
	process.env.PUPPETEER_EXECUTABLE_PATH,
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);

const CARD = { w: 1600, h: 1000 };

const results = [];
const record = (name, ok, detail) => {
	results.push({ name, ok });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadPuppeteer() {
	const tried = [];
	// puppeteer-core is the devDependency: it drives a browser you already have
	// instead of downloading its own Chromium. A full `puppeteer` install works
	// too, and PUPPETEER_PATH covers everything else (pnpm store paths, a global
	// install, a copy borrowed from another project).
	for (const spec of ["puppeteer-core", "puppeteer", process.env.PUPPETEER_PATH].filter(Boolean)) {
		try {
			return require(spec);
		} catch (error) {
			tried.push(`${spec}: ${error.code || error.message}`);
		}
	}
	throw new Error(
		"puppeteer-core is not installed.\n  tried " + tried.join("\n  ") +
		"\n  run `npm install` (it is a devDependency), or point PUPPETEER_PATH at an existing copy."
	);
}

async function findBrowser() {
	for (const candidate of CANDIDATE_BROWSERS) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			/* keep looking */
		}
	}
	throw new Error(
		"no browser found. Set PUPPETEER_EXECUTABLE_PATH to an Edge/Chrome binary.\n  tried:\n    " +
		CANDIDATE_BROWSERS.join("\n    ")
	);
}

async function main() {
	const puppeteer = await loadPuppeteer();
	const executablePath = await findBrowser();
	console.log(`browser: ${executablePath}\n`);

	const browser = await puppeteer.launch({
		executablePath,
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--allow-file-access-from-files", "--font-render-hinting=none"]
	});
	const page = await browser.newPage();
	await page.setViewport({ width: 1100, height: 780, deviceScaleFactor: 1 });

	const pageErrors = [];
	page.on("pageerror", (e) => pageErrors.push(String(e.message)));
	page.on("console", (m) => {
		if (m.type() === "error") pageErrors.push(m.text());
	});

	await page.goto(HARNESS, { waitUntil: "load" });
	await wait(300);

	/* ---------------------------------------------------------------- *
	 * 1. Registration contract
	 * ---------------------------------------------------------------- */
	const reg = await page.evaluate(() => {
		const c = window.__DSH.captured;
		const d = c.definition;
		const s = c.slot;
		return {
			loaded: !!window.__DSH.module,
			specId: window.__DSH.spec && window.__DSH.spec.id,
			exportedApply: typeof (window.__DSH.module || {}).apply,
			exportedInject: (window.__DSH.module || {}).inject,
			definition: d && {
				id: d.id,
				extensions: d.extensions,
				binaryExtensions: d.binaryExtensions,
				priority: d.priority,
				loading: d.loading,
				wrap: d.wrap,
				title: typeof d.title === "function" ? d.title() : d.title
			},
			injectedInto: c.injectedInto,
			slotName: s && s.descriptor.name,
			slotKey: s && s.descriptor.key,
			bodyIsComponent: s && typeof s.body === "function",
			effects: c.effects.map((e) => e.label)
		};
	});

	record("client.js self-registers via __ModuleLoader__", reg.loaded && reg.specId === "dsh-sidebar-image-zoom",
		`id=${reg.specId}`);
	record("exports apply and inject", reg.exportedApply === "function" && Array.isArray(reg.exportedInject),
		`inject=[${(reg.exportedInject || []).join(", ")}]`);
	record("registers a documentPreviews implementation", !!reg.definition, reg.definition && reg.definition.id);
	record("claims every bitmap suffix",
		["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"].every((e) => (reg.definition.extensions || []).includes(e)),
		(reg.definition.extensions || []).join(","));
	record("binaryExtensions is a subset of extensions",
		(reg.definition.binaryExtensions || []).every((e) => reg.definition.extensions.includes(e)),
		(reg.definition.binaryExtensions || []).join(","));
	/* The whole mechanism: every priority except "builtin" outranks the built-in. */
	record("priority outranks the built-in renderer", reg.definition.priority !== "builtin",
		`priority=${reg.definition.priority}`);
	record("waits for fully decoded bytes", reg.definition.loading === "bytes-complete", reg.definition.loading);
	record("supplies its own renderer label",
		typeof reg.definition.title === "string" && reg.definition.title.length > 0, reg.definition.title);
	record("injects into the document body slot",
		reg.injectedInto === "sidebar.right.tab.document" && reg.slotName === "sidebar.right.tab.document",
		`${reg.injectedInto} / ${reg.slotName}`);
	/* The tab resolves its body with entryKey = selected.id, so these must match. */
	record("body slot key matches the registry id", reg.slotKey === reg.definition.id, `key=${reg.slotKey}`);
	record("body slot carries a component", reg.bodyIsComponent);
	record("both registrations are owned by effects",
		reg.effects.includes("sidebar-image-zoom: metadata") && reg.effects.includes("sidebar-image-zoom: body"),
		reg.effects.join(" + "));

	/* ---------------------------------------------------------------- *
	 * 2. Mount with a real bitmap
	 * ---------------------------------------------------------------- */
	await page.evaluate(() => window.__boot());
	await wait(800);

	const mounted = await page.evaluate(() => {
		const img = document.querySelector("#root img");
		if (!img) return { ok: false };
		return {
			ok: true,
			src: img.getAttribute("src").slice(0, 5),
			natural: [img.naturalWidth, img.naturalHeight],
			draggable: img.getAttribute("draggable"),
			buttons: [...document.querySelectorAll("#root button")].map((b) => b.textContent)
		};
	});
	record("mounts an <img> from a Blob URL", mounted.ok && mounted.src === "blob:", mounted.src);
	record("decodes the test card", mounted.natural && mounted.natural[0] === CARD.w && mounted.natural[1] === CARD.h,
		mounted.natural && mounted.natural.join("x"));
	record("exposes an always-visible control strip", mounted.buttons && mounted.buttons.length === 4,
		(mounted.buttons || []).join(" | "));

	const rectOf = () =>
		page.evaluate(() => {
			const img = document.querySelector("#root img");
			const b = img.getBoundingClientRect();
			return { left: b.left, top: b.top, width: b.width, height: b.height };
		});

	const scaleOf = () =>
		page.evaluate(() => {
			const img = document.querySelector("#root img");
			return img.getBoundingClientRect().width / img.naturalWidth;
		});

	const fits = (r) =>
		page.evaluate((r) => {
			const pane = document.getElementById("pane").getBoundingClientRect();
			return r.left >= pane.left - 1 && r.top >= pane.top - 1 &&
				r.left + r.width <= pane.right + 1 && r.top + r.height <= pane.bottom + 1;
		}, r);

	const start = await rectOf();
	const startScale = await scaleOf();
	record("opens fitted to the pane", startScale < 1 && (await fits(start)),
		`scale=${startScale.toFixed(3)} (${Math.round(startScale * 100)}%)`);

	/* ---------------------------------------------------------------- *
	 * 3. Wheel zoom anchored at the pointer
	 * ---------------------------------------------------------------- */
	const cx = Math.round(start.left + start.width * 0.3);
	const cy = Math.round(start.top + start.height * 0.35);
	const u = (cx - start.left) / start.width;
	const v = (cy - start.top) / start.height;

	await page.mouse.move(cx, cy);
	await page.mouse.wheel({ deltaY: -400 });
	await wait(250);

	const zoomed = await page.evaluate((cx, cy, u, v) => {
		const img = document.querySelector("#root img");
		const b = img.getBoundingClientRect();
		return {
			x: b.left + u * b.width,
			y: b.top + v * b.height,
			scale: b.width / img.naturalWidth,
			readout: (document.querySelector("#root span") || {}).textContent
		};
	}, cx, cy, u, v);

	const drift = Math.hypot(zoomed.x - cx, zoomed.y - cy);
	record("wheel zooms in", zoomed.scale > startScale + 0.01,
		`${(startScale * 100).toFixed(1)}% -> ${zoomed.readout}`);
	record("zoom is anchored at the cursor", drift < 1, `image point under cursor moved ${drift.toFixed(2)}px`);

	await page.screenshot({ path: join(CACHE, "zoomed.png") });

	/* ---------------------------------------------------------------- *
	 * 4. Drag to pan
	 * ---------------------------------------------------------------- */
	const beforeDrag = await rectOf();
	await page.mouse.move(560, 420);
	await page.mouse.down();
	await page.mouse.move(560 - 140, 420 - 90, { steps: 8 });
	await page.mouse.up();
	await wait(150);
	const afterDrag = await rectOf();
	const dx = afterDrag.left - beforeDrag.left;
	const dy = afterDrag.top - beforeDrag.top;
	record("drag pans by the pointer delta",
		Math.abs(dx - -140) < 1.5 && Math.abs(dy - -90) < 1.5 && Math.abs(afterDrag.width - beforeDrag.width) < 0.5,
		`moved (${dx.toFixed(1)}, ${dy.toFixed(1)}), expected (-140, -90); scale held at ${(await scaleOf()).toFixed(3)}`);

	await page.screenshot({ path: join(CACHE, "panned.png") });

	/* ---------------------------------------------------------------- *
	 * 5. Control strip
	 * ---------------------------------------------------------------- */
	const clickButton = async (label) => {
		await page.evaluate((label) => {
			const b = [...document.querySelectorAll("#root button")].find((n) => n.textContent === label);
			if (!b) throw new Error("no button " + label);
			b.click();
		}, label);
		await wait(200);
	};

	/* ---------------------------------------------------------------- *
	 * 6. Double-click toggles fit <-> 1:1
	 *
	 * The toggle reads the live scale, so the assertions have to start from a
	 * state it can act on. Fit is well below 1:1 for this card; a single wheel
	 * notch is not, which is why this resets rather than relying on section 3.
	 *
	 * A real double-click is two press/release pairs; a single pair carrying
	 * clickCount 2 is not enough to make Chromium emit `dblclick`.
	 * ---------------------------------------------------------------- */
	const doubleClick = async (x, y) => {
		await page.mouse.move(x, y);
		await page.mouse.down({ clickCount: 1 });
		await page.mouse.up({ clickCount: 1 });
		await page.mouse.down({ clickCount: 2 });
		await page.mouse.up({ clickCount: 2 });
		await wait(300);
	};

	await clickButton("适应窗口");
	const precondition = await scaleOf();
	record("double-click starts from a fitted view", precondition < 0.9, `scale=${precondition.toFixed(3)}`);

	await doubleClick(520, 380);
	const firstDouble = await scaleOf();
	record("double-click goes to 1:1", Math.abs(firstDouble - 1) < 0.01, `scale=${firstDouble.toFixed(3)}`);

	await doubleClick(520, 380);
	const secondScale = await scaleOf();
	record("double-click returns to fit", secondScale < 1 && (await fits(await rectOf())),
		`${(firstDouble * 100).toFixed(1)}% -> ${(secondScale * 100).toFixed(1)}%`);

	/* ---------------------------------------------------------------- *
	 * 7. The rest of the control strip
	 * ---------------------------------------------------------------- */
	await clickButton("1:1");
	record("the 1:1 button gives 100%", Math.abs((await scaleOf()) - 1) < 0.01, `scale=${(await scaleOf()).toFixed(3)}`);

	const beforeFit = await scaleOf();
	await clickButton("适应窗口");
	const afterFit = await scaleOf();
	record("the fit button refits to the pane", afterFit < beforeFit && (await fits(await rectOf())),
		`${(beforeFit * 100).toFixed(1)}% -> ${(afterFit * 100).toFixed(1)}%`);

	const beforePlus = await scaleOf();
	await clickButton("+");
	const afterPlus = await scaleOf();
	await clickButton("−");
	const afterMinus = await scaleOf();
	record("+ and − step the zoom",
		afterPlus > beforePlus + 0.001 && afterMinus < afterPlus - 0.001,
		`${beforePlus.toFixed(3)} -> ${afterPlus.toFixed(3)} -> ${afterMinus.toFixed(3)}`);

	/* ---------------------------------------------------------------- *
	 * 8. A file the renderer cannot show must not throw or blank the pane
	 * ---------------------------------------------------------------- */
	/* (a) bytes that match no signature, under a suffix we do not claim. */
	await page.evaluate(() => window.__boot(window.__bytes.junk, "root2", "dsh-resource://file/session/notes.bin"));
	await wait(700);
	const junk = await page.evaluate(() => {
		const host = document.getElementById("root2");
		const note = host.querySelector('[role="status"]');
		const h = host.getBoundingClientRect();
		const n = note.getBoundingClientRect();
		// The note is absolutely positioned, so if its box is not confined to the
		// host's, the absolutely positioned child escaped its containing block.
		const contained = n.left >= h.left - 1 && n.right <= h.right + 1 &&
			n.top >= h.top - 1 && n.bottom <= h.bottom + 1;
		return { text: host.textContent, buttons: host.querySelectorAll("button").length, contained };
	});
	record("an unclaimed suffix falls back to a message",
		junk.text.includes("无法识别") && junk.buttons === 0, JSON.stringify(junk.text));
	record("the fallback message stays inside its pane", junk.contained, `contained=${junk.contained}`);

	/* (b) bytes that match nothing under a suffix that promises PNG. The Blob
	 *     builds happily and only the decode fails, so onError has to catch it. */
	await page.evaluate(() => window.__boot(window.__bytes.junk, "root2", "dsh-resource://file/session/图片.png"));
	await wait(900);
	const corrupt = await page.evaluate(() => {
		const host = document.getElementById("root2");
		const note = host.querySelector('[role="status"]');
		const h = host.getBoundingClientRect();
		const n = note.getBoundingClientRect();
		const contained = n.left >= h.left - 1 && n.right <= h.right + 1 &&
			n.top >= h.top - 1 && n.bottom <= h.bottom + 1;
		return { text: host.textContent, buttons: host.querySelectorAll("button").length, contained };
	});
	record("a corrupt PNG reports a decode failure",
		corrupt.text.includes("解码失败") && corrupt.buttons === 0, JSON.stringify(corrupt.text));
	record("the decode-failure message stays inside its pane", corrupt.contained, `contained=${corrupt.contained}`);

	await page.evaluate(() => window.__boot());
	await page.evaluate(() => {
		const b = [...document.querySelectorAll("#root button")].find((n) => n.textContent === "适应窗口");
		if (b) b.click();
	});
	await wait(400);
	await page.screenshot({ path: join(CACHE, "final.png") });

	/* ---------------------------------------------------------------- *
	 * 9. Console hygiene
	 * ---------------------------------------------------------------- */
	record("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" / ") || "none");

	await browser.close();

	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} passed`);
	console.log(`screenshots: test/.cache/zoomed.png, panned.png, final.png`);
	process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error("\nHARNESS ERROR:", error.message);
	process.exit(2);
});
