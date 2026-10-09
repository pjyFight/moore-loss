/** Build upload feedback from the current file state, rather than past errors. */
export function buildUploadFeedback(runs = [], readError = '', needsRulesText = '') {
  return [
    readError,
    ...runs.filter((run) => run.parseError).map((run) => `${run.name}: ${needsRulesText}`),
  ].filter(Boolean).join('\n')
}
