/**
 * dsh-sidebar-image-zoom — browser half.
 *
 * DSH's built-in sidebar image preview renders the file into a plain <img> and
 * offers only a hidden floating control ("fit width / 25% / 50% / 100% / 150% /
 * 200%") that sits in the bottom 72 CSS pixels of the pane. Its own README says
 * the shared zoom controls "can produce horizontal and vertical scrolling, but
 * do not provide drag-to-pan", and zoom responds to Ctrl+wheel or a trackpad
 * pinch only — a plain wheel just scrolls.
 *
 * This plugin registers a renderer for the same suffixes that outranks the
 * built-in one (documentPreviews ranks every non-"builtin" priority ahead of
 * "builtin"), and replaces the viewport with:
 *
 *   - wheel zoom anchored at the pointer
 *   - drag to pan (pointer capture, works with a mouse, pen, or touch)
 *   - double-click to toggle fit <-> 1:1, anchored at the pointer
 *   - an always-visible control strip (fit / 1:1 / - / % / +) — the built-in
 *     control hides itself, which is why the feature is so hard to find
 *   - keyboard: F or Esc = fit, 1 = 1:1, +/- = step
 *
 * Uninstalling the package restores the built-in renderer: its id is unique, so
 * the registry simply stops seeing this definition.
 */
