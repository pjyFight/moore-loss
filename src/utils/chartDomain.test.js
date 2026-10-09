import assert from 'node:assert/strict'
import test from 'node:test'
import { getIntegerStepTicks, getYDomain } from './chartDomain.js'

test('zero-baseline raw traces use a wide readable scale', () => {
  assert.deepEqual(getYDomain([1, 2, 3], { zeroBaseline: true }), [0, 5])
  assert.deepEqual(getYDomain([1.2, 1.201, 1.203], { zeroBaseline: true }), [0, 1.9])
  assert.deepEqual(getYDomain([0.101, 0.102, 0.103], { zeroBaseline: true }), [0, 0.16])
})

test('zero-baseline domains stay finite and positive for empty, zero, and negative traces', () => {
  for (const values of [[], [0, 0], [-4, -2]]) {
    const [min, max] = getYDomain(values, { zeroBaseline: true })
    assert.equal(min, 0)
    assert.ok(Number.isFinite(max))
    assert.ok(max > 0)
  }
})

test('non-zero-baseline raw domains preserve the existing 8 percent padding', () => {
  assert.deepEqual(getYDomain([1, 2, 3]), [0.84, 3.16])
})

test('signed difference domains include both sides of the threshold', () => {
  assert.deepEqual(getYDomain([-2, 3], { signed: true, threshold: 0.5 }), [-2.4, 3.4])
})

test('unsigned difference domains include a positive threshold', () => {
  assert.deepEqual(getYDomain([0.1, 0.2], { threshold: 0.5 }), [0.068, 0.532])
})

test('relative values can be passed in display units without changing semantics', () => {
  const [min, max] = getYDomain([5, 10], { threshold: 5 })
  assert.equal(min, 4.6)
  assert.equal(max, 10.4)
})

test('100-step charts have a dense integer scale instead of only three ticks', () => {
  assert.deepEqual(getIntegerStepTicks(0, 100), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
  assert.deepEqual(getIntegerStepTicks(1, 100), [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
})

test('short step ranges include every visible integer', () => {
  assert.deepEqual(getIntegerStepTicks(3, 7), [3, 4, 5, 6, 7])
  assert.deepEqual(getIntegerStepTicks(80.25, 82.25), [81, 82])
  assert.deepEqual(getIntegerStepTicks(10, 10), [10])
})

test('step ticks retain endpoints without crowding them with nearby internal ticks', () => {
  assert.deepEqual(getIntegerStepTicks(0, 6200), [0, 1000, 2000, 3000, 4000, 5000, 6200])
  assert.deepEqual(getIntegerStepTicks(10.2, 46.8), [11, 15, 20, 25, 30, 35, 40, 46])
  assert.deepEqual(getIntegerStepTicks(1, 21, 5), [1, 5, 10, 15, 21])
  assert.deepEqual(getIntegerStepTicks(5, 45, 5), [5, 10, 20, 30, 40, 45])
})

test('zoomed step ticks are strictly increasing integers inside the visible domain', () => {
  for (const [minStep, maxStep] of [[10.2, 46.8], [0.2, 1.8], [-12.8, 5.3], [1234.2, 1539.8]]) {
    const ticks = getIntegerStepTicks(minStep, maxStep)
    assert.equal(ticks[0], Math.ceil(minStep))
    assert.equal(ticks.at(-1), Math.floor(maxStep))
    for (const [index, tick] of ticks.entries()) {
      assert.ok(Number.isInteger(tick), `${tick} must be an integer`)
      assert.ok(tick >= minStep && tick <= maxStep, `${tick} must stay in the visible range`)
      if (index > 0) assert.ok(tick > ticks[index - 1], 'ticks must be unique and strictly increasing')
    }
  }
})

test('explicit tick budgets retain a sparse option for narrower charts', () => {
  assert.deepEqual(getIntegerStepTicks(0, 100, 5), [0, 50, 100])
})

test('plot width keeps dense ticks on desktop and reduces them on narrow charts', () => {
  assert.deepEqual(getIntegerStepTicks(0, 100, 11, 786), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
  assert.deepEqual(getIntegerStepTicks(0, 100, 11, 260), [0, 40, 60, 100])
  assert.deepEqual(getIntegerStepTicks(0, 100, 11, 150), [0, 50, 100])
  assert.deepEqual(getIntegerStepTicks(0, 100, 11, 1), [0, 100])
})

test('long integer step labels have room near both chart endpoints', () => {
  assert.deepEqual(getIntegerStepTicks(1_000_000, 1_000_100, 11, 786), [1_000_000, 1_000_040, 1_000_060, 1_000_100])
})

test('invalid or unavailable plot width does not reduce the default tick density', () => {
  const defaultTicks = getIntegerStepTicks(0, 100)
  for (const plotWidth of [NaN, Infinity, -Infinity, -5, 0, null, '786']) {
    assert.deepEqual(getIntegerStepTicks(0, 100, 11, plotWidth), defaultTicks)
  }
})

test('invalid tick budgets fall back to the denser default and oversized budgets are bounded', () => {
  const defaultTicks = getIntegerStepTicks(0, 100)
  for (const desiredCount of [NaN, Infinity, -Infinity, -5, 0, 1, null, '11']) {
    assert.deepEqual(getIntegerStepTicks(0, 100, desiredCount), defaultTicks)
  }
  assert.deepEqual(getIntegerStepTicks(0, 980, 1_000_000), getIntegerStepTicks(0, 980, 50))
  assert.ok(getIntegerStepTicks(0, 980, 1_000_000).length <= 50)
})

test('invalid or integer-free step domains do not emit out-of-range ticks', () => {
  for (const [minStep, maxStep] of [[NaN, 100], [0, NaN], [Infinity, 100], [0, Infinity], [-Infinity, 100], [100, 0], [0.2, 0.8], [10.2, 10.2]]) {
    assert.deepEqual(getIntegerStepTicks(minStep, maxStep), [])
  }
})

test('extreme finite step domains return bounded integer ticks without losing endpoints', () => {
  for (const [minStep, maxStep] of [[2 ** 54, (2 ** 54) + 4], [-Number.MAX_VALUE, Number.MAX_VALUE]]) {
    const ticks = getIntegerStepTicks(minStep, maxStep)
    assert.equal(ticks[0], minStep)
    assert.equal(ticks.at(-1), maxStep)
    assert.ok(ticks.length <= 50, 'tick generation must stay bounded')
    for (const [index, tick] of ticks.entries()) {
      assert.ok(Number.isFinite(tick) && Number.isInteger(tick), 'ticks must be finite integers')
      assert.ok(tick >= minStep && tick <= maxStep, 'ticks must stay inside the visible range')
      if (index > 0) assert.ok(tick > ticks[index - 1], 'ticks must advance despite floating-point precision limits')
    }
  }
})
