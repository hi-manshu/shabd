/**
 * What `shabd/client` is inside the frame of an isolated snippet.
 *
 * A file of the site's that a snippet imports may itself import from
 * `shabd/client`. In a page that is Shabd's client, with the site's data,
 * its router and its components. A frame has none of those: it has the
 * shared state, which the page keeps in step with its own.
 */
export { useShared } from '../shared-state.js'
