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

export function validateRegexRules(rules = {}, { requireStep = true } = {}) {
  const errors = []
  const validate = (field, required = false) => {
    const source = typeof rules[field] === 'string' ? rules[field].trim() : ''
    if (!source) return required ? `${field} regex is required` : null
    const result = validateRegexRule(source)
    return result.valid ? null : `${field} regex is invalid: ${result.error}`
  }
  const stepError = validate('step', requireStep)
  if (stepError) errors.push(stepError)
  const lossError = validate('loss')
  if (lossError) errors.push(lossError)
  const gradError = validate('gradNorm')
  if (gradError) errors.push(gradError)
  if (!(String(rules.loss ?? '').trim() || String(rules.gradNorm ?? '').trim())) errors.push('At least one metric regex (Loss or Grad norm) is required')
  return errors
}

/**
 * Count the capturing groups in a regular-expression source string.
 *
 * JavaScript's RegExp API does not expose the number of capture groups without
 * executing the expression, so we scan the source while accounting for
 * escaped characters and character classes.  Non-capturing groups and the
 * lookaround forms are deliberately excluded; named groups are captures.
 */
const countCapturingGroups = (source) => {
  let count = 0
  let escaped = false
  let inCharacterClass = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '[' && !inCharacterClass) {
      inCharacterClass = true
      continue
    }
    if (character === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }
    if (character !== '(' || inCharacterClass) continue

    if (source[index + 1] !== '?') {
      count += 1
      continue
    }

    // (?<name>...) is a named capture. (?<=...) and (?<!...) are lookbehind
    // assertions and therefore are not captures.
    if (source[index + 2] === '<' && !['=', '!'].includes(source[index + 3])) count += 1
  }

  return count
}

/**
 * Validate an exact-mode regex rule.
 *
 * Exact rules intentionally require one (and only one) capturing group. The
 * first capture is the value extracted from a matching line; non-capturing
 * groups such as (?:...) are safe to use for the surrounding syntax.
 */
