// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { Icon, type IconName } from './icons'

// A left-bar view's title row, with its actions as icon buttons on the right (each with a tooltip saying what it does).
export type HeadAction = { icon: IconName; title: string; onClick: () => void; on?: boolean; disabled?: boolean }

export function SideHead({ title, hint, actions = [] }: { title: string; hint?: string; actions?: HeadAction[] }): React.JSX.Element {
  return (
    <div className="side-head">
      <span title={hint}>{title}</span>
      <span>
        {actions.map((a) => (
          <button key={a.title} className={'row-act head-act' + (a.on ? ' on' : '')} title={a.title} disabled={a.disabled} onClick={a.onClick}>
            <Icon name={a.icon} />
          </button>
        ))}
      </span>
    </div>
  )
}
