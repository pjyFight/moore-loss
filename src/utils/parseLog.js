const NUMBER = '[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?'
const STEP_KEYS = ['step', 'steps', 'global_step', 'globalStep', 'iteration', 'iter', 'batch']
const LOSS_KEYS = ['loss', 'train_loss', 'training_loss', 'loss_value', 'lm_loss']
const GRAD_KEYS = ['grad_norm', 'gradNorm', 'gradient_norm', 'gradientNorm', 'grad']
const NONFINITE_RE = /^(?:nan|[+-]?inf(?:inity)?)$/i

export const DEFAULT_REGEX_RULES = {
  step: '(?:step|global_step|iteration|iter|batch)\\s*[:=]\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)',
  loss: '(?:loss|train_loss|training_loss|loss_value|lm_loss)\\s*[:=]\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)',
  gradNorm: '(?:grad_norm|gradNorm|gradient_norm|gradientNorm|grad)\\s*[:=]\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)',
}

const toNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

const parseNumericToken = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return { value, invalid: null }
  if (typeof value !== 'string') return { value: null, invalid: null }
  const token = value.replace(/,/g, '').trim()
  if (NONFINITE_RE.test(token)) return { value: null, invalid: token.toLowerCase().includes('nan') ? 'NaN' : 'Inf', raw: token }
  const parsed = Number(token)
  return Number.isFinite(parsed) ? { value: parsed, invalid: null } : { value: null, invalid: null }
}

const pickByKey = (record, keys) => {
  if (!record || typeof record !== 'object') return null
  const entries = Object.entries(record)
  for (const key of keys) {
    const exact = entries.find(([candidate]) => candidate.toLowerCase() === key.toLowerCase())
    if (exact) return toNumber(exact[1])
  }
  const fuzzy = entries.find(([candidate]) => keys.some((key) => candidate.toLowerCase().includes(key.toLowerCase())))
  return fuzzy ? toNumber(fuzzy[1]) : null
}

const parseRecord = (record, fallbackStep) => {
  const step = pickByKey(record, STEP_KEYS) ?? fallbackStep
  const lossEntry = Object.entries(record ?? {}).find(([key]) => LOSS_KEYS.some((candidate) => key.toLowerCase() === candidate.toLowerCase()))
  const gradEntry = Object.entries(record ?? {}).find(([key]) => GRAD_KEYS.some((candidate) => key.toLowerCase() === candidate.toLowerCase()))
  const lossToken = parseNumericToken(lossEntry?.[1])
  const gradToken = parseNumericToken(gradEntry?.[1])
  const anomalies = []
  if (lossToken.invalid) anomalies.push({ metric: 'loss', type: lossToken.invalid, raw: lossToken.raw })
  if (gradToken.invalid) anomalies.push({ metric: 'gradNorm', type: gradToken.invalid, raw: gradToken.raw })
  return { step, loss: lossToken.value ?? pickByKey(record, LOSS_KEYS), gradNorm: gradToken.value ?? pickByKey(record, GRAD_KEYS), ...(anomalies.length ? { anomalies } : {}) }
}

function parseJson(text) {
  const parsed = JSON.parse(text)
  const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.records) ? parsed.records : [parsed]
  return records.map((record, index) => parseRecord(record, index)).filter((point) => point.loss !== null || point.gradNorm !== null || point.anomalies?.length)
}