export function validateRegexRule(rule) {
  if (rule instanceof RegExp) rule = rule.source
  if (typeof rule !== 'string' || !rule.trim()) {
    return { valid: false, captureGroups: 0, error: 'Rule is empty' }
  }

  let expression
  try {
    expression = new RegExp(rule, 'i')
  } catch (error) {
    return { valid: false, captureGroups: 0, error: error instanceof Error ? error.message : 'Invalid regular expression' }
  }

  const captureGroups = countCapturingGroups(rule)
  if (captureGroups !== 1) {
    return {
      valid: false,
      captureGroups,
      error: `Rule must contain exactly one capturing group; found ${captureGroups}`,
    }
  }

  return { valid: true, captureGroups, error: null, expression }
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
  if (!token) return { value: null, invalid: null }
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

/**
 * Parse one line in exact mode. Unlike automatic parsing this function never
 * falls back to key matching or a line-number step. A point is emitted only
 * when its step and at least one metric match the supplied rules.
 */
function parseLineExact(line, regexRules = DEFAULT_REGEX_RULES, compiledRules = null) {
  const rules = compiledRules ?? Object.fromEntries(['step', 'loss', 'gradNorm'].map((field) => {
    const rule = regexRules?.[field]
    const validation = validateRegexRule(rule)
    return [field, validation.valid ? validation.expression : null]
  }))

  const extract = (field) => {
    const expression = rules[field]
    if (!expression) return null
    const match = line.match(expression)
    if (!match || match[1] === undefined) return null
    return parseNumericToken(match[1])
  }

  const stepToken = extract('step')
  // A non-finite/invalid step cannot identify a training point. It is treated
  // as missing and the line is skipped, just like a line without a step.
  if (!stepToken || stepToken.value === null) return null

  const lossToken = extract('loss')
  const gradToken = extract('gradNorm')
  const hasLoss = Boolean(lossToken && (lossToken.value !== null || lossToken.invalid))
  const hasGrad = Boolean(gradToken && (gradToken.value !== null || gradToken.invalid))
  if (!hasLoss && !hasGrad) return null

  const anomalies = []
  if (lossToken?.invalid) anomalies.push({ metric: 'loss', type: lossToken.invalid, raw: lossToken.raw })
  if (gradToken?.invalid) anomalies.push({ metric: 'gradNorm', type: gradToken.invalid, raw: gradToken.raw })

  return {
    step: stepToken.value,
    loss: lossToken?.value ?? null,
    gradNorm: gradToken?.value ?? null,
    ...(anomalies.length ? { anomalies } : {}),
  }
}

/**
 * Return lightweight, UI-friendly feedback for a draft exact rule set.
 * Previewing never throws for malformed input; errors are returned so the
 * editor can keep the last applied chart intact while the user is typing.
 */
export function previewLogText(text, regexRules = DEFAULT_REGEX_RULES, sampleLimit = 4) {
  const source = typeof text === 'string' ? text : ''
  const lines = source.split(/\r?\n/).filter((line) => line.trim())
  const fields = ['step', 'loss', 'gradNorm']
  const errors = validateRegexRules(regexRules)
  const compiledRules = {}
  for (const field of fields) {
    const rule = regexRules?.[field]
    if (!String(rule ?? '').trim()) {
      compiledRules[field] = null
      continue
    }
    const validation = validateRegexRule(rule)
    compiledRules[field] = validation.valid ? validation.expression : null
  }
  const fieldMatches = { step: 0, loss: 0, gradNorm: 0 }
  const rows = []
  if (!errors.length) {
    lines.forEach((line) => {
      for (const field of fields) {
        const expression = compiledRules[field]
        const token = expression ? parseNumericToken(line.match(expression)?.[1]) : null
        if (token && (Number.isFinite(token.value) || token.invalid)) fieldMatches[field] += 1
      }
      const stepToken = parseNumericToken(line.match(compiledRules.step)?.[1])
      if (!Number.isFinite(stepToken.value)) return
      const point = parseLineExact(line, regexRules, compiledRules)
      if (!point) return
      rows.push({ source: line, point })
    })
  }
  const points = rows.map((row) => row.point)
  const steps = points.map((point) => point.step)
  const duplicateSteps = steps.length - new Set(steps).size
  let minStep = Infinity
  let maxStep = -Infinity
  for (const step of steps) {
    minStep = Math.min(minStep, step)
    maxStep = Math.max(maxStep, step)
  }
  return {
    lineCount: lines.length,
    matchedRows: points.length,
    fieldMatches,
    stepRange: steps.length ? [minStep, maxStep] : null,
    duplicateSteps,
    samples: points.slice(0, sampleLimit).map((point) => ({ ...point })),
    sampleRows: rows.slice(0, sampleLimit),
    errors,
  }
}

export function parseLogText(text, fileName = 'training.log', options = {}) {
  const trimmed = text.trim()
  if (!trimmed) throw new Error(`${fileName} is empty`)

  const exactMode = options.mode === 'exact' || options.strict === true
  let points = []

  if (exactMode) {
    const regexRules = options.regexRules ?? DEFAULT_REGEX_RULES
    const validationErrors = validateRegexRules(regexRules)
    if (validationErrors.length) throw new Error(validationErrors[0])
    const validations = ['step', 'loss', 'gradNorm']
      .map((field) => [field, validateRegexRule(regexRules[field])])
    const compiledRules = Object.fromEntries(validations.map(([field, validation]) => [field, validation.valid ? validation.expression : null]))
    points = trimmed.split(/\r?\n/)
      .map((line) => parseLineExact(line, regexRules, compiledRules))
      .filter(Boolean)
  } else {
    const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[')
    if (looksLikeJson) {
      try { points = parseJson(trimmed) } catch { points = [] }
    }
    if (!points.length) points = parseDelimited(trimmed)
    if (!points.length) {
      points = trimmed.split(/\r?\n/).map((line, index) => parseLine(line, index, options.regexRules)).filter((point) => point.loss !== null || point.gradNorm !== null || point.anomalies?.length)
    }
  }

  const clean = points
    .map((point, index) => ({ step: Number.isFinite(point.step) ? point.step : (exactMode ? null : index), loss: point.loss, gradNorm: point.gradNorm, ...(point.anomalies?.length ? { anomalies: point.anomalies } : {}) }))
    .filter((point) => !exactMode || Number.isFinite(point.step))
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
