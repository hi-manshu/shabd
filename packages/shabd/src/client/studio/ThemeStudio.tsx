/**
 * The theme, tried beside the page before it is kept.
 *
 * Each colour of the theme is a field for each mode. A change is sent to
 * the dev server, which answers with the stylesheet the theme would make,
 * and the page beside the Studio is drawn in it at once. The config is not
 * touched. Under the fields is how well each colour can be read against
 * what it is on, measured the way the built-in presets are held to.
 *
 * What is tried is kept by writing it to `shabd.config.yaml`, which the dev
 * server does where it can put the lines in without rewriting anything
 * else, or by copying the lines it shows. Leaving the tab without doing
 * either puts the page back in the theme the config has.
 */
import { useEffect, useRef, useState } from 'react'
import { parseColor, toHex } from '../../shared/color.js'
import { COLOR_TOKENS, OPTIONAL_COLOR_TOKENS } from '../../shared/presets.js'
import { contrastReport, MODES, tooFaint, type ContrastLine, type Mode, type ThemeColours } from '../../shared/theme-check.js'
import { siteStore } from '../app/store.js'
import { themeNow, tryTheme, type ThemeChange, type ThemeNow } from './backends.js'

/** How long typing must pause before a colour is tried. */
const TRY_DELAY = 150

/** The document's own stylesheet of the theme, which the dev server's page has under this id. */
const paint = (css: string) => {
  const style = document.getElementById('sb-theme')
  if (style && style.textContent !== css) style.textContent = css
}

