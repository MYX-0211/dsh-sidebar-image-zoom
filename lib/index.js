/**
 * dsh-sidebar-image-zoom — host half.
 *
 * Every part of this plugin lives in the browser: the client half registers a
 * `documentPreviews` renderer that outranks the built-in image viewport and
 * supplies its own body component. The host row therefore exists only to
 * satisfy the bundle contract — it injects nothing, registers no route, holds
 * no state, and does no work at boot.
 *
 * It must still be a valid cordis plugin: `cordis.patch.yml` mounts the
 * package by name, which resolves here.
 */

/** Stable cordis plugin name. Must match the `insert` id in cordis.patch.yml. */
export const name = "sidebar-image-zoom";

/** @param {import("@deepseek-ai/cordis").Context} ctx */
export function apply(ctx) {
	// Intentionally empty — see the module header.
}
