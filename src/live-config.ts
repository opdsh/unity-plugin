/**
 * Live configuration edits, routed by the top-level Config keys they touch.
 * The Loader commits a volatile-only edit into the running `Volatile`
 * references and announces it once, through `loader/volatile-update`, to
 * listeners on the plugin entry's own fiber only — a context from
 * `ctx.inject` is a child fiber and never hears it. The watcher is therefore
 * created on the entry context in `apply`, and the tools and skills halves
 * subscribe to the keys they consume.
 * @module unity-plugin/live-config
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the Loader's `loader/volatile-update` event merge.
import type {} from '@deepseek-ai/cordis-plugin-loader'

/**
 * Subscribe to live edits of some top-level Config keys.
 * @param keys - the keys the listener consumes.
 * @param listener - invoked once per edit touching any of them, after the new values are committed.
 * @returns the disposer removing this subscription.
 */
export type ConfigWatch = (keys: readonly string[], listener: () => void) => () => void

/**
 * Listen for live edits on the plugin entry's context.
 * @param ctx - the plugin entry's own context (the one `apply` receives).
 * @returns the key-routed subscription function.
 */
export function watchConfig(ctx: Context): ConfigWatch {
  const subscriptions = new Set<{ keys: ReadonlySet<string>, listener: () => void }>()
  ctx.on('loader/volatile-update', (paths) => {
    const touched = new Set(paths.map(path => path[0]))
    for (const subscription of [...subscriptions]) {
      if ([...subscription.keys].some(key => touched.has(key))) subscription.listener()
    }
  })
  return (keys, listener) => {
    const subscription = { keys: new Set(keys), listener }
    subscriptions.add(subscription)
    return () => { subscriptions.delete(subscription) }
  }
}
