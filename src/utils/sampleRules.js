/**
 * Helpers for the sample-driven parser editor.
 *
 * A user supplies a short piece of log text and highlights the value that
 * should be extracted from that piece of text.  The literal context is kept
 * in the generated expression while numeric literals are relaxed so the same
 * rule can be used for every training step.
 */

export const SAMPLE_RULE_FIELDS = Object.freeze(['step', 'loss', 'gradNorm'])

/** A finite number, including scientific notation and an optional sign. */
export const NUMBER_SOURCE = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?'

/** A metric token accepted by the parser, including non-finite values. */
export const NUMERIC_TOKEN_SOURCE = `(?:${NUMBER_SOURCE}|NaN|[+-]?Inf(?:inity)?)`

const FIELD_ALIASES = {
  step: 'step',
  loss: 'loss',
  gradNorm: 'gradNorm',
  grad_norm: 'gradNorm',
  gradnorm: 'gradNorm',
}

// A numeric sample must be treated as a complete token.  In particular, the
// dot in `1.46`, the exponent in `1e-3`, and a leading sign in `+1.0` are all
// part of the same token.  The regular expression used to find candidates
// therefore rejects these characters on either side of a token.  Separators
// such as `/`, `:`, `,`, and whitespace remain valid boundaries.
const NUMERIC_TOKEN_START_BOUNDARY = '(?<![A-Za-z0-9_.+\\-])'
const NUMERIC_TOKEN_END_BOUNDARY = '(?![A-Za-z0-9_.+\\-])'

const SAMPLE_TOKEN_RE = new RegExp(
  `${NUMERIC_TOKEN_START_BOUNDARY}${NUMERIC_TOKEN_SOURCE}${NUMERIC_TOKEN_END_BOUNDARY}`,
  'gi',
)

const isNumericSample = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) || Number.isNaN(value)
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  return new RegExp(`^(?:${NUMERIC_TOKEN_SOURCE})$`, 'i').test(normalized)
}

const normalizeField = (field) => FIELD_ALIASES[String(field ?? '').trim()] ?? null

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const isWord = (character) => Boolean(character && /[A-Za-z0-9_]/.test(character))

/**
 * Convert a whitespace run into a tolerant expression.  Spaces between words
 * are required (`Step 1` -> `Step\\s+1`), while spaces around punctuation are
 * optional (`key: 1` -> `key:\\s*1`).
 */
const whitespaceSource = (text, start, end) => {
  let previous = start - 1
  while (previous >= 0 && /\s/.test(text[previous])) previous -= 1
  let next = end
  while (next < text.length && /\s/.test(text[next])) next += 1
  return isWord(text[previous]) && isWord(text[next]) ? '\\s+' : '\\s*'
}

/**
 * Generalise number/non-finite literals in a static fragment.  `offset` and
 * `fullText` are used for token boundaries when a fragment is a suffix.
 */
const generalizeStatic = (fragment, offset, fullText) => {
  // Use the same tokenizer as the value picker. Numbers in field identifiers
  // (`loss_t2v`, `stage2`) are literal syntax, not values to generalize.
  const tokens = findSampleValues(fullText)
    .filter((token) => token.start >= offset && token.end <= offset + fragment.length)
    .map((token) => ({
      start: token.start - offset,
      end: token.end - offset,
      replacement: /^(?:NaN|[+-]?Inf(?:inity)?)$/i.test(token.value) ? NUMERIC_TOKEN_SOURCE : NUMBER_SOURCE,
    }))
  let output = ''
  let cursor = 0
  tokens.forEach((token) => {
    if (token.start < cursor) return
    output += transformWhitespace(fragment.slice(cursor, token.start), offset + cursor, fullText)
    output += `${NUMERIC_TOKEN_START_BOUNDARY}${token.replacement}${NUMERIC_TOKEN_END_BOUNDARY}`
    cursor = token.end
  })
  output += transformWhitespace(fragment.slice(cursor), offset + cursor, fullText)
  return output
}

