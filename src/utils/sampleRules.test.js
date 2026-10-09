import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NUMBER_SOURCE,
  NUMERIC_TOKEN_SOURCE,
  buildSampleRule,
  buildSampleRules,
  findSampleValues,
} from './sampleRules.js'
import { parseLogText, validateRegexRule } from './parseLog.js'

test('builds a reusable Step rule from Step 1/100 and generalises both numbers', () => {
  const result = buildSampleRule({ field: 'step', sampleText: 'Step 1/100', sampleValue: '1' })

  assert.equal(result.valid, true)
  assert.equal(result.captureGroupIndex, 1)
  assert.ok(result.source.includes(`Step\\s+(${NUMERIC_TOKEN_SOURCE})`))
  assert.match(result.source, /\\s\*\/\\s\*/)
  assert.ok(result.source.includes(NUMBER_SOURCE))

  const match = new RegExp(result.source, 'i').exec('Step 12 / 200')
  assert.equal(match?.[1], '12')
  assert.equal(new RegExp(result.source, 'i').exec('Step 12/200')?.[1], '12')
})

test('keeps quoted key context and tolerates whitespace around a grad_norm value', () => {
  const result = buildSampleRule({
    field: 'gradNorm',
    sampleText: "'grad_norm': 1.4609375",
    sampleValue: '1.4609375',
  })

  assert.equal(result.valid, true)
  assert.match(result.source, /'grad_norm'/)
  assert.match(result.source, /\\s\*:\\s\*/)
  const expression = new RegExp(result.source, 'i')
  assert.equal(expression.exec("'grad_norm':1.25")?.[1], '1.25')
  assert.equal(expression.exec("'grad_norm' :   NaN")?.[1], 'NaN')
  assert.equal(result.valueType, 'numeric')
})

test('generated target capture accepts NaN and Inf while other numeric literals are relaxed', () => {
  const result = buildSampleRule({ field: 'loss', sampleText: 'loss=1.0 (window 100)', sampleValue: '1.0' })

  assert.equal(result.valid, true)
  assert.equal(new RegExp(result.source, 'i').exec('loss=NaN (window 500)')?.[1], 'NaN')
  assert.equal(new RegExp(result.source, 'i').exec('loss=-Inf (window 32)')?.[1], '-Inf')
  assert.ok(result.source.includes(NUMBER_SOURCE))
  assert.ok(result.source.includes(NUMERIC_TOKEN_SOURCE))
})

test('reports missing samples, missing values, and values that do not occur', () => {
  assert.equal(buildSampleRule({ field: 'step', sampleText: '', sampleValue: '1' }).errorCodes[0], 'missing-sample-text')
  assert.equal(buildSampleRule({ field: 'step', sampleText: 'Step 1/2' }).errorCodes[0], 'missing-sample-value')
  assert.equal(buildSampleRule({ field: 'step', sampleText: 'Step 1/2', sampleValue: '3' }).errorCodes[0], 'value-not-found')
})

test('warns about multiple occurrences and permits selecting a later occurrence', () => {
  const first = buildSampleRule({ field: 'step', sampleText: 'Step 1/1', sampleValue: '1' })
  assert.equal(first.valid, true)
  assert.equal(first.occurrences.length, 2)
  assert.equal(first.selectedOccurrence, 0)
  assert.equal(first.warnings.length, 1)

  const second = buildSampleRule({ field: 'step', sampleText: 'Step 1/1', sampleValue: '1', occurrence: 1 })
  assert.equal(second.valid, true)
  assert.equal(second.selectedOccurrence, 1)
  assert.equal(first.expression.exec('Step 17/200')?.[1], '17')
  assert.equal(second.expression.exec('Step 17/200')?.[1], '200')
})

test('buildSampleRules supports all fields while allowing optional metric samples to be omitted', () => {
  const result = buildSampleRules({
    step: { sampleText: 'Step 1/100', sampleValue: '1' },
    grad_norm: { text: "'grad_norm': 1.46", value: '1.46' },
  })

  assert.equal(result.valid, true)
  assert.ok(result.rules.step)
  assert.ok(result.rules.gradNorm)
  assert.equal(result.results.loss.skipped, true)
  assert.equal(result.errors.length, 0)
})

test('buildSampleRules can require a metric sample when a form needs one', () => {
  const result = buildSampleRules({ step: { sampleText: 'Step 1/2', sampleValue: '1' } }, { requireMetric: true })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.code === 'missing-metric'))
})

test('empty metric forms are optional and requireMetric means at least one metric', () => {
  for (const metric of ['loss', 'gradNorm']) {
    const samples = {
      step: { sampleText: 'Step 1/100', sampleValue: '1' },
      loss: { sampleText: '', sampleValue: '' },
      gradNorm: { sampleText: '  ', sampleValue: '  ' },
    }
    samples[metric] = { sampleText: `${metric}=1.46`, sampleValue: '1.46' }
    const result = buildSampleRules(samples, { requireMetric: true })
    assert.equal(result.valid, true)
    assert.ok(result.rules[metric])
    assert.equal(result.results[metric === 'loss' ? 'gradNorm' : 'loss'].skipped, true)
  }

  const result = buildSampleRules({
    step: { sampleText: 'Step 1/100', sampleValue: '1' },
    loss: { sampleText: '', sampleValue: '' },
    gradNorm: { sampleText: '', sampleValue: '' },
  }, { requireMetric: true })
  assert.equal(result.valid, false)
  assert.deepEqual(result.errors.map(({ code }) => code), ['missing-metric'])
})

