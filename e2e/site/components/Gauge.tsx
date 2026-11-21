/** A file of the site's own that live snippets may import: `features.sandbox.modules` gives it a name. */
export const unit = 'bar'

export default function Gauge({ value }: { value: number }) {
  return (
    <output data-gauge="of-the-fixture">
      {value} {unit}
    </output>
  )
}
