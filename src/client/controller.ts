/**
 * Staged form over the `unity` profile entry's live fields, built on the
 * shared settings form model: a field shows its effective value and whether
 * the profile overrides it, an empty draft clears the field back to the value
 * it inherits, and a draft the Host's Config schema would refuse blocks the
 * save instead of being dropped.
 * @module unity-plugin/client/controller
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsFormModel, settingsTextField } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SettingsFieldSpec, SettingsFieldState, SettingsFormActions, SettingsFormScope, SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Profile entry id of the plugin row this card edits: the id the bundle's
 * cordis.patch.yml inserts, which is also the settings form namespace.
 */
export const UNITY_NS = 'unity'

/** The live-editable fields, as served by the `unity` entry's form. */
export interface UnityTunablesSection {
  unityBin?: string
  projectPath?: string
  commandTimeoutMs?: number
  cliTimeoutMs?: number
  graceMs?: number
  outputMaxBytes?: number
  warmShell?: boolean
  shellIdleMs?: number
  unitySkillsDownload?: boolean
  unitySkillsRepo?: string
  unitySkillsRef?: string
  unitySkillsCacheDir?: string
}

/** The fields this card edits. */
export type UnityFieldName = keyof UnityTunablesSection

/** Longest delay a Node timer honours; the Host's schema refuses anything larger. */
const MAX_TIMER_MS = 2_147_483_647

/**
 * A number field bounded like its Host schema. An empty draft clears the
 * field; anything outside the bounds blocks the save here, so the card says
 * so inline instead of the Host refusing the write.
 * @param field - field name inside the entry's form.
 * @param min - smallest accepted value.
 * @param max - largest accepted value.
 * @returns the field's conversion spec.
 */
function boundedNumberField(field: UnityFieldName, min: number, max = Number.MAX_SAFE_INTEGER): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) && parsed >= min && parsed <= max ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/**
 * An on/off field, staged as the text `true` or `false`; the card renders it
 * as a switch.
 * @param field - field name inside the entry's form.
 * @returns the field's conversion spec.
 */
function booleanField(field: UnityFieldName): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: (text) => {
      if (text === '') return { kind: 'clear' }
      return text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined
    },
  }
}

/** Every field's spec, in render order. */
const FIELD_SPECS: readonly SettingsFieldSpec[] = [
  settingsTextField('unityBin'),
  settingsTextField('projectPath'),
  boundedNumberField('commandTimeoutMs', 1, MAX_TIMER_MS),
  boundedNumberField('cliTimeoutMs', 1, MAX_TIMER_MS),
  boundedNumberField('graceMs', 0, MAX_TIMER_MS),
  boundedNumberField('outputMaxBytes', 1),
  booleanField('warmShell'),
  boundedNumberField('shellIdleMs', 1, MAX_TIMER_MS),
  booleanField('unitySkillsDownload'),
  settingsTextField('unitySkillsRepo'),
  settingsTextField('unitySkillsRef'),
  settingsTextField('unitySkillsCacheDir'),
]

/** What the Unity card renders. */
export interface UnityCardState extends SettingsFormShell {
  /** Per-field control state. */
  fields: Record<UnityFieldName, SettingsFieldState>
}

/** The face the card's slot registration injects. */
export interface UnityCardFace extends SettingsFormActions {
  hooks: {
    /** Card snapshot bound by the renderer as `useUnityCard`. */
    unityCard: SnapshotStore<UnityCardState>
  }
}

/** Bridges the `unity` entry's shared configuration form onto the card's staged form. */
export class UnityCardController {
  private readonly form: SettingsFormModel<UnityTunablesSection>
  private readonly store: SnapshotStore<UnityCardState>

  /** @param scope - the shared configuration form of the `unity` profile entry. */
  constructor(scope: SettingsFormScope<UnityTunablesSection>) {
    this.form = new SettingsFormModel(scope, [...FIELD_SPECS])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): UnityCardState {
    const fields = {} as Record<UnityFieldName, SettingsFieldState>
    for (const spec of FIELD_SPECS) fields[spec.field as UnityFieldName] = this.form.field(spec.field)
    return { ...this.form.shell(), fields }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card snapshot hook seat and its form actions.
   */
  inject(): UnityCardFace {
    return { hooks: { unityCard: this.store }, ...this.form.actions() }
  }

  /** Release the form subscription. */
  dispose(): void { this.form.dispose() }
}
