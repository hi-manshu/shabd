import { Children, isValidElement, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react'
import { createStore, useStore } from '../app/store.js'

interface TabProps {
  label: string
  children?: ReactNode
}

/** One panel of a <Tabs> group. */
export function Tab({ children }: TabProps) {
  return <>{children}</>
}

/**
 * What the reader chose in each family of tabs that share a `syncKey`: the
 * key, and the label of the tab. Every set with that key follows it, on this
 * page and on the next, and the browser keeps it for the next visit.
 */
const choices = createStore<Record<string, string>>({})
const storageKey = (syncKey: string) => `shabd:tabs:${syncKey}`

function remember(syncKey: string, label: string): void {
  choices.update((all) => (all[syncKey] === label ? all : { ...all, [syncKey]: label }))
  try {
    localStorage.setItem(storageKey(syncKey), label)
  } catch {
    // Storage is off or full: the choice still holds for this visit.
  }
}

/**
 * Alternatives shown one at a time, such as install commands per package manager.
 *
 *     <Tabs syncKey="package-manager">
 *       <Tab label="npm">…</Tab>
 *       <Tab label="pnpm">…</Tab>
 *     </Tabs>
 *
 * With a `syncKey`, choosing a tab chooses the tab of the same label in
 * every set that has the same key.
 */
export function Tabs({ children, syncKey }: { children?: ReactNode; syncKey?: string }) {
  const tabs = Children.toArray(children).filter((child): child is ReactElement<TabProps> => isValidElement(child))
  const [local, setLocal] = useState(0)
  const shared = useStore(choices)
  const id = useId()

  // What the browser kept from an earlier visit is read after the first render: the server could not
  // know it, and the first render in the browser has to match what the server sent.
  useEffect(() => {
    if (!syncKey || choices.get()[syncKey] !== undefined) return
    try {
      const kept = localStorage.getItem(storageKey(syncKey))
      if (kept !== null) choices.update((all) => ({ ...all, [syncKey]: kept }))
    } catch {
      // No storage: every set starts on its first tab.
    }
  }, [syncKey])

  if (tabs.length === 0) return null

  // The family's choice, when this set has a tab of that label. A set without one keeps its own.
  const followed = syncKey ? tabs.findIndex((tab) => tab.props.label === shared[syncKey]) : -1
  const selected = followed >= 0 ? followed : Math.min(local, tabs.length - 1)

  const select = (index: number, anchor?: HTMLElement) => {
    setLocal(index)
    const label = tabs[index]?.props.label
    if (!syncKey || label === undefined) return
    // Sets above this one may grow or shrink as they follow. Keep the tab the reader pressed where it was on screen.
    const before = anchor?.getBoundingClientRect().top
    remember(syncKey, label)
    if (anchor && before !== undefined) {
      requestAnimationFrame(() => window.scrollBy(0, anchor.getBoundingClientRect().top - before))
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = (selected + step + tabs.length) % tabs.length
    const button = document.getElementById(`${id}-tab-${next}`)
    select(next, button ?? undefined)
    button?.focus()
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
            onClick={(event) => select(index, event.currentTarget)}
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
          // On paper every panel is printed, and this is the heading it is printed under.
          data-label={tab.props.label}
        >
          {tab.props.children}
        </div>
      ))}
    </div>
  )
}
