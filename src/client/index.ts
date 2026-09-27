/**
 * unity-plugin, browser half: the Unity CLI settings form on this bundle's
 * page in the Plugins page. Binds the `unity` profile entry's shared
 * configuration form and registers the card under the package name in the
 * page's `plugins.bundle.config` slot while the Host serves that entry; the
 * Host half declares the fields as volatile Config. Loaded through the
 * `dsh.client` declaration in package.json; assemblies without the web GUI
 * never fetch this bundle.
 * @module unity-plugin/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ctx.slots Context merge (the renderer provides the registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.configForms Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the `plugins.bundle.config` entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { UNITY_NS, UnityCardController } from './controller.ts'
import type { UnityTunablesSection } from './controller.ts'
import { UnityCard } from './UnityCard.tsx'

export type { UnityCardFace, UnityCardState, UnityFieldName, UnityTunablesSection } from './controller.ts'
export type { UnityCardProps } from './UnityCard.tsx'

/** The package name the Plugins page keys this bundle's configuration by. */
const PACKAGE_NAME = '@opdsh/unity-plugin'

export const name = 'unity'
export const inject = ['slots', 'configForms']

/**
 * Mount the Unity CLI settings card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new UnityCardController(ctx.configForms.get<UnityTunablesSection>(UNITY_NS))
  ctx.effect(() => () => { controller.dispose() }, 'unity-plugin: form subscription')
  // The slot is declared by the Plugins page; inject() registers for each
  // declaration lifetime and re-registers after the declarer restarts.
  ctx.effect(() => ctx.configForms.whileServed([UNITY_NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: PACKAGE_NAME,
    inject: () => controller.inject(),
  }, UnityCard))), 'unity-plugin: settings card')
}
