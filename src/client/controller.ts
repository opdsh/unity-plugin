/**
 * Staged form over the `unity` profile entry's live fields, built on the
 * shared settings form model: a field shows its effective value and whether
 * the profile overrides it, an empty draft clears the field back to the value
 * it inherits, and a draft that is not a positive finite number blocks the
 * save instead of being dropped.
 * @module unity-plugin/client/controller
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsFormModel } from '@deepseek-ai/dsh-client-ui-primitives'
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
  /** Timeout for live-Editor tools, in milliseconds. */
  commandTimeoutMs?: number
  /** Timeout for `unity_cli`, in milliseconds. */
  cliTimeoutMs?: number
  /** In-memory cap per collected output stream, in bytes. */
  outputMaxBytes?: number
}

/** The three fields this card edits. */
export type UnityFieldName = 'commandTimeoutMs' | 'cliTimeoutMs' | 'outputMaxBytes'

/** Field names in render order. */
export const UNITY_FIELDS: readonly UnityFieldName[] = ['commandTimeoutMs', 'cliTimeoutMs', 'outputMaxBytes']

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

/**
 * A positive number field. An empty draft clears the field; zero, negatives,
 * and non-numbers block the save here so the card says so inline, matching the
 * `min(1)` the Host's Config schema would reject the write with anyway — all
 * three fields are durations and byte caps that only mean anything above zero.
 * @param field - field name inside the entry's form.
 * @returns the field's conversion spec.
 */
function positiveNumberField(field: UnityFieldName): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) && parsed > 0 ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/** Bridges the `unity` entry's shared configuration form onto the card's staged form. */
export class UnityCardController {
  private readonly form: SettingsFormModel<UnityTunablesSection>
  private readonly store: SnapshotStore<UnityCardState>

  /** @param scope - the shared configuration form of the `unity` profile entry. */
  constructor(scope: SettingsFormScope<UnityTunablesSection>) {
    this.form = new SettingsFormModel(scope, UNITY_FIELDS.map(positiveNumberField))
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): UnityCardState {
    const fields = {} as Record<UnityFieldName, SettingsFieldState>
    for (const field of UNITY_FIELDS) fields[field] = this.form.field(field)
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