test('partially filled optional metric forms are not silently discarded', () => {
  const result = buildSampleRules({
    step: { sampleText: 'Step 1/100', sampleValue: '1' },
    loss: { sampleText: 'loss=1.0', sampleValue: '' },
    gradNorm: { sampleText: 'grad_norm=2', sampleValue: '2' },
  }, { requireMetric: true })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(({ field, code }) => field === 'loss' && code === 'missing-sample-value'))
})

test('value candidates contain complete tokens with per-value zero-based occurrence indices', () => {
  const text = 'Step 1/1 loss_t2v=+1.25e-3 norm=-.4 invalid=12abc NaN nan +Inf -Infinity'
  const values = findSampleValues(text)
  assert.deepEqual(values.map(({ value, occurrence }) => [value, occurrence]), [
    ['1', 0], ['1', 1], ['+1.25e-3', 0], ['-.4', 0], ['NaN', 0], ['nan', 1], ['+Inf', 0], ['-Infinity', 0],
  ])
  values.forEach(({ value, start, end }) => assert.equal(text.slice(start, end), value))
  assert.deepEqual(findSampleValues(null), [])
  assert.deepEqual(findSampleValues(''), [])
})

test('rejects partial values and non-numeric sample values', () => {
  for (const [sampleText, sampleValue] of [
    ['loss=1.46', '1'],
    ['loss=1.46', '46'],
    ['loss=+1.0', '1.0'],
    ['loss=-1.0', '1.0'],
    ['loss=1.2e-3', '1.2'],
    ['loss=1.2e-3', '3'],
    ['loss=12abc', '12'],
    ['loss=Infinity', 'Inf'],
    ['loss_t2v=1.0', '2'],
  ]) {
    const result = buildSampleRule({ field: 'loss', sampleText, sampleValue })
    assert.equal(result.valid, false, `${sampleValue} must not be selected within ${sampleText}`)
    assert.equal(result.errorCodes[0], 'value-not-found')
  }
  const invalid = buildSampleRule({ field: 'loss', sampleText: 'loss=1.46', sampleValue: 'loss' })
  assert.equal(invalid.valid, false)
  assert.equal(invalid.errorCodes[0], 'invalid-sample-value')
})

test('generated regex keeps exact key boundaries and never truncates numeric values', () => {
  const result = buildSampleRule({ field: 'gradNorm', sampleText: 'grad_norm: 1.46', sampleValue: '1.46' })
  for (const line of ['max_grad_norm: 1', 'mygrad_norm: 1', 'grad_norm: 12abc', 'grad_norm: 1.2junk', 'grad_norm: 1.2e']) {
    assert.equal(result.expression.exec(line), null, line)
  }
  for (const value of ['1.2', '+1.0', '-.5', '1.2e-12', 'NaN', '+Inf', '-Infinity']) {
    assert.equal(result.expression.exec(`grad_norm: ${value}`)?.[1], value)
  }
})

test('literal digits inside field names are retained while values are generalized', () => {
  const result = buildSampleRule({ field: 'loss', sampleText: 'loss_t2v=1.5', sampleValue: '1.5' })
  assert.equal(result.expression.exec('loss_t2v=2.5')?.[1], '2.5')
  assert.equal(result.expression.exec('loss_t3v=2.5'), null)
  assert.equal(result.expression.exec('prefix_loss_t2v=2.5'), null)
})

test('all generated rules contain exactly one capture group including signs and science notation', () => {
  const examples = [
    ['Step 1/1', '1', 0],
    ['Step 1/1', '1', 1],
    ['loss_t2v=+1.2e-3', '+1.2e-3', 0],
    ['loss[-1]=-.4 (window 100)', '-.4', 0],
    ["'grad_norm': -Infinity", '-Infinity', 0],
  ]
  for (const [sampleText, sampleValue, occurrence] of examples) {
    const result = buildSampleRule({ field: 'loss', sampleText, sampleValue, occurrence })
    assert.equal(result.valid, true, sampleText)
    assert.equal(validateRegexRule(result.source).captureGroups, 1)
    assert.equal(result.expression.exec(sampleText)?.[1], sampleValue)
  }
})

test('generated sample rules parse log records and exclude max_grad_norm configuration', () => {
  const generated = buildSampleRules({
    step: { sampleText: 'Step 1/100', sampleValue: '1' },
    loss: { sampleText: "'Loss/train_loss': 2.6480863", sampleValue: '2.6480863' },
    gradNorm: { sampleText: "'grad_norm': 1.4609375", sampleValue: '1.4609375' },
  }, { requireMetric: true })
  assert.equal(generated.valid, true)
  const text = [
    '"max_grad_norm": 1.0',
    "Step 1/100: {'grad_norm': 1.4609375, 'Loss/train_loss': 2.6480863}",
    "Step 2/100: {'grad_norm': 1.1796875, 'Loss/train_loss': 2.408921}",
    "Step 3/100: {'grad_norm': NaN, 'Loss/train_loss': 2.1e-3}",
  ].join('\n')
  const points = parseLogText(text, 'sample.log', { mode: 'exact', regexRules: generated.rules })
  assert.deepEqual(points.map(({ step }) => step), [1, 2, 3])
  assert.equal(points[0].gradNorm, 1.4609375)
  assert.equal(points[1].loss, 2.408921)
  assert.equal(points[2].loss, 0.0021)
  assert.equal(points[2].anomalies[0].type, 'NaN')
})
