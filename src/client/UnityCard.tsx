/**
 * The Unity plugin's settings form on its bundle page in the Plugins page,
 * drawn with the shared settings form chrome so it reads as one surface with
 * the official plugin pages. The page draws the bundle's title, description,
 * and rows itself. Copy mirrors the shipped English strings.
 * @module unity-plugin/client/UnityCard
 */

import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `plugins.bundle.config` SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { UnityCardFace, UnityCardState, UnityFieldName } from './controller.ts'

/** Props the renderer binds for the Unity card. */
export type UnityCardProps = PropsRuntime<'plugins.bundle.config'> & InjectFace<UnityCardFace>

/** The form frame's copy. */
const FORM_LABELS: SettingsFormLabels = {
  unavailable: 'Unity Plugin settings are unavailable while the plugin is not running.',
  readOnly: 'This deployment stores settings read-only.',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  save: 'Save',
  saving: 'Saving…',
}

/** Copy for one field row. */
interface FieldCopy {
  field: UnityFieldName
  label: string
  hint: string
}

/** The three controls, in render order. */
const FIELD_COPY: readonly FieldCopy[] = [
  {
    field: 'commandTimeoutMs',
    label: 'Live-Editor command timeout (ms)',
    hint: 'Budget for unity_status, unity_list_commands, unity_command, and unity_eval.',
  },
  {
    field: 'cliTimeoutMs',
    label: 'CLI timeout (ms)',
    hint: 'Budget for unity_cli — installs, tests, and builds run long.',
  },
  {
    field: 'outputMaxBytes',
    label: 'Output cap (bytes)',
    hint: 'In-memory cap per collected CLI output stream and warm-shell response line.',
  },
]

/**
 * Render the Unity plugin's settings form.
 * @param props - the view asked for, the card snapshot, and its form actions.
 * @returns the form; nothing for a summary, which this slot never asks for.
 */
export function UnityCard(props: UnityCardProps) {
  const state = props.useUnityCard((snapshot: UnityCardState) => snapshot)
  if (props.view === 'summary') return null
  const disabled = !state.writable || state.saving
  return (
    <SettingsForm labels={FORM_LABELS} state={state} onSave={props.save} onDiscard={props.discard}>
      {FIELD_COPY.map(copy => (
        <SettingsValueField
          key={copy.field}
          id={`unity-plugin-settings-${copy.field}`}
          label={copy.label}
          hint={copy.hint}
          overriddenLabel="Overridden"
          resetLabel="Reset to default"
          invalidLabel="Enter a number above zero, or leave blank to use the default."
          numeric
          disabled={disabled}
          {...state.fields[copy.field]}
          onEdit={(text) => { props.edit(copy.field, text) }}
          onReset={() => { props.resetField(copy.field) }}
        />
      ))}
    </SettingsForm>
  )
}
