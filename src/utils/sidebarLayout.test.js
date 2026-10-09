import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Protect the shrink/wrap rules that prevent sidebar overflow. These are
// stylesheet contract tests, not a replacement for rendered browser checks.
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]

function declarationsFor(selector) {
  const matching = rules.filter(([, selectors]) => selectors.split(',').some((item) => item.trim() === selector))
  assert.ok(matching.length, `Missing rule for ${selector}`)
  return Object.fromEntries(matching.flatMap(([, , declarations]) => (
    declarations.split(';').filter((item) => item.includes(':')).map((item) => {
      const colon = item.indexOf(':')
      return [item.slice(0, colon).trim(), item.slice(colon + 1).trim()]
    })
  )))
}

test('sidebar children are bounded without clipping the entire rail', () => {
  assert.equal(declarationsFor('.control-rail')['min-width'], '0')
  const children = declarationsFor('.control-rail > *')
  assert.equal(children['min-width'], '0')
  assert.equal(children['max-width'], '100%')
  for (const selector of ['.control-rail', '.control-rail > *']) {
    const declarations = declarationsFor(selector)
    for (const property of ['overflow', 'overflow-x']) {
      assert.notEqual(declarations[property], 'hidden')
      assert.notEqual(declarations[property], 'clip')
    }
  }
})

test('file lists and nested source previews have shrinkable grid tracks', () => {
  for (const selector of ['.run-list', '.preview-samples', '.preview-sample']) {
    const declarations = declarationsFor(selector)
    assert.equal(declarations['grid-template-columns'], 'minmax(0, 1fr)', selector)
    assert.equal(declarations['min-width'], '0', selector)
    assert.equal(declarations['max-width'], '100%', selector)
  }
})

test('upload warnings and parser feedback can wrap unbroken filenames and errors', () => {
  for (const selector of ['.error-message', '.parser-notice', '.preview-error', '.preview-range']) {
    assert.equal(declarationsFor(selector)['overflow-wrap'], 'anywhere', selector)
  }
  assert.equal(declarationsFor('.error-message')['white-space'], 'pre-line')
  assert.equal(declarationsFor('.error-message')['max-width'], '100%')
})

test('file names remain ellipsized and file controls do not force wider rows', () => {
  const row = declarationsFor('.run-row')
  assert.equal(row['min-width'], '0')
  assert.equal(row['max-width'], '100%')
  assert.equal(declarationsFor('.run-copy')['min-width'], '0')
  for (const selector of ['.run-copy strong', '.run-copy span']) {
    const declarations = declarationsFor(selector)
    assert.equal(declarations['white-space'], 'nowrap')
    assert.equal(declarations['text-overflow'], 'ellipsis')
    assert.equal(declarations.overflow, 'hidden')
  }
  assert.equal(declarationsFor('.baseline-choice span')['min-width'], '0')
  assert.equal(declarationsFor('.run-row > .icon-button').flex, 'none')
})

test('preview statistics can wrap large counts inside two bounded columns', () => {
  assert.equal(declarationsFor('.preview-stats')['grid-template-columns'], 'repeat(2, minmax(0, 1fr))')
  assert.equal(declarationsFor('.preview-stats span')['min-width'], '0')
  assert.equal(declarationsFor('.preview-stats span')['flex-wrap'], 'wrap')
  assert.equal(declarationsFor('.preview-stats b')['max-width'], '100%')
  assert.equal(declarationsFor('.preview-stats b')['overflow-wrap'], 'anywhere')
})

test('preview file selectors shrink and parsed values wrap rather than overflow', () => {
  const select = declarationsFor('.parser-preview-head select')
  assert.equal(select['min-width'], '0')
  assert.equal(select['max-width'], '58%')
  const source = declarationsFor('.preview-sample > span')
  assert.equal(source['min-width'], '0')
  assert.equal(source['text-overflow'], 'ellipsis')
  const values = declarationsFor('.preview-samples code')
  assert.equal(values['max-width'], '100%')
  assert.equal(values['white-space'], 'pre-wrap')
  assert.equal(values['overflow-wrap'], 'anywhere')
})

test('long numeric sample candidates stay inside their field cards', () => {
  assert.equal(declarationsFor('.sample-candidates')['grid-template-columns'], 'minmax(0, 1fr)')
  const button = declarationsFor('.sample-candidates button')
  assert.equal(button['min-width'], '0')
  assert.equal(button['max-width'], '100%')
  assert.equal(button['overflow-wrap'], 'anywhere')
})

test('expanded generated rules retain their bounded wrapping and local scroll area', () => {
  const rule = declarationsFor('.generated-rule')
  assert.equal(rule['max-width'], '100%')
  assert.equal(rule['white-space'], 'pre-wrap')
  assert.equal(rule['overflow-wrap'], 'anywhere')
  assert.equal(rule.overflow, 'auto')
  assert.equal(rule['max-height'], '128px')
})
