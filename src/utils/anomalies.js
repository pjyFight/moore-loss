const median = (values) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const eventLabel = (type) => ({ NaN: 'NaN', Inf: 'Inf', spike: 'Spike', 'gradient-explosion': 'Gradient explosion' }[type] ?? type)

export function detectAnomalies(runs, options = {}) {
  const { enabled = true, spikeFactor = 2, explosionFactor = 5, madFactor = 6, warmupSteps = 0, window = 20 } = options
  if (!enabled) return []
  const events = []
  for (const run of runs) {
    for (const metric of ['loss', 'gradNorm']) {
      const points = [...run.points].sort((a, b) => a.step - b.step)
      const valid = points.filter((point) => Number.isFinite(point[metric]))
      const invalid = points.flatMap((point) => (point.anomalies ?? []).filter((item) => item.metric === metric).map((item) => ({
        id: `${run.id}-${metric}-${point.step}-${item.type}`,
        runId: run.id, runName: run.name, color: run.color, metric, step: point.step, type: item.type, label: eventLabel(item.type), value: item.raw, raw: item.raw,
      })))
      events.push(...invalid)
      let previous = null
      valid.forEach((point, index) => {
        if (point.step < warmupSteps) return
        const value = point[metric]
        let gradientExplosion = false
        if (metric === 'gradNorm' && index >= 3) {
          const history = valid.slice(Math.max(0, index - window), index).map((item) => item[metric])
          const center = median(history)
          const deviations = history.map((item) => Math.abs(item - center))
          const mad = median(deviations)
          const robustLimit = center + madFactor * Math.max(mad, center * 0.05, 1e-12)
          if (center > 0 && value > robustLimit && value > center * explosionFactor) {
            gradientExplosion = true
            events.push({ id: `${run.id}-${metric}-${point.step}-gradient-explosion`, runId: run.id, runName: run.name, color: run.color, metric, step: point.step, type: 'gradient-explosion', label: eventLabel('gradient-explosion'), value, baseline: center, ratio: value / center })
          }
        }
        if (!gradientExplosion && previous && previous.value > 0 && value > previous.value * spikeFactor) {
          events.push({ id: `${run.id}-${metric}-${point.step}-spike`, runId: run.id, runName: run.name, color: run.color, metric, step: point.step, type: 'spike', label: eventLabel('spike'), value, previousValue: previous.value, ratio: value / previous.value })
        }
        previous = { value, step: point.step }
      })
    }
  }
  return events.sort((a, b) => a.step - b.step || a.runName.localeCompare(b.runName))
}

export function anomalyColor(type) {
  return type === 'NaN' || type === 'Inf' ? '#d14d5c' : type === 'gradient-explosion' ? '#a13bb7' : '#f08a3c'
}