window.__ModuleLoader__.load({
	id: "dsh-sidebar-image-zoom",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");

		/* ------------------------------------------------------------------ *
		 * Registration surface
		 * ------------------------------------------------------------------ */

		/**
		 * Implementation id. It must be unique — `documentPreviews.register`
		 * throws `duplicate implementation` on a collision — and it doubles as
		 * the key of the body slot, because the tab resolves the body by looking
		 * up `sidebar.right.tab.document` with `entryKey: selected.id`.
		 */
		const BODY_ID = "dsh-sidebar-image-zoom/image";

		/** Service names, not package names. */
		const inject = ["slots", "documentPreviews"];

		const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"];
		/**
		 * Bitmaps only. SVG is deliberately absent: `register` rejects a binary
		 * suffix that is not also declared in `extensions`, and leaving SVG out
		 * keeps its XML source readable through the plain text renderer.
		 */
		const BINARY_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];

		const MIN_SCALE = 0.02;
		const MAX_SCALE = 40;
		/** Fit leaves a hair of margin so the shadow and border are not clipped. */
		const FIT_MARGIN = 0.97;

		/* ------------------------------------------------------------------ *
		 * Content type
		 * ------------------------------------------------------------------ */

		const SUFFIX_TYPES = {
			png: "image/png",
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			gif: "image/gif",
			webp: "image/webp",
			bmp: "image/bmp",
			ico: "image/x-icon",
			svg: "image/svg+xml"
		};

		/** Last dot-suffix of a path or resource address, lower-cased, no dot. */
		function suffixOf(address) {
			if (typeof address !== "string") return "";
			const clean = address.split(/[?#]/)[0].replace(/\\/g, "/");
			const name = clean.slice(clean.lastIndexOf("/") + 1).toLowerCase();
			const dot = name.lastIndexOf(".");
			return dot < 0 ? "" : name.slice(dot + 1);
		}

		function ascii(bytes, from, text) {
			for (let i = 0; i < text.length; i++) {
				if (bytes[from + i] !== text.charCodeAt(i)) return false;
			}
			return true;
		}

		/**
		 * Identify the image by its magic number rather than by the file name.
		 * The address the tab hands us is opaque, so sniffing is the reliable
		 * route; the suffix is only a fallback.
		 */
		function sniffMediaType(bytes) {
			if (!bytes || bytes.length < 12) return undefined;
			if (bytes[0] === 0x89 && ascii(bytes, 1, "PNG")) return "image/png";
			if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
			if (ascii(bytes, 0, "GIF8")) return "image/gif";
			if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "image/webp";
			if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
			if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
				return "image/x-icon";
			}
			// SVG is text: skip leading whitespace and look for the XML or root tag.
			let i = 0;
			const limit = Math.min(bytes.length, 512);
			while (i < limit && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
			if (i < limit && bytes[i] === 0x3c) {
				if (ascii(bytes, i, "<?xml") || ascii(bytes, i, "<svg") || ascii(bytes, i, "<!DOC")) {
					return "image/svg+xml";
				}
			}
			return undefined;
		}

		/* ------------------------------------------------------------------ *
		 * Styles
		 * ------------------------------------------------------------------ */

		const FONT = '13px/1.5 "Microsoft YaHei", "Segoe UI", system-ui, sans-serif';

		const ROOT = {
			position: "relative",
			width: "100%",
			height: "100%",
			// Hedge: if the pane hands us a zero-height box, stay visible anyway.
			minHeight: 240,
			overflow: "hidden",
			font: FONT
		};

		const VIEWPORT = {
			position: "absolute",
			inset: 0,
			overflow: "hidden",
			touchAction: "none",
			userSelect: "none"
		};

		const STAGE = {
			position: "absolute",
			top: 0,
			left: 0,
			transformOrigin: "0 0",
			willChange: "transform"
		};

		const IMG = {
			display: "block",
			maxWidth: "none",
			maxHeight: "none",
			width: "auto",
			height: "auto",
			// Every pointer event belongs to the viewport, so a drag that starts
			// on the bitmap still pans instead of triggering the native image drag.
			pointerEvents: "none",
			userSelect: "none"
		};

		const BAR = {
			position: "absolute",
			right: 12,
			bottom: 12,
			zIndex: 3,
			display: "flex",
			alignItems: "center",
			gap: 6,
			padding: "6px 8px",
			borderRadius: 10,
			background: "rgba(28,29,34,.92)",
			border: "1px solid rgba(255,255,255,.14)",
			color: "#e8e9ec",
			font: FONT,
			boxShadow: "0 6px 20px rgba(0,0,0,.35)"
		};

		const BTN = {
			height: 24,
			padding: "0 8px",
			borderRadius: 6,
			border: "1px solid rgba(255,255,255,.16)",
			background: "rgba(255,255,255,.07)",
			color: "inherit",
			font: "inherit",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};

		const PCT = {
			minWidth: 56,
			textAlign: "center",
			fontVariantNumeric: "tabular-nums",
			opacity: 0.85
		};

		const NOTE = {
			position: "absolute",
			inset: 0,
			display: "grid",
			placeItems: "center",
			padding: 24,
			textAlign: "center",
			color: "#9a9da5",
			font: FONT
		};

		/*
		 * Every message has to be returned inside a box that establishes the
		 * containing block. NOTE is absolutely positioned, so with no positioned
		 * ancestor it resolves against the initial containing block and centres
		 * itself on the window instead of in the pane. ROOT is that box.
		 */
		const notePane = (role, text) =>
			react.createElement(
				"div",
				{ style: ROOT },
				react.createElement("div", { style: NOTE, role: role }, text)
			);

		const clamp = (n) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, n));

		/* ------------------------------------------------------------------ *
		 * The viewport
		 * ------------------------------------------------------------------ */

		function ZoomViewport(props) {
			const address = props.address;
			const url = props.url;
			const label = props.label;

			const hostRef = react.useRef(null);
			const imgRef = react.useRef(null);
			const natRef = react.useRef(null); // natural size of the current image
			const modeRef = react.useRef("fit"); // "fit" | "manual"
			const dragRef = react.useRef(null);

			const [nat, setNat] = react.useState(null);
			const [view, setView] = react.useState({ s: 1, x: 0, y: 0 });
			const [grabbing, setGrabbing] = react.useState(false);
			// A suffix can promise a format the bytes do not deliver; the blob then
			// builds fine and only the decode fails, so watch for that too.
			const [broken, setBroken] = react.useState(false);

			const boxOf = () => {
				const host = hostRef.current;
				if (!host) return { w: 0, h: 0 };
				return { w: host.clientWidth, h: host.clientHeight };
			};

			/** Centre the image inside the pane at the scale that makes it fit. */
			const applyFit = react.useCallback((size) => {
				const target = size || natRef.current;
				const box = boxOf();
				if (!target || !target.w || !target.h || !box.w || !box.h) return;
				const s = clamp(Math.min(box.w / target.w, box.h / target.h, 1) * FIT_MARGIN);
				modeRef.current = "fit";
				setView({ s, x: (box.w - target.w * s) / 2, y: (box.h - target.h * s) / 2 });
			}, []);

			/** Measure once the bitmap is decoded, then fit it. */
			const measure = react.useCallback(() => {
				const img = imgRef.current;
				if (!img || !img.naturalWidth || !img.naturalHeight) return;
				const size = { w: img.naturalWidth, h: img.naturalHeight };
				natRef.current = size;
				setNat(size);
				applyFit(size);
			}, [applyFit]);

			// A cached image can finish decoding before React attaches onLoad.
			react.useEffect(() => {
				if (!url) return;
				setBroken(false);
				natRef.current = null;
				setNat(null);
				const img = imgRef.current;
				if (img && img.complete) measure();
			}, [url, measure]);

			// Fit tracks pane resizing, but a manual zoom is the user's to keep.
			react.useEffect(() => {
				const host = hostRef.current;
				if (!host || typeof ResizeObserver === "undefined") return undefined;
				const observer = new ResizeObserver(() => {
					if (modeRef.current === "fit") applyFit();
				});
				observer.observe(host);
				return () => observer.disconnect();
			}, [applyFit]);

			// Wheel must be a non-passive listener or preventDefault is ignored.
			react.useEffect(() => {
				const host = hostRef.current;
				if (!host) return undefined;
				const onWheel = (event) => {
					event.preventDefault();
					const rect = host.getBoundingClientRect();
					const cx = event.clientX - rect.left;
					const cy = event.clientY - rect.top;
					const line = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1;
					const factor = Math.exp(-event.deltaY * line * 0.0015);
					modeRef.current = "manual";
					setView((v) => {
						const s = clamp(v.s * factor);
						const k = s / v.s;
						return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
					});
				};
				host.addEventListener("wheel", onWheel, { passive: false });
				return () => host.removeEventListener("wheel", onWheel);
			}, []);

			const zoomAbout = react.useCallback((factor, cx, cy) => {
				modeRef.current = "manual";
				setView((v) => {
					const s = clamp(v.s * factor);
					const k = s / v.s;
					return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
				});
			}, []);

			const zoomCentre = react.useCallback((factor) => {
				const box = boxOf();
				zoomAbout(factor, box.w / 2, box.h / 2);
			}, [zoomAbout]);

			const onPointerDown = (event) => {
				if (event.button !== 0 && event.pointerType === "mouse") return;
				const host = hostRef.current;
				if (!host) return;
				dragRef.current = {
					id: event.pointerId,
					px: event.clientX,
					py: event.clientY,
					ox: view.x,
					oy: view.y
				};
				modeRef.current = "manual";
				setGrabbing(true);
				try {
					host.setPointerCapture(event.pointerId);
				} catch (error) {
					/* capture is best-effort */
				}
				event.preventDefault();
			};

			const onPointerMove = (event) => {
				const drag = dragRef.current;
				if (!drag || drag.id !== event.pointerId) return;
				const dx = event.clientX - drag.px;
				const dy = event.clientY - drag.py;
				setView((v) => ({ s: v.s, x: drag.ox + dx, y: drag.oy + dy }));
				event.preventDefault();
			};

			const endDrag = (event) => {
				const drag = dragRef.current;
				if (!drag || drag.id !== event.pointerId) return;
				dragRef.current = null;
				setGrabbing(false);
				const host = hostRef.current;
				if (host) {
					try {
						host.releasePointerCapture(event.pointerId);
					} catch (error) {
						/* already released */
					}
				}
			};

			const onDoubleClick = (event) => {
				const host = hostRef.current;
				if (!host) return;
				// Classic toggle: 1:1 <-> fit. Testing the scale (not "is it bigger
				// than 1:1") is what makes it work from every entry point — from a
				// hand-zoomed 74%, and back again from exactly 100%.
				if (Math.abs(view.s - 1) < 0.02) {
					applyFit();
					return;
				}
				const rect = host.getBoundingClientRect();
				zoomAbout(1 / view.s, event.clientX - rect.left, event.clientY - rect.top);
			};

			// Keyboard only when the pane itself has focus, so the composer keeps
			// receiving its own key presses.
			const onKeyDown = (event) => {
				if (event.key === "f" || event.key === "F" || event.key === "Escape") {
					applyFit();
				} else if (event.key === "1") {
					const box = boxOf();
					const size = natRef.current;
					if (!size) return;
					modeRef.current = "manual";
					setView({ s: 1, x: (box.w - size.w) / 2, y: (box.h - size.h) / 2 });
				} else if (event.key === "+" || event.key === "=") {
					zoomCentre(1.25);
				} else if (event.key === "-" || event.key === "_") {
					zoomCentre(1 / 1.25);
				} else {
					return;
				}
				event.preventDefault();
			};

			if (broken) {
				return notePane("status", "图片解码失败——文件可能已损坏，或后缀与实际格式不符。");
			}

			const viewportStyle = Object.assign({}, VIEWPORT, {
				cursor: grabbing ? "grabbing" : "grab"
			});
			const stageStyle = Object.assign({}, STAGE, {
				transform: "translate(" + view.x + "px, " + view.y + "px) scale(" + view.s + ")"
			});
			const percent = view.s < 0.1 ? (view.s * 100).toFixed(1) : Math.round(view.s * 100);

			return react.createElement(
				"div",
				{ style: ROOT },
				react.createElement(
					"div",
					{
						ref: hostRef,
						style: viewportStyle,
						tabIndex: 0,
						role: "img",
						"aria-label": label || "image",
						title: "滚轮缩放（以光标为中心）· 拖动平移 · 双击切 适应/1:1",
						onPointerDown,
						onPointerMove,
						onPointerUp: endDrag,
						onPointerCancel: endDrag,
						onDoubleClick,
						onKeyDown
					},
					react.createElement(
						"div",
						{ style: stageStyle },
						react.createElement("img", {
							ref: imgRef,
							src: url,
							alt: label || "",
							draggable: false,
							decoding: "async",
							style: IMG,
							onLoad: measure,
							onError: () => setBroken(true)
						})
					)
				),
				react.createElement(
					"div",
					{ style: BAR },
					react.createElement(
						"button",
						{ type: "button", style: BTN, title: "适应窗口 (F)", onClick: () => applyFit() },
						"适应窗口"
					),
					react.createElement(
						"button",
						{
							type: "button",
							style: BTN,
							title: "原始大小 (1)",
							onClick: () => {
								const box = boxOf();
								const size = natRef.current;
								if (!size) return;
								modeRef.current = "manual";
								setView({ s: 1, x: (box.w - size.w) / 2, y: (box.h - size.h) / 2 });
							}
						},
						"1:1"
					),
					react.createElement(
						"button",
						{ type: "button", style: BTN, title: "缩小 (-)", onClick: () => zoomCentre(1 / 1.25) },
						"−"
					),
					react.createElement("span", { style: PCT }, percent + "%"),
					react.createElement(
						"button",
						{ type: "button", style: BTN, title: "放大 (+)", onClick: () => zoomCentre(1.25) },
						"+"
					)
				)
			);
		}

		/* ------------------------------------------------------------------ *
		 * Blob lifecycle
		 * ------------------------------------------------------------------ */

		function ImageBody(props) {
			const content = props.content;
			const address = props.resourceAddress;
			const [url, setUrl] = react.useState(undefined);
			const [problem, setProblem] = react.useState(undefined);

			const kind = content ? content.kind : undefined;
			const bytes = kind === "bytes" ? content.data : undefined;
			const text = kind === "text" ? content.text : undefined;

			react.useEffect(() => {
				if (bytes === undefined && typeof text !== "string") {
					setProblem("这个标签页还没有拿到文件内容。");
					return undefined;
				}
				const type = sniffMediaType(bytes) || SUFFIX_TYPES[suffixOf(address)];
				if (!type) {
					setProblem("无法识别的图片格式。");
					return undefined;
				}
				let objectUrl;
				try {
					const parts = bytes !== undefined ? [bytes] : [typeof text === "string" ? text : ""];
					objectUrl = URL.createObjectURL(new Blob(parts, { type }));
				} catch (error) {
					setProblem("创建 Blob URL 失败：" + (error && error.message ? error.message : String(error)));
					return undefined;
				}
				setProblem(undefined);
				setUrl(objectUrl);
				return () => {
					setUrl(undefined);
					URL.revokeObjectURL(objectUrl);
				};
			}, [bytes, text, address]);

			if (problem) {
				return notePane("status", problem);
			}
			if (!url) {
				return notePane("status", "载入中…");
			}
			return react.createElement(ZoomViewport, { url, address, label: labelOf(address) });
		}

		function labelOf(address) {
			if (typeof address !== "string") return "";
			const clean = address.split(/[?#]/)[0].replace(/\\/g, "/");
			return decodeURIComponent(clean.slice(clean.lastIndexOf("/") + 1));
		}

		/* ------------------------------------------------------------------ *
		 * Error boundary
		 *
		 * A throw from a renderer body can blank the whole sidebar panel, so the
		 * replacement renderer never propagates one: it shows the message and
		 * leaves the tab's renderer dropdown available as the way out.
		 * ------------------------------------------------------------------ */

		class Guard extends react.Component {
			constructor(props) {
				super(props);
				this.state = { error: undefined };
			}

			static getDerivedStateFromError(error) {
				return { error };
			}

			componentDidCatch(error) {
				try {
					console.error("[dsh-sidebar-image-zoom]", error);
				} catch (ignored) {
					/* nothing to do */
				}
			}

			render() {
				if (this.state.error) {
					return notePane(
						"alert",
						"图片缩放查看器出错，已回退。可在标签页顶部切换回内置渲染器。"
					);
				}
				return this.props.children;
			}
		}

		function Body(props) {
			return react.createElement(Guard, null, react.createElement(ImageBody, props));
		}

		/* ------------------------------------------------------------------ *
		 * Plugin body
		 * ------------------------------------------------------------------ */

		function apply(ctx) {
			ctx.effect(
				() =>
					ctx.documentPreviews.register({
						id: BODY_ID,
						extensions: IMAGE_EXTENSIONS,
						binaryExtensions: BINARY_EXTENSIONS,
						// Anything but "builtin" outranks the built-in image viewport.
						priority: "extension",
						title: () => "缩放 / 平移",
						loading: "bytes-complete",
						wrap: false
					}),
				"sidebar-image-zoom: metadata"
			);

			ctx.effect(
				() =>
					ctx.slots.inject("sidebar.right.tab.document", () =>
						ctx.slots.register(
							{
								name: "sidebar.right.tab.document",
								key: BODY_ID
							},
							Body
						)
					),
				"sidebar-image-zoom: body"
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
