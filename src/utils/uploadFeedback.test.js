import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_REGEX_RULES, parseLogText } from './parseLog.js'
import { buildSampleRules } from './sampleRules.js'
import { buildUploadFeedback } from './uploadFeedback.js'

const needsRulesText = '请补充匹配规则'
const sampleText = [
  "Step 1/100: {'Loss/train_loss': 2.6480863, 'grad_norm': 1.4609375}",
  "Step 2/100: {'Loss/train_loss': 2.408921, 'grad_norm': 1.1796875}",
].join('\n')

const pendingRun = {
  id: 'sample',
  name: 'sample.log',
  rawText: sampleText,
  points: [],
  parseError: 'needs-rule',
}

function generateSampleRules() {
  return buildSampleRules({
    step: { sampleText: 'Step 1/100', sampleValue: '1' },
    loss: { sampleText: "'Loss/train_loss': 2.6480863", sampleValue: '2.6480863' },
    gradNorm: { sampleText: "'grad_norm': 1.4609375", sampleValue: '1.4609375' },
  }, { requireMetric: true })
}

test('an uploaded file that does not match the active rules shows a needs-rules message', () => {
  assert.throws(() => parseLogText(pendingRun.rawText, pendingRun.name, {
    mode: 'exact',
    regexRules: DEFAULT_REGEX_RULES,
  }), /No loss or grad norm values found/)

  assert.equal(buildUploadFeedback([pendingRun], '', needsRulesText), 'sample.log: 请补充匹配规则')
})

test('successfully applying generated example rules clears the previous file warning', () => {
  const generated = generateSampleRules()
  assert.equal(generated.valid, true)
  const points = parseLogText(pendingRun.rawText, pendingRun.name, {
    mode: 'exact',
    regexRules: generated.rules,
  })
  assert.deepEqual(points, [
    { step: 1, loss: 2.6480863, gradNorm: 1.4609375 },
    { step: 2, loss: 2.408921, gradNorm: 1.1796875 },
  ])

  const appliedRun = { ...pendingRun, points, parseError: null }
  assert.equal(buildUploadFeedback([appliedRun], '', needsRulesText), '')
})

test('mixed successful and unsuccessful files only report the files still awaiting rules', () => {
  const runs = [
    { name: 'baseline.log', parseError: '' },
    { name: 'unmatched-a.log', parseError: 'needs-rule' },
    { name: 'comparison.log', parseError: null },
    { name: 'unmatched-b.log', parseError: 'needs-rule' },
  ]

  assert.equal(buildUploadFeedback(runs, '', needsRulesText), [
    'unmatched-a.log: 请补充匹配规则',
    'unmatched-b.log: 请补充匹配规则',
  ].join('\n'))
})

test('file-read failures remain visible after parsing succeeds and precede pending-file messages', () => {
  const readError = 'unreadable.log: 文件读取失败'
  assert.equal(buildUploadFeedback([{ name: 'success.log', parseError: '' }], readError, needsRulesText), readError)
  assert.equal(buildUploadFeedback([pendingRun], readError, needsRulesText), `${readError}\nsample.log: 请补充匹配规则`)
})

test('generating a valid draft without applying it does not clear the current file warning', () => {
  const runs = Object.freeze([Object.freeze({ ...pendingRun, points: Object.freeze([]) })])
  const before = buildUploadFeedback(runs, '', needsRulesText)
  const generatedDraft = generateSampleRules()
  assert.equal(generatedDraft.valid, true)

  assert.equal(buildUploadFeedback(runs, '', needsRulesText), before)
  assert.equal(runs[0].parseError, 'needs-rule')
  assert.deepEqual(runs[0].points, [])
})

test('removing a file awaiting rules clears its warning without changing the original runs', () => {
  const successfulRun = Object.freeze({ name: 'success.log', parseError: '' })
  const runs = Object.freeze([Object.freeze({ ...pendingRun }), successfulRun])
  assert.equal(buildUploadFeedback(runs, '', needsRulesText), 'sample.log: 请补充匹配规则')

  const remainingRuns = runs.filter((run) => !run.parseError)
  assert.equal(buildUploadFeedback(remainingRuns, '', needsRulesText), '')
  assert.equal(runs.length, 2)
  assert.equal(runs[0].parseError, 'needs-rule')
})

test('needs-rules feedback follows the currently selected language', () => {
  assert.equal(buildUploadFeedback([pendingRun], '', '请补充匹配规则'), 'sample.log: 请补充匹配规则')
  assert.equal(buildUploadFeedback([pendingRun], '', 'Matching rules required'), 'sample.log: Matching rules required')
})

test('empty run lists and omitted arguments produce no feedback unless a read error remains', () => {
  assert.equal(buildUploadFeedback(), '')
  assert.equal(buildUploadFeedback([], '', needsRulesText), '')
  assert.equal(buildUploadFeedback([], 'File could not be read', needsRulesText), 'File could not be read')
})