const transformWhitespace = (fragment, offset, fullText) => {
  let output = ''
  let cursor = 0
  while (cursor < fragment.length) {
    if (!/\s/.test(fragment[cursor])) {
      // Separators in training logs are commonly written with or without a
      // space (`step:1`, `step : 1`, `step = 1`).  Keep the separator itself
      // literal, but make its surrounding whitespace optional.  This is
      // especially useful for `Step 1/100`, where the generated suffix should
      // become `\\s*/\\s*{number}` rather than requiring the exact slash
      // spacing from the example.
      if (/[/:=,]/.test(fragment[cursor])) {
        const previous = fragment[cursor - 1]
        const next = fragment[cursor + 1]
        const before = previous && /\s/.test(previous) ? '' : '\\s*'
        const after = next && /\s/.test(next) ? '' : '\\s*'
        output += `${before}${escapeRegex(fragment[cursor])}${after}`
      } else {
        output += escapeRegex(fragment[cursor])
      }
      cursor += 1
      continue
    }
    let end = cursor + 1
    while (end < fragment.length && /\s/.test(fragment[end])) end += 1
    output += whitespaceSource(fullText, offset + cursor, offset + end)
    cursor = end
  }
  return output
}

/**
 * Find complete numeric/non-finite tokens in a sample fragment.
 *
 * `occurrence` is a zero-based index among tokens with the same textual
 * value.  Keeping it zero-based preserves the value consumed by
 * `buildSampleRule` and the existing occurrence picker in the UI.
 */
export const findSampleValues = (text) => {
  if (typeof text !== 'string' || !text) return []

  const seen = new Map()
  const values = []
  const expression = new RegExp(SAMPLE_TOKEN_RE.source, 'gi')
  let match
  while ((match = expression.exec(text))) {
    const value = match[0]
    const key = value.toLowerCase()
    const occurrence = seen.get(key) ?? 0
    values.push({ value, start: match.index, end: match.index + value.length, occurrence })
    seen.set(key, occurrence + 1)
    if (!match[0].length) expression.lastIndex += 1
  }
  return values
}

const findValueOccurrences = (text, value) => {
  const source = String(value ?? '').trim()
  if (!source || typeof text !== 'string' || !isNumericSample(source)) return []
  const normalized = source.toLowerCase()
  return findSampleValues(text).filter((candidate) => candidate.value.toLowerCase() === normalized)
}

const errorResult = (field, errors, extra = {}) => ({
  field,
  valid: false,
  source: '',
  regex: '',
  captureGroupIndex: null,
  errors,
  errorCodes: errors.map((error) => error.code),
  warnings: [],
  occurrences: [],
  ...extra,
})

const asError = (code, message) => ({ code, message })

/**
 * Build one exact rule from a sample.
 *
 * @param {object} options
 * @param {'step'|'loss'|'gradNorm'} options.field
 * @param {string} options.sampleText the source line/fragment
 * @param {string|number} options.sampleValue the value highlighted by user
 * @param {number} [options.occurrence=0] which occurrence to use when a value
 *   appears more than once
 * @returns {{valid:boolean, source:string, regex:string, errors:object[], warnings:string[]}}
 */
