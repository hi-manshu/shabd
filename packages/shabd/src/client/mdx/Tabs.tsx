import { Children, isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react'

interface TabProps {
  label: string
  children?: ReactNode
}

/** One panel of a <Tabs> group. */
export function Tab({ children }: TabProps) {
  return <>{children}</>
}

/**
 * Alternatives shown one at a time, such as install commands per package manager.
 *
 *     <Tabs>
 *       <Tab label="npm">…</Tab>
 *       <Tab label="pnpm">…</Tab>
 *     </Tabs>
 */
export function Tabs({ children }: { children?: ReactNode }) {
  const tabs = Children.toArray(children).filter((child): child is ReactElement<TabProps> => isValidElement(child))
  const [selected, setSelected] = useState(0)
  const id = useId()
  if (tabs.length === 0) return null

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = (selected + step + tabs.length) % tabs.length
    setSelected(next)
    document.getElementById(`${id}-tab-${next}`)?.focus()
  }

  return (
    <div className="sb-tabs">
      <div className="sb-tab-list" role="tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={index === selected}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => setSelected(index)}
          >
            {tab.props.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={index}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          hidden={index !== selected}
          className="sb-tab-panel"
        >
          {tab.props.children}
        </div>
      ))}
    </div>
  )
}
