/**
 * Host half of the workspace-tints bundle.
 *
 * The feature is entirely a Web-client concern (a stylesheet over the sidebar's
 * Workspace and Session rows plus one Settings section), so this half only
 * exists so the bundle has a live Loader row whose lifecycle owns the Client
 * module. Nothing is registered here on purpose.
 */
export function apply() {}
