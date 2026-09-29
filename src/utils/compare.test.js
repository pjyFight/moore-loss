import assert from 'node:assert/strict'
import test from 'node:test'
import { buildComparison, COMPARISON_MODES, formatErrorFixed } from './compare.js'

const runs = [
  { name: 'A', color: '#6d5dfc', points: [
    { step: 0, loss: 2, gradNorm: 4 },
    { step: 100, loss: 4, gradNorm: 5 },
    { step: 200, loss: 6, gradNorm: 8 },
  ] },
  { name: 'B', color: '#17b992', points: [
    { step: 0, loss: 1, gradNorm: 2 },
    { step: 100, loss: 2, gradNorm: 3 },
    { step: 200, loss: 3, gradNorm: 4 },
  ] },
]

test('modes follow the requested TrainingLogParser order', () => {
  assert.deepEqual(Object.keys(COMPARISON_MODES), ['absolute', 'relative_abs', 'normal', 'relative_normal'])
})

test('all modes return an empty result before two files are uploaded', () => {
  for (const mode of Object.keys(COMPARISON_MODES)) {
    for (const selected of [[], [runs[0]]]) {
      const result = buildComparison(selected, 'loss', mode)
      assert.deepEqual(result.rawSeries, [])
      assert.deepEqual(result.errorSeries, [])
      assert.deepEqual(result.labels, [])
      assert.equal(result.errorStats.mean, null)
    }
  }
})

test('absolute comparison exposes raw traces and absolute per-step differences', () => {
  const result = buildComparison(runs, 'loss', 'absolute')
  assert.deepEqual(result.rawSeries.map((series) => series.points.map((point) => point.value)), [[2, 4, 6], [1, 2, 3]])
  assert.deepEqual(result.errorSeries[0].points.map((point) => point.value), [1, 2, 3])
  assert.equal(result.errorStats.mean, 2)
  assert.equal(result.errorStats.meanSquare, 14 / 3)
})

test('relative absolute and relative normal use A as denominator', () => {
  const relativeAbs = buildComparison(runs, 'loss', 'relative_abs')
  const relativeNormal = buildComparison(runs, 'loss', 'relative_normal')
  assert.deepEqual(relativeAbs.errorSeries[0].points.map((point) => point.value), [0.5, 0.5, 0.5])
  assert.deepEqual(relativeNormal.errorSeries[0].points.map((point) => point.value), [0.5, 0.5, 0.5])
})

test('normal comparison preserves the sign of A minus B', () => {
  const result = buildComparison([
    { name: 'A', points: [{ step: 0, loss: 1 }, { step: 100, loss: 2 }] },
    { name: 'B', points: [{ step: 0, loss: 2 }, { step: 100, loss: 1 }] },
  ], 'loss', 'normal')
  assert.deepEqual(result.errorSeries[0].points.map((point) => point.value), [-1, 1])
  assert.equal(result.errorStats.min, -1)
})

test('run names containing baseline are still treated as ordinary traces', () => {
  const result = buildComparison([
    { name: 'baseline.log', color: '#6d5dfc', points: [{ step: 0, loss: 2 }] },
    { name: 'moore.log', color: '#17b992', points: [{ step: 0, loss: 1 }] },
  ], 'loss', 'absolute')
  assert.equal(result.rawSeries[0].baseline, undefined)
  assert.equal(result.rawSeries[1].baseline, undefined)
})

test('summary error formatting preserves eight decimal places', () => {
  assert.equal(formatErrorFixed(0.0712345, 'absolute'), '0.07123450')
  assert.equal(formatErrorFixed(-0.0000001, 'normal'), '-0.00000010')
  assert.equal(formatErrorFixed(0.123456789, 'relative_abs'), '12.34567890%')
})

test('aligns by shared steps, not array indices', () => {
  const uneven = [
    { name: 'A', points: [{ step: 0, loss: 10 }, { step: 100, loss: 3 }, { step: 200, loss: 5 }] },
    { name: 'B', points: [{ step: 100, loss: 1 }, { step: 200, loss: 1 }] },
  ]
  const result = buildComparison(uneven, 'loss', 'absolute')
  assert.deepEqual(result.labels, [100, 200])
  assert.deepEqual(result.errorSeries[0].points.map((point) => point.value), [2, 4])
})

test('does not invent a comparison when steps do not overlap', () => {
  const disjoint = [runs[0], { name: 'B', points: [{ step: 50, loss: 1 }] }]
  const result = buildComparison(disjoint, 'loss', 'absolute')
  assert.deepEqual(result.errorSeries, [])
  assert.deepEqual(result.rawSeries, [])
})
