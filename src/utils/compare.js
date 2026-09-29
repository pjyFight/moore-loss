export const COMPARISON_MODES = {
  absolute: {
    label: 'Comparison absolute',
    shortLabel: 'Absolute',
    helper: '|A − B|',
    signed: false,
    relative: false,
  },
  relative_abs: {
    label: 'Comparison relative absolute',
    shortLabel: 'Relative absolute',
    helper: '|(A − B) / A|',
    signed: false,
    relative: true,
  },
  normal: {
    label: 'Comparison normal',
    shortLabel: 'Normal',
    helper: 'A − B',
    signed: true,
    relative: false,
  },
  relative_normal: {
    label: 'Comparison relative normal',
    shortLabel: 'Relative normal',
    helper: '(A − B) / A',
    signed: true,
    relative: true,
  },
}

const emptyComparison = () => ({
  paired: [],
  labels: [],
  rawSeries: [],
  errorSeries: [],
  min: 0,
  max: 1,
  errorStats: { mean: null, meanSquare: null, max: null, min: null },
})

function errorValue(a, b, mode) {
  const denominator = Math.max(Math.abs(a), 1e-12)
  if (mode === 'absolute') return Math.abs(a - b)
  if (mode === 'relative_abs') return Math.abs(a - b) / denominator
  if (mode === 'relative_normal') return (a - b) / denominator
  return a - b
}

export function buildComparison(runs, metric, mode) {
  const [left, right] = runs
  if (!left || !right) return emptyComparison()

  // Match by the actual sampled training step. This keeps the two panels honest
  // when the uploaded logs have different lengths or missing steps.
  const rightByStep = new Map(right.points.map((point) => [point.step, point[metric]]))
  const paired = left.points.flatMap((point) => {
    const a = point[metric]
    const b = rightByStep.get(point.step)
    return Number.isFinite(a) && Number.isFinite(b) ? [{ step: point.step, a, b }] : []
  })
  if (!paired.length) return emptyComparison()

  const rawSeries = [
    { id: 'a', label: left.name, color: left.color, points: paired.map(({ step, a }) => ({ step, value: a })) },
    { id: 'b', label: right.name, color: right.color, points: paired.map(({ step, b }) => ({ step, value: b })) },
  ]
  const differencePoints = paired.map(({ step, a, b }) => ({ step, value: errorValue(a, b, mode) }))
  const errorSeries = [{
    id: 'difference',
    label: `${COMPARISON_MODES[mode].label} · ${left.name} vs ${right.name}`,
    color: COMPARISON_MODES[mode].relative ? '#f2a93b' : '#e76f51',
    points: differencePoints,
  }]
  const values = differencePoints.map((point) => point.value)
  const absValues = values.map((value) => Math.abs(value))
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const meanSquare = values.reduce((sum, value) => sum + value ** 2, 0) / values.length
  const last = paired.at(-1)

  return {
    paired,
    labels: paired.map(({ step }) => step),
    rawSeries,
    errorSeries,
    min: Math.min(...values),
    max: Math.max(...values),
    errorStats: {
      mean,
      meanSquare,
      max: Math.max(...absValues),
      min: Math.min(...values),
    },
    final: {
      a: last.a,
      b: last.b,
      error: differencePoints.at(-1).value,
    },
  }
}

export function formatValue(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  if (Math.abs(value) < 0.001) return value.toExponential(2)
  return value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')
}

export function formatError(value, mode, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return COMPARISON_MODES[mode].relative
    ? `${(value * 100).toFixed(digits)}%`
    : formatValue(value, digits)
}

export function formatErrorFixed(value, mode, digits = 8) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return COMPARISON_MODES[mode].relative
    ? `${(value * 100).toFixed(digits)}%`
    : value.toFixed(digits)
}
