import { useState } from 'react'

export default function Counter({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start)
  return (
    <button type="button" data-testid="counter" onClick={() => setCount(count + 1)}>
      Count is {count}
    </button>
  )
}
