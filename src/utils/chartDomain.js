/**
 * Calculate the vertical domain used by a line chart.
 *
 * `values` and `threshold` are expected to use the same display units (for
 * example, both are already scaled to percentages when a relative chart is
 * rendered). Difference charts retain 8% breathing room around their data.
 *
 * Raw loss and grad-norm charts use a zero baseline and a deliberately wide
 * vertical scale. Their upper bound is about 1.5 times the largest value and
 * aligned to a readable tick, so ordinary tenth- or thousandth-scale movement
 * stays visually smooth instead of filling the plot like a spike.
 */
export function getYDomain(values, { zeroBaseline = false, signed = false, threshold = null } = {}) {
  const finiteValues = Array.isArray(values)
    ? values.filter((value) => Number.isFinite(value))
    : []

  // Keep the renderer's empty-series fallback: an empty chart still has a
  // useful, finite display range instead of producing NaN coordinates.
  const minValue = finiteValues.length ? Math.min(...finiteValues) : 0
  const maxValue = finiteValues.length ? Math.max(...finiteValues) : 1
  const thresholdValue = Number.isFinite(threshold) ? threshold : null
  const plotMin = thresholdValue === null
    ? minValue
    : Math.min(minValue, signed ? -thresholdValue : thresholdValue)
  const plotMax = thresholdValue === null
    ? maxValue
    : Math.max(maxValue, thresholdValue)

  if (zeroBaseline) {
    const peak = Math.max(maxValue, 0)
    const magnitude = Math.max(peak, 1e-12)
    const exponent = Math.floor(Math.log10(magnitude))
    const tick = 10 ** (exponent - (magnitude / (10 ** exponent) < 2 ? 1 : 0))
    const paddedMax = peak * 1.5
    const steps = Math.max(1, Math.ceil((paddedMax / tick) - 1e-9))
    const yMax = Number((steps * tick).toPrecision(12))
    return [0, Number.isFinite(yMax) && yMax > 0 ? yMax : 1]
  }

  const plotRange = plotMax - plotMin || Math.max(Math.abs(plotMax), 1)
  const yMin = signed
    ? plotMin - plotRange * 0.08
    : Math.max(0, plotMin - plotRange * 0.08)
  const yMax = plotMax + plotRange * 0.08

  return [yMin, Number.isFinite(yMax) ? yMax : 1]
}

/**
 * Choose evenly spaced integer training-step ticks.
 *
 * Aim for eleven ticks (0, 10, ... 100 on a 100-step chart). The first and
 * last visible integer steps stay anchored, while intermediate ticks use a
 * readable integer stride. Nearby internal ticks are omitted at the ends.
 * Optional `plotWidth` uses the same SVG units as the existing 18px labels,
 * so long step numbers or narrow plots can reduce density without shrinking
 * fonts or changing the positions represented by the gridlines.
 */
export function getIntegerStepTicks(minStep, maxStep, desiredCount = 11, plotWidth = null) {
  if (!Number.isFinite(minStep) || !Number.isFinite(maxStep) || maxStep < minStep) return []
  const start = Math.ceil(minStep)
  const end = Math.floor(maxStep)
  if (end < start) return []
  if (start === end) return [start]

  const requestedCount = Number.isFinite(desiredCount) && desiredCount >= 2
    ? Math.min(50, Math.floor(desiredCount))
    : 11
  const hasPlotWidth = Number.isFinite(plotWidth) && plotWidth > 0
  const labelWidth = Math.max(start.toLocaleString().length, end.toLocaleString().length) * 18 * 0.6
  const tickCount = hasPlotWidth
    ? Math.min(requestedCount, Math.max(2, Math.floor(plotWidth / (labelWidth + 18)) + 1))
    : requestedCount
  const roughStride = Math.max(1, (end - start) / (tickCount - 1))
  const magnitude = 10 ** Math.floor(Math.log10(roughStride))
  const normalized = roughStride / magnitude
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  const stride = Math.max(1, niceNormalized * magnitude)
  // The first/last labels point inwards; reserve a full endpoint label plus
  // half its neighbour's width, as well as the gap used for ordinary ticks.
  const endpointSpacing = Math.max(stride / 2, hasPlotWidth ? ((end - start) * (labelWidth * 1.5 + 18)) / plotWidth : 0)
  const ticks = []
  const firstStep = Math.ceil(start / stride) * stride

  // Bound the work even when a malformed log contains step values too large
  // for adding one to advance the floating-point representation.
  for (let index = 0; index < 50; index += 1) {
    const step = firstStep + index * stride
    if (!Number.isFinite(step) || step > end) break
    if (step > start && step < end && step - start >= endpointSpacing && end - step >= endpointSpacing && (!ticks.length || step > ticks.at(-1))) {
      ticks.push(step)
    }
  }

  return [start, ...ticks, end]
}

export default getYDomain