function parseDelimited(text) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2 || !lines[0].includes(',')) return []
  const headers = lines[0].split(',').map((header) => header.trim().replace(/^['"]|['"]$/g, ''))
  return lines.slice(1).map((line, index) => {
    const values = line.split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
    return parseRecord(Object.fromEntries(headers.map((header, valueIndex) => [header, values[valueIndex]])), index)
  }).filter((point) => point.loss !== null || point.gradNorm !== null || point.anomalies?.length)
}

function parseLine(line, index, regexRules = DEFAULT_REGEX_RULES) {
  const get = (keys) => {
    for (const key of keys) {
      const pattern = new RegExp(`(?:["']?${key}["']?)\\s*(?:=|:|=>)\\s*["']?(${NUMBER})`, 'i')
      const match = line.match(pattern)
      if (match) return toNumber(match[1])
    }
    return null
  }
  const getToken = (keys) => {
    for (const key of keys) {
      const pattern = new RegExp(`(?:["']?${key}["']?)\\s*(?:=|:|=>)\\s*["']?([^\\s,;|]+)`, 'i')
      const match = line.match(pattern)
      if (match) return parseNumericToken(match[1])
    }
    return { value: null, invalid: null }
  }
  const getByRegexToken = (rule) => {
    if (!rule) return null
    const pattern = new RegExp(rule, 'i')
    const match = line.match(pattern)
    if (!match) return null
    return parseNumericToken(match[1] ?? match[0])
  }
  const stepToken = getByRegexToken(regexRules.step)
  const lossRegexToken = getByRegexToken(regexRules.loss)
  const gradRegexToken = getByRegexToken(regexRules.gradNorm)
  const step = stepToken?.value ?? get(STEP_KEYS) ?? index
  const lossToken = getToken(LOSS_KEYS)
  const gradToken = getToken(GRAD_KEYS)
  const loss = lossRegexToken?.invalid ? null : lossRegexToken?.value ?? lossToken.value ?? get(LOSS_KEYS)
  const gradNorm = gradRegexToken?.invalid ? null : gradRegexToken?.value ?? gradToken.value ?? get(GRAD_KEYS)
  const anomalies = []
  if (lossRegexToken?.invalid ?? lossToken.invalid) anomalies.push({ metric: 'loss', type: lossRegexToken?.invalid ?? lossToken.invalid, raw: lossRegexToken?.raw ?? lossToken.raw })
  if (gradRegexToken?.invalid ?? gradToken.invalid) anomalies.push({ metric: 'gradNorm', type: gradRegexToken?.invalid ?? gradToken.invalid, raw: gradRegexToken?.raw ?? gradToken.raw })
  return { step, loss, gradNorm, ...(anomalies.length ? { anomalies } : {}) }
}

export function parseLogText(text, fileName = 'training.log', options = {}) {
  const trimmed = text.trim()
  if (!trimmed) throw new Error(`${fileName} is empty`)

  let points = []
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[')
  if (looksLikeJson) {
    try { points = parseJson(trimmed) } catch { points = [] }
  }
  if (!points.length) points = parseDelimited(trimmed)
  if (!points.length) {
    points = trimmed.split(/\r?\n/).map((line, index) => parseLine(line, index, options.regexRules)).filter((point) => point.loss !== null || point.gradNorm !== null || point.anomalies?.length)
  }

  const clean = points
    .map((point, index) => ({ step: Number.isFinite(point.step) ? point.step : index, loss: point.loss, gradNorm: point.gradNorm, ...(point.anomalies?.length ? { anomalies: point.anomalies } : {}) }))
    .sort((a, b) => a.step - b.step)
  if (!clean.length) {
    throw new Error(`No loss or grad norm values found in ${fileName}`)
  }
  return clean
}

export function samplePoints(points, sampleStep) {
  if (!sampleStep || sampleStep <= 1) return points
  const groups = new Map()
  points.forEach((point) => {
    const bucket = Math.round(point.step / sampleStep) * sampleStep
    const current = groups.get(bucket) ?? { step: bucket, loss: [], gradNorm: [], anomalies: [] }
    if (point.loss !== null) current.loss.push(point.loss)
    if (point.gradNorm !== null) current.gradNorm.push(point.gradNorm)
    if (point.anomalies?.length) current.anomalies.push(...point.anomalies)
    groups.set(bucket, current)
  })
  return [...groups.values()].sort((a, b) => a.step - b.step).map((group) => ({
    step: group.step,
    loss: group.loss.length ? group.loss.reduce((sum, value) => sum + value, 0) / group.loss.length : null,
    gradNorm: group.gradNorm.length ? group.gradNorm.reduce((sum, value) => sum + value, 0) / group.gradNorm.length : null,
    ...(group.anomalies?.length ? { anomalies: group.anomalies } : {}),
  }))
}
