/**
 * Staged form over the `unity` settings namespace: drafts what the user types
 * and writes it only on save, mirroring the dsh plugin-card conventions —
 * a field shows its effective value and whether the user layer carries it,
 * an empty draft clears the field back to the composition layer, and a draft
 * that is not a positive finite number blocks the save instead of being dropped.
 * @module unity-plugin/client/controller
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Settings namespace this card edits; the Host half registers the same value. */
export const UNITY_NS = 'unity'

/** The user-editable tunables, as served by the Host's `unity` namespace. */
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

/** One control's render state. */
export interface UnityFieldState {
  /** Draft text the control renders. */
  text: string
  /** Whether saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** Whether the draft is not a positive finite number, which blocks saving. */
  invalid: boolean
}

/** What the Unity card renders. */
export interface UnityCardState {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
  /** Per-field control state. */
  fields: Record<UnityFieldName, UnityFieldState>
}

/** The face the card's slot registration injects. */
export interface UnityCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as `useUnityCard`. */
    unityCard: SnapshotStore<UnityCardState>
  }
  /** Stage draft text for one field. */
  edit: (field: UnityFieldName, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  resetField: (field: UnityFieldName) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** One field's staged edit; `clear` writes an unset whatever text it shows. */
interface StagedEdit {
  text: string
  clear: boolean
}

/** Bridges the `unity` client scope onto the card's staged form. */
export class UnityCardController {
  private readonly scope: SettingsScope<UnityTunablesSection>
  private readonly store: SnapshotStore<UnityCardState>
  private readonly staged = new Map<UnityFieldName, StagedEdit>()
  private saving = false
  private failed = false

  /** @param scope - the bound client settings scope for the `unity` namespace. */
  constructor(scope: SettingsScope<UnityTunablesSection>) {
    this.scope = scope
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.publish() })
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card snapshot hook seat and its form actions.
   */
  inject(): UnityCardFace {
    return {
      hooks: { unityCard: this.store },
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => { this.stage(field, { text: this.format(this.baseValue(field)), clear: true }) },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  private projection(): UnityCardState {
    const snapshot = this.scope.getSnapshot()
    const fields = {} as Record<UnityFieldName, UnityFieldState>
    for (const field of UNITY_FIELDS) fields[field] = this.field(field)
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
      fields,
    }
  }

  private field(field: UnityFieldName): UnityFieldState {
    const staged = this.staged.get(field)
    if (staged === undefined) {
      return { text: this.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    if (staged.clear) return { text: staged.text, overridden: false, invalid: false }
    const parsed = parseDraft(staged.text)
    return { text: staged.text, overridden: parsed !== undefined && parsed !== null, invalid: parsed === undefined }
  }

  /**
   * Every staged edit a save would write, in staging order. A clear of an
   * uncarried field and a draft equal to the effective value are no-ops; an
   * invalid draft carries no write, keeping the form dirty and the save
   * refused rather than dropping the edit.
   */
  private plan(): { field: UnityFieldName, run: (() => Promise<boolean>) | undefined }[] {
    const plan: { field: UnityFieldName, run: (() => Promise<boolean>) | undefined }[] = []
    for (const [field, staged] of this.staged) {
      const clears = staged.clear || parseDraft(staged.text) === null
      if (clears) {
        if (this.stored(field)) {
          plan.push({ field, run: async () => { await this.scope.unset(field); return !this.stored(field) } })
        }
        continue
      }
      if (staged.text === this.format(this.sectionValue(field))) continue
      const value = parseDraft(staged.text)
      plan.push({
        field,
        run: value === undefined || value === null ? undefined : async () => {
          await this.scope.set(field, value)
          return (this.userLayer()?.[field]) === value
        },
      })
    }
    return plan
  }

  private async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run])
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) landed = await write() && landed
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private stage(field: UnityFieldName, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private format(value: unknown): string {
    return typeof value === 'number' ? String(value) : ''
  }

  private sectionValue(field: UnityFieldName): unknown {
    return (this.scope.getSnapshot().value as Record<string, unknown> | undefined)?.[field]
  }

  private baseValue(field: UnityFieldName): unknown {
    return (this.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
  }

  private userLayer(): Record<string, unknown> | undefined {
    return this.scope.getSnapshot().user as Record<string, unknown> | undefined
  }

  private stored(field: UnityFieldName): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}

/**
 * Parse one draft: null for an empty draft (a clear), undefined for text that
 * is not a positive finite number (blocks the save), the number otherwise.
 * Zero and negatives are refused here so the card says so inline, matching the
 * `min(1)` the Host's schema would reject the write with anyway — all three
 * fields are durations and byte caps that only mean anything above zero.
 */
function parseDraft(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
