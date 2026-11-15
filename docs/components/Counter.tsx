import { useState } from 'react'

/** Registered under `components:` in shabd.config.yaml, so MDX pages can write <Counter />. */
export default function Counter({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start)
  return (
    <p>
      <button type="button" className="sb-button" data-variant="secondary" onClick={() => setCount(count + 1)}>
        Clicked {count} {count === 1 ? 'time' : 'times'}
      </button>
    </p>
  )
}
