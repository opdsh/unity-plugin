/**
 * The Unity plugin's settings form on its bundle page in the Plugins page,
 * drawn with the shared settings form chrome so it reads as one surface with
 * the official plugin pages. The page draws the bundle's title, description,
 * and rows itself. Copy mirrors the shipped English strings.
 * @module unity-plugin/client/UnityCard
 */

import { SettingsForm, SettingsValueField, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsFieldState, SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** Copy for one control. */
interface FieldCopy {
  field: UnityFieldName
  label: string
  hint: string
  /** How the control edits the field. */
  kind: 'text' | 'number' | 'switch'
  /** Shown in place of the invalid-draft hint; number fields only. */
  invalid?: string
  /** Shown while the draft is empty; text fields only. */
  placeholder?: string
}

/** One titled group of controls. */
interface SectionCopy {
  title: string
  fields: readonly FieldCopy[]
}

const POSITIVE = 'Enter a number above zero, or leave blank to use the default.'
const TIMER = 'Enter a number of milliseconds above zero and at most 2147483647, or leave blank to use the default.'

/** The controls, grouped and in render order. */
const SECTIONS: readonly SectionCopy[] = [
  {
    title: 'Unity CLI',
    fields: [
      { field: 'unityBin', kind: 'text', label: 'unity executable', hint: 'A name resolved through PATH, or an absolute path.', placeholder: 'unity' },
      { field: 'projectPath', kind: 'text', label: 'Default project path', hint: 'The Unity project the live-Editor tools target unless a tool call names another. Leave blank to use the only running Editor.', placeholder: '/path/to/MyGame' },
    ],
  },
  {
    title: 'Timeouts and limits',
    fields: [
      { field: 'commandTimeoutMs', kind: 'number', label: 'Live-Editor command timeout (ms)', hint: 'Budget for unity_status, unity_list_commands, unity_command, and unity_eval.', invalid: TIMER },
      { field: 'cliTimeoutMs', kind: 'number', label: 'CLI timeout (ms)', hint: 'Budget for unity_cli — installs, tests, and builds run long.', invalid: TIMER },
      { field: 'graceMs', kind: 'number', label: 'Kill grace (ms)', hint: 'How long a timed-out or cancelled unity process gets to exit before it is killed.', invalid: 'Enter a number of milliseconds from 0 to 2147483647, or leave blank to use the default.' },
      { field: 'outputMaxBytes', kind: 'number', label: 'Output cap (bytes)', hint: 'In-memory cap per collected CLI output stream and warm-shell response line.', invalid: POSITIVE },
    ],
  },
  {
    title: 'Warm shell',
    fields: [
      { field: 'warmShell', kind: 'switch', label: 'Keep a warm unity shell', hint: 'Reuse one unity shell session per project for the live-Editor tools, cutting each call from about 600 ms to a few milliseconds.' },
      { field: 'shellIdleMs', kind: 'number', label: 'Idle timeout (ms)', hint: 'A warm session with no work is closed after this long.', invalid: TIMER },
    ],
  },
  {
    title: 'Unity skills',
    fields: [
      { field: 'unitySkillsDownload', kind: 'switch', label: 'Download Unity\'s skill collection', hint: 'Fetch Unity\'s official agent skills from GitHub and offer them to the agent alongside this plugin\'s own.' },
      { field: 'unitySkillsRepo', kind: 'text', label: 'Repository', hint: 'Git URL of the skill collection.' },
      { field: 'unitySkillsRef', kind: 'text', label: 'Ref', hint: 'Commit, tag, or branch to fetch. Changing it downloads that version.' },
      { field: 'unitySkillsCacheDir', kind: 'text', label: 'Cache directory', hint: 'Where the collection is stored.', placeholder: '<dsh home>/cache/unity-plugin/unity-skills' },
    ],
  },
]

/** Class-name prefix scoping the injected stylesheet to this card. */
const CN = 'unity-plugin-form'

/**
 * Section headings and the switch row, over the theme's alias tokens; the
 * shared primitives draw everything else. The bundle purity gate forbids
 * importing their CSS modules, so the switch row restates their field rules.
 */
const FORM_CSS = `
.${CN}__section + .${CN}__section { margin-top: 20px; }
.${CN}__title { margin: 0; padding-bottom: 4px; font-size: 13px; font-weight: 600; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.${CN}__switch { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.${CN}__title + .${CN}__switch { border-top: 0; }
.${CN}__head { display: flex; align-items: center; gap: 8px; }
.${CN}__label { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.${CN}__reset { border: none; background: none; padding: 0; font: inherit; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.${CN}__reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.${CN}__reset:disabled { cursor: default; }
.${CN}__hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.${CN}__note { margin: 16px 0 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
`

/** Inject the form stylesheet once per document. */
function ensureStylesheet(): void {
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${CN}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'unity-plugin'
  tag.dataset.pluginCss = CN
  tag.textContent = FORM_CSS
  document.head.appendChild(tag)
}

/**
 * Render one on/off field in the shared field layout, with the switch where
 * the value field puts its input.
 * @param props - the field's copy and state plus the edit actions.
 * @returns the labelled switch.
 */
function SwitchField(props: {
  copy: FieldCopy
  state: SettingsFieldState
  disabled: boolean
  onEdit: (text: string) => void
  onReset: () => void
}) {
  const { copy, state } = props
  return (
    <div className={`${CN}__switch`}>
      <div className={`${CN}__head`}>
        <span className={`${CN}__label`}>{copy.label}</span>
        {state.overridden
          ? (
            <>
              <Tag tone="neutral">Overridden</Tag>
              <button type="button" className={`${CN}__reset`} disabled={props.disabled} onClick={props.onReset}>
                Reset to default
              </button>
            </>
          )
          : null}
        <Switch
          checked={state.text === 'true'}
          label={copy.label}
          disabled={props.disabled}
          onChange={(next) => { props.onEdit(String(next)) }}
        />
      </div>
      <p className={`${CN}__hint`}>{copy.hint}</p>
    </div>
  )
}

/**
 * Render the Unity plugin's settings form.
 * @param props - the view asked for, the card snapshot, and its form actions.
 * @returns the form; nothing for a summary, which this slot never asks for.
 */
export function UnityCard(props: UnityCardProps) {
  const state = props.useUnityCard((snapshot: UnityCardState) => snapshot)
  if (props.view === 'summary') return null
  ensureStylesheet()
  const disabled = !state.writable || state.saving
  return (
    <SettingsForm labels={FORM_LABELS} state={state} onSave={props.save} onDiscard={props.discard}>
      {SECTIONS.map(section => (
        <section key={section.title} className={`${CN}__section`}>
          <h3 className={`${CN}__title`}>{section.title}</h3>
          {section.fields.map(copy => copy.kind === 'switch'
            ? (
              <SwitchField
                key={copy.field}
                copy={copy}
                state={state.fields[copy.field]}
                disabled={disabled}
                onEdit={(text) => { props.edit(copy.field, text) }}
                onReset={() => { props.resetField(copy.field) }}
              />
            )
            : (
              <SettingsValueField
                key={copy.field}
                id={`unity-plugin-settings-${copy.field}`}
                label={copy.label}
                hint={copy.hint}
                overriddenLabel="Overridden"
                resetLabel="Reset to default"
                invalidLabel={copy.invalid ?? 'Enter a valid value, or leave blank to use the default.'}
                numeric={copy.kind === 'number'}
                {...copy.placeholder === undefined ? {} : { placeholder: copy.placeholder }}
                disabled={disabled}
                {...state.fields[copy.field]}
                onEdit={(text) => { props.edit(copy.field, text) }}
                onReset={() => { props.resetField(copy.field) }}
              />
            ))}
        </section>
      ))}
      <p className={`${CN}__note`}>
        Environment variables for the unity CLI (CI service-account credentials) stay in the profile&apos;s cordis.patch.yml, so they never reach the browser.
      </p>
    </SettingsForm>
  )
}
