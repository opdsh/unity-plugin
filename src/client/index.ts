/**
 * unity-plugin, browser half: the Unity CLI card in the dsh settings
 * Plugin-configuration tab. Binds the `unity` settings namespace through the
 * client settings scope and registers the card under that key in the tab's
 * `settings.plugin.item` slot; the Host half registers the namespace itself,
 * and the tab pairs the two. Loaded through the `dsh.client` declaration in
 * package.json; assemblies without the web GUI never fetch this bundle.
 * @module unity-plugin/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ctx.slots Context merge (the renderer provides the registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the `settings.plugin.item` SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { UNITY_NS, UnityCardController } from './controller.ts'
import type { UnityTunablesSection } from './controller.ts'
import { UnityCard } from './UnityCard.tsx'

export type { UnityCardFace, UnityCardState, UnityFieldName, UnityFieldState, UnityTunablesSection } from './controller.ts'
export type { UnityCardProps } from './UnityCard.tsx'

export const name = 'unity'
export const inject = ['slots', 'settingsScope']

/**
 * Mount the Unity CLI settings card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new UnityCardController(
    ctx.settingsScope.bind<UnityTunablesSection>({ namespace: UNITY_NS }),
  )
  // The slot is declared by the configurable-plugins tab; inject() registers
  // for each declaration lifetime and re-registers after the declarer restarts.
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: UNITY_NS,
    inject: () => controller.inject(),
  }, UnityCard))
}
