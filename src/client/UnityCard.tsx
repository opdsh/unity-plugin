/**
 * The Unity plugin card inside the dsh settings Plugin-configuration tab,
 * matching the shipped plugin cards' chrome: an expandable tile whose header
 * names the plugin over what its settings govern, disclosing the staged
 * controls in place with the save that writes them. The tab stacks cards in a
 * `<ul>`, so the card root is an `<li>`. Styling replicates the shipped
 * PluginCard/fields rules over the theme's alias tokens (the bundle purity
 * gate forbids importing them as values); copy mirrors the shipped English
 * strings so the card reads as one surface.
 * @module unity-plugin/client/UnityCard
 */

import { useState } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `settings.plugin.item` SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { UnityCardFace, UnityCardState, UnityFieldName, UnityFieldState } from './controller.ts'

/** Props the renderer binds for the Unity card. */
export type UnityCardProps = PropsRuntime<'settings.plugin.item'> & InjectFace<UnityCardFace>

/** Class-name prefix scoping the injected stylesheet to this card. */
const CN = 'unity-plugin-card'

/** The card stylesheet: the shipped PluginCard/fields rules under scoped names. */
const CARD_CSS = `
.${CN} { list-style: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-3); transition: border-color .16s, background .16s; }
.${CN}:hover { border-color: var(--dsw-alias-label-dimmed); }
.${CN}--open { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }
.${CN}__header { width: 100%; appearance: none; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; }
.${CN}__header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.${CN}__headText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.${CN}__name { font-size: 15px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); }
.${CN}__description { font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.${CN}__pending { flex: none; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.${CN}__chevron { flex: none; color: var(--dsw-alias-label-tertiary); transition: transform .16s; }
.${CN}__chevron--open { transform: rotate(180deg); }
.${CN}__body { border-top: 1px solid var(--dsw-alias-border-l2); margin: 0 16px; padding-bottom: 8px; }
.${CN}__readOnly { margin: 12px 0 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.${CN}__field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.${CN}__field + .${CN}__field { border-top: 1px solid var(--dsw-alias-border-l2); }
.${CN}__fieldHead { display: flex; align-items: center; gap: 8px; }
.${CN}__label { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.${CN}__badges { display: inline-flex; align-items: center; gap: 8px; }
.${CN}__badge { border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; white-space: nowrap; font-weight: 500; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.${CN}__reset { border: none; background: none; padding: 0; font: inherit; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.${CN}__reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.${CN}__reset:disabled { cursor: default; }
.${CN}__input { height: 34px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.${CN}__input:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.${CN}__input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.${CN}__input--invalid { border-color: var(--dsw-alias-label-error); }
.${CN}__hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.${CN}__hint--invalid { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-error); }
.${CN}__footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 0 4px; border-top: 1px solid var(--dsw-alias-border-l2); }
.${CN}__failed { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-error); }
.${CN}__discard, .${CN}__save { appearance: none; border: 1px solid transparent; border-radius: 8px; padding: 5px 14px; font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer; }
.${CN}__discard { border-color: var(--dsw-alias-border-l2); background: none; color: var(--dsw-alias-label-secondary); }
.${CN}__discard:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }
.${CN}__save { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.${CN}__discard:disabled, .${CN}__save:disabled { opacity: 0.4; cursor: default; }
.${CN}__discard:focus-visible, .${CN}__save:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
`

/** Inject the card stylesheet once per document. */
function ensureStylesheet(): void {
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${CN}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'unity-plugin'
  tag.dataset.pluginCss = CN
  tag.textContent = CARD_CSS
  document.head.appendChild(tag)
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
 * Render one staged numeric control in the shipped ValueField chrome.
 * @param props - field copy and state plus the form actions it drives.
 * @returns the labelled control.
 */
function FieldRow(props: {
  copy: FieldCopy
  state: UnityFieldState
  disabled: boolean
  onEdit: (text: string) => void
  onReset: () => void
}) {
  const { copy, state } = props
  const id = `unity-plugin-settings-${copy.field}`
  return (
    <div className={`${CN}__field`}>
      <div className={`${CN}__fieldHead`}>
        <label className={`${CN}__label`} htmlFor={id}>{copy.label}</label>
        {state.overridden
          ? (
            <span className={`${CN}__badges`}>
              <span className={`${CN}__badge`}>Overridden</span>
              <button type="button" className={`${CN}__reset`} disabled={props.disabled} onClick={props.onReset}>
                Reset to default
              </button>
            </span>
          )
          : null}
      </div>
      <input
        id={id}
        className={state.invalid ? `${CN}__input ${CN}__input--invalid` : `${CN}__input`}
        type="text"
        inputMode="numeric"
        {...state.invalid ? { 'aria-invalid': true } : {}}
        value={state.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={state.invalid ? `${CN}__hint--invalid` : `${CN}__hint`}>
        {state.invalid ? 'Enter a number, or leave blank to use the default.' : copy.hint}
      </p>
    </div>
  )
}

/**
 * Render the Unity plugin card.
 * @param props - the card snapshot and its form actions.
 * @returns the expandable tile, or null while the Host serves no `unity` namespace.
 */
export function UnityCard(props: UnityCardProps) {
  const [open, setOpen] = useState(false)
  const state = props.useUnityCard((snapshot: UnityCardState) => snapshot)
  if (!state.available) return null
  ensureStylesheet()
  const disabled = !state.writable || state.saving
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li className={open ? `${CN} ${CN}--open` : CN}>
      <button
        type="button"
        className={`${CN}__header`}
        aria-expanded={open}
        aria-label={`${open ? 'Hide settings' : 'Show settings'}: Unity Plugin`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={`${CN}__headText`}>
          <span className={`${CN}__name`}>Unity Plugin</span>
          <span className={`${CN}__description`}>Unity Game Engine Integration</span>
        </span>
        {state.dirty ? <span className={`${CN}__pending`}>Unsaved</span> : null}
        <IconChevronDownOutline14 className={open ? `${CN}__chevron ${CN}__chevron--open` : `${CN}__chevron`} />
      </button>
      {open
        ? (
          <div className={`${CN}__body`}>
            {!state.writable
              ? <p className={`${CN}__readOnly`} role="status">This deployment stores settings read-only.</p>
              : null}
            {FIELD_COPY.map(copy => (
              <FieldRow
                key={copy.field}
                copy={copy}
                state={state.fields[copy.field]}
                disabled={disabled}
                onEdit={(text) => { props.edit(copy.field, text) }}
                onReset={() => { props.resetField(copy.field) }}
              />
            ))}
            <div className={`${CN}__footer`}>
              {state.failed
                ? (
                  <p className={`${CN}__failed`} role="status">
                    The deployment did not accept these values; they were left for you to correct.
                  </p>
                )
                : null}
              <button type="button" className={`${CN}__discard`} disabled={!state.dirty || state.saving} onClick={props.discard}>
                Discard
              </button>
              <button type="button" className={`${CN}__save`} disabled={blocked} onClick={props.save}>
                {state.saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
