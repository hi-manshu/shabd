/**
 * State that outlives the code using it.
 *
 * A sandbox's component is thrown away and rebuilt every time its code is
 * edited. Values kept with `useShared` live in a group store outside the
 * component, so:
 *
 *   - editing the code does not reset the widget
 *   - the state panel under the preview shows, and can change, the same values
 *   - two sandboxes (or any component) in the same group stay in step
 */
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react'

export class SharedGroup {
  #values = new Map<string, unknown>()
  #listeners = new Set<() => void>()
  /** Replaced on every change, so React can tell that something moved. */
  #snapshot: ReadonlyArray<readonly [string, unknown]> = []

  has(key: string): boolean {
    return this.#values.has(key)
  }

  get(key: string): unknown {
    return this.#values.get(key)
  }

  set(key: string, value: unknown): void {
    if (this.#values.has(key) && Object.is(this.#values.get(key), value)) return
    this.#values.set(key, value)
    this.#snapshot = [...this.#values]
    for (const listener of this.#listeners) listener()
  }

  /** Every key and value, in the order they were first set. */
  entries = (): ReadonlyArray<readonly [string, unknown]> => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}

const groups = new Map<string, SharedGroup>()

export function sharedGroup(name: string): SharedGroup {
  let group = groups.get(name)
  if (!group) groups.set(name, (group = new SharedGroup()))
  return group
}

/** Set by a <Sandbox> around its preview. Components outside one fall back to the page-wide group. */
export const SharedGroupContext = createContext<SharedGroup | null>(null)

/**
 * Like `useState`, but the value belongs to the surrounding sandbox group.
 *
 *     const [count, setCount] = useShared('count', 0)
 *
 * Pass a group name as the third argument to join a group from outside a sandbox.
 */
export function useShared<T>(key: string, initial: T, groupName?: string): [T, (next: T | ((current: T) => T)) => void] {
  const fromContext = useContext(SharedGroupContext)
  const group = groupName !== undefined ? sharedGroup(groupName) : (fromContext ?? sharedGroup('page'))

  const read = useCallback(() => (group.has(key) ? (group.get(key) as T) : initial), [group, key, initial])
  const value = useSyncExternalStore(group.subscribe, read, () => initial)

  // Announce the value to the group on first use, so the state panel lists it before anyone changes it.
  useEffect(() => {
    if (!group.has(key)) group.set(key, initial)
    // The initial value only matters the first time a key is seen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, key])

  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = group.has(key) ? (group.get(key) as T) : initial
      group.set(key, typeof next === 'function' ? (next as (current: T) => T)(current) : next)
    },
    [group, key, initial],
  )

  return [value, set]
}