export function buildSampleRule({ field, sampleText, sampleValue, occurrence = 0 } = {}) {
  const canonicalField = normalizeField(field)
  if (!canonicalField) return errorResult(String(field ?? ''), [asError('invalid-field', 'Field must be step, loss, or gradNorm')])

  if (typeof sampleText !== 'string' || !sampleText.trim()) {
    return errorResult(canonicalField, [asError('missing-sample-text', 'A sample text is required')])
  }

  if (sampleValue === undefined || sampleValue === null || String(sampleValue).trim() === '') {
    return errorResult(canonicalField, [asError('missing-sample-value', 'A sample value is required')])
  }

  const valueText = String(sampleValue).trim()
  if (!isNumericSample(valueText)) {
    return errorResult(canonicalField, [asError('invalid-sample-value', 'Select a complete number, NaN, or Inf value')], { sampleText, sampleValue: valueText })
  }
  const occurrences = findValueOccurrences(sampleText, valueText)
  if (!occurrences.length) {
    return errorResult(canonicalField, [asError('value-not-found', `Sample value “${valueText}” was not found in the sample text`)], { sampleText, sampleValue: valueText })
  }

  const safeOccurrence = Number.isInteger(occurrence) && occurrence >= 0 ? occurrence : 0
  const selected = occurrences[safeOccurrence]
  if (!selected) {
    return errorResult(canonicalField, [asError('occurrence-out-of-range', `Occurrence ${safeOccurrence + 1} is not available`)], { sampleText, sampleValue: valueText, occurrences })
  }

  const prefix = generalizeStatic(sampleText.slice(0, selected.start), 0, sampleText)
  const suffix = generalizeStatic(sampleText.slice(selected.end), selected.end, sampleText)
  // Keep an unquoted field name from matching the same text inside a larger
  // identifier (for example `grad_norm` must not match `max_grad_norm`).
  // This lookbehind is non-capturing and therefore does not affect the
  // single-value capture contract of generated rules.
  const source = `${NUMERIC_TOKEN_START_BOUNDARY}${prefix}(${NUMERIC_TOKEN_SOURCE})${NUMERIC_TOKEN_END_BOUNDARY}${suffix}`
  const warnings = []
  if (occurrences.length > 1) {
    warnings.push(`Sample value appears ${occurrences.length} times; occurrence ${safeOccurrence + 1} was selected. Choose another occurrence if needed.`)
  }

  try {
    // Compile once here so the UI can report a useful error before applying it.
    // The generated source deliberately contains exactly one capturing group.
    const expression = new RegExp(source, 'i')
    return {
      field: canonicalField,
      valid: true,
      source,
      regex: source,
      expression,
      captureGroupIndex: 1,
      sampleText,
      sampleValue: valueText,
      valueType: isNumericSample(valueText) ? 'numeric' : 'text',
      occurrences,
      selectedOccurrence: safeOccurrence,
      warnings,
      errors: [],
      errorCodes: [],
    }
  } catch (error) {
    return errorResult(canonicalField, [asError('invalid-generated-regex', error instanceof Error ? error.message : 'Generated rule is invalid')], { sampleText, sampleValue: valueText, occurrences })
  }
}

// Friendly aliases for callers that prefer “generate”/“create” terminology.
export const generateSampleRule = buildSampleRule
export const createSampleRule = buildSampleRule

/**
 * Build all three field rules.  Step is required by default; loss and
 * gradNorm may be omitted so a user can configure only one metric.
 */
export function buildSampleRules(samples = {}, { requireStep = true, requireMetric = false } = {}) {
  const results = {}
  const rules = {}
  const errors = []
  const warnings = []
  const normalizedSamples = samples && typeof samples === 'object' ? samples : {}

  SAMPLE_RULE_FIELDS.forEach((field) => {
    const input = normalizedSamples[field] ?? (field === 'gradNorm' ? normalizedSamples.grad_norm : undefined)
    const hasObjectInput = input && typeof input === 'object'
    const sampleText = hasObjectInput ? input.sampleText ?? input.text : undefined
    const sampleValue = hasObjectInput ? input.sampleValue ?? input.value : undefined
    const hasInput = hasObjectInput && (
      (typeof sampleText === 'string' && sampleText.trim().length > 0)
      || (sampleText !== undefined && sampleText !== null && typeof sampleText !== 'string' && String(sampleText).trim().length > 0)
      || (sampleValue !== undefined && sampleValue !== null && String(sampleValue).trim().length > 0)
    )
    if (!hasInput) {
      // Metric samples are optional individually. `requireMetric` is an
      // aggregate requirement handled below, so an empty loss sample must not
      // fail validation when a grad norm sample is present (and vice versa).
      if (field === 'step' && requireStep) {
        const result = errorResult(field, [asError('missing-sample', `${field} sample is required`)], { skipped: false })
        results[field] = result
        errors.push(...result.errors.map((error) => ({ field, ...error })))
      } else {
        results[field] = { field, valid: true, skipped: true, source: '', regex: '', captureGroupIndex: null, errors: [], errorCodes: [], warnings: [], occurrences: [] }
      }
      return
    }

    const result = buildSampleRule({
      field,
      sampleText,
      sampleValue,
      occurrence: input.occurrence ?? 0,
    })
    results[field] = result
    if (result.valid && result.source) rules[field] = result.source
    errors.push(...result.errors.map((error) => ({ field, ...error })))
    warnings.push(...result.warnings.map((message) => ({ field, message })))
  })

  if (requireMetric && !rules.loss && !rules.gradNorm) {
    errors.push({ code: 'missing-metric', message: 'At least one metric sample (loss or gradNorm) is required' })
  }

  return { valid: errors.length === 0, rules, results, errors, warnings }
}

export const generateSampleRules = buildSampleRules