/** Back to the theme the config has, which the dev server sends with the site's data. */
const putThemeBack = () => {
  const css = siteStore.get().themeCss
  if (css !== undefined) paint(css)
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function ThemeStudio() {
  /** The theme as the config has it. */
  const [now, setNow] = useState<ThemeNow | null>(null)
  /** What is being tried: the preset, and the colours that differ from the config's. */
  const [change, setChange] = useState<ThemeChange>({})
  /** The theme's colours with what is tried laid over them. */
  const [shown, setShown] = useState<ThemeColours>({})
  const [yaml, setYaml] = useState('')
  const [writable, setWritable] = useState(true)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')
  /** The last answer asked for. An older one that arrives after it is dropped. */
  const asked = useRef(0)
  /** What was tried has just been written. The page stays in it until the config comes round with the same. */
  const kept = useRef(false)
  /** The fields that have been typed in, by colour. */
  const typed = useRef(new Map<string, Set<Mode>>())

  const trying = change.preset !== undefined || Object.keys(change.colors ?? {}).length > 0

  useEffect(() => {
    let current = true
    themeNow().then(
      (theme) => {
        if (!current) return
        setNow(theme)
        setShown(theme.colors)
      },
      (error: unknown) => current && setProblem(said(error)),
    )
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    if (!now) return
    if (!trying) {
      asked.current++
      // Nothing is tried: the page is drawn in the theme the config has.
      if (!kept.current) putThemeBack()
      setShown(now.colors)
      setYaml('')
      setProblem('')
      return
    }
    const turn = ++asked.current
    const timer = window.setTimeout(() => {
      tryTheme(change).then(
        (tried) => {
          if (turn !== asked.current) return
          paint(tried.css)
          setShown(tried.colors)
          setYaml(tried.yaml)
          setWritable(tried.writable)
          setProblem('')
        },
        (error: unknown) => turn === asked.current && setProblem(said(error)),
      )
    }, TRY_DELAY)
    return () => window.clearTimeout(timer)
  }, [now, change, trying])

  // Leaving the tab, or closing the Studio, puts the page back in the theme the config has.
  useEffect(() => putThemeBack, [])

  if (!now) return <p className="sb-studio-empty">{problem || 'Reading the theme…'}</p>

  const valueOf = (token: string, mode: Mode) => change.colors?.[token]?.[mode] ?? shown[token]?.[mode] ?? ''

  const set = (token: string, mode: Mode, value: string) => {
    kept.current = false
    setDone('')
    const modes = typed.current.get(token) ?? new Set<Mode>()
    typed.current.set(token, modes.add(mode))
    const other: Mode = mode === 'light' ? 'dark' : 'light'
    // A colour the theme does not have yet is the same in both modes, until the other mode is typed in too.
    const follows = now.colors[token] === undefined && !modes.has(other)
    setChange((current) => {
      const before = current.colors?.[token] ?? shown[token]
      const pair = { light: value, dark: value }
      if (before && !follows) pair[other] = before[other]
      return { ...current, colors: { ...current.colors, [token]: pair } }
    })
  }

  const choose = (preset: string) => {
    kept.current = false
    setDone('')
    setChange(({ preset: _was, ...rest }) => (preset === now.preset ? rest : { ...rest, preset }))
  }

  const putBack = () => {
    typed.current.clear()
    kept.current = false
    setDone('')
    setChange({})
  }

  const write = () => {
    const turn = ++asked.current
    tryTheme(change, true).then(
      (tried) => {
        if (turn !== asked.current) return
        // The config says it now. The page is in these colours already, and stays in them.
        kept.current = true
        typed.current.clear()
        paint(tried.css)
        setNow({ ...now, preset: change.preset ?? now.preset, colors: tried.colors })
        setChange({})
        setDone('Written to shabd.config.yaml.')
      },
      (error: unknown) => setProblem(said(error)),
    )
  }

  const copy = () => {
    navigator.clipboard.writeText(yaml).then(
      () => setDone('Copied.'),
      () => setDone('Select the lines and copy them.'),
    )
  }

  const lines = contrastReport(shown)
  const faint = tooFaint(lines)
  /** One row for each pair, with a cell for each mode. */
  const pairs = new Map<string, ContrastLine[]>()
  for (const line of lines) pairs.set(`${line.ink} on ${line.on}`, [...(pairs.get(`${line.ink} on ${line.on}`) ?? []), line])

  const row = (token: string) => (
    <div className="sb-theme-token" key={token}>
      <span>{token}</span>
      {MODES.map((mode) => {
        const value = valueOf(token, mode)
        const colour = parseColor(value)
        return (
          <span key={mode}>
            {/* A picker only takes a colour written as six digits, so it is offered for a colour that can be. */}
            <input
              type="color"
              aria-label={`Pick ${token}, ${mode}`}
              value={colour && colour[3] === 1 ? toHex(colour) : '#000000'}
              disabled={!colour || colour[3] !== 1}
              onChange={(event) => set(token, mode, event.target.value)}
            />
            <input type="text" aria-label={`${token}, ${mode}`} value={value} spellCheck={false} autoComplete="off" onChange={(event) => set(token, mode, event.target.value)} />
          </span>
        )
      })}
    </div>
  )

  return (
    <div className="sb-theme-studio">
      <p className="sb-theme-lead">The page beside this is drawn in what you try here. Nothing is kept until you write it to the config.</p>
      <label className="sb-theme-preset">
        Preset
        <select value={change.preset ?? now.preset} onChange={(event) => choose(event.target.value)}>
          {now.presets.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <div className="sb-theme-tokens" role="group" aria-label="Colours">
        <div className="sb-theme-token" aria-hidden="true">
          <span />
          <span>Light</span>
          <span>Dark</span>
        </div>
        {COLOR_TOKENS.map(row)}
        <details>
          <summary>More colours</summary>
          {OPTIONAL_COLOR_TOKENS.map(row)}
        </details>
      </div>

      <table className="sb-theme-contrast">
        <caption>
          Contrast
          <span role="status" data-faint={faint.length}>
            {faint.length === 0 ? 'Every colour can be read against what it is on.' : `Too faint in ${faint.length} ${faint.length === 1 ? 'place' : 'places'}.`}
          </span>
        </caption>
        <thead>
          <tr>
            <th scope="col">What is read</th>
            <th scope="col">Light</th>
            <th scope="col">Dark</th>
            <th scope="col">At least</th>
          </tr>
        </thead>
        <tbody>
          {[...pairs].map(([pair, both]) => (
            <tr key={pair} data-pair={pair}>
              <th scope="row">{pair}</th>
              {both.map((line) => {
                const ok = line.ratio === undefined ? undefined : line.ratio >= line.floor
                return (
                  <td key={line.mode} data-mode={line.mode} data-ok={ok === undefined ? 'unknown' : String(ok)}>
                    {line.ratio === undefined ? 'not measured' : `${line.ratio.toFixed(1)}${ok ? '' : ', too faint'}`}
                  </td>
                )
              })}
              <td>{both[0]!.floor}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {trying && yaml && (
        <label className="sb-theme-yaml">
          {writable ? 'What the config would say' : 'This cannot be put into the config without rewriting part of it. Add these lines yourself'}
          <textarea readOnly rows={Math.min(10, yaml.split('\n').length)} value={yaml} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
      <p className="sb-theme-actions">
        <button type="button" className="sb-studio-action" disabled={!trying || !writable || problem !== ''} onClick={write}>
          Write to shabd.config.yaml
        </button>
        <button type="button" className="sb-studio-action" disabled={!trying || !yaml} onClick={copy}>
          Copy the lines
        </button>
        <button type="button" className="sb-studio-action" disabled={!trying} onClick={putBack}>
          Put back
        </button>
      </p>
      {problem && (
        <p className="sb-studio-problem" role="alert">
          {problem}
        </p>
      )}
      {done && <p role="status">{done}</p>}
    </div>
  )
}
