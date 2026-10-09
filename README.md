# Moore Loss

Browser-only training trace comparison for loss and gradient norm signals. Upload up to four logs, choose a metric, bucket the points by sampling step, and compare a selected baseline against every other uploaded run with four TrainingLogParser-style views. The default is Comparison absolute.

The page starts empty: no logs, demonstration curves, or sample metrics are preloaded. Upload local files (together or one at a time) to begin. Sampling step defaults to **1**, preserving the original logged points without bucket averaging. The four comparison modes are shown as a vertical radio list with their formulas. Choose the baseline from the uploaded-file list; it is used as `A` for every pairwise comparison.

For each pair (`A` = selected baseline, `B` = one other uploaded file), the comparison modes are ordered as:

- `Comparison absolute`: `|A − B|`
- `Comparison relative absolute`: `|(A − B) / A|`
- `Comparison normal`: `A − B`
- `Comparison relative normal`: `(A − B) / A`

With one uploaded file, the first chart immediately shows that file's raw loss or grad norm trace and comparison charts are hidden. With multiple files, the first chart overlays every raw trace and one difference chart is rendered for each non-baseline file. Each pair uses only its own shared valid steps, so unrelated measurements are not compared. Relative modes include a 2% reference line. `Min Error` follows TrainingLogParser's minimum error value (signed for normal modes). Charts support hover crosshairs and values; zoom is controlled only by the `＋` / `−` buttons, with `Reset` available to restore the full range. Mouse-wheel and double-click zoom controls are intentionally disabled.

The raw loss/grad-norm overview always uses a zero-origin Y axis with a readable, widened scale. Difference charts keep their signed or threshold-aware adaptive domain. X-axis ticks stay on integer training steps and aim for about eleven labels (for example, `0, 10, ... 100`), with spacing adjusted to avoid crowded endpoints and long step labels.

The parser rules panel has two modes: **By example** (the default) and **Regex**. Sample mode lets users paste examples such as `Step 1/100` and select `1`, or `'grad_norm': 1.4609375` and select `1.4609375`; the tool generates a reusable rule automatically. Regex mode remains available for power users. Both modes require an explicit Step plus at least one matched metric and never use line-number or fuzzy-key fallback, so unrelated configuration values cannot become training points. Draft rules can be tested in the live preview and only change charts after clicking **Apply rules**. Expanded generated rules wrap within their cards; very long rules scroll locally without widening the sidebar.

For logs shaped like `Step 1/100: {'grad_norm': 1.46, 'Loss/train_loss': 2.64}`, the **Load example inputs** preset fills the sample fields. The generated rules are equivalent to:

```text
Step:      Step\s+(\d+)\s*/\s*\d+
Loss:      ["']Loss/train_loss["']\s*:\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|NaN|Inf)
Grad norm: ["']grad_norm["']\s*:\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|NaN|Inf)
```

The UI lists every numeric token found in each example. For `Step 1/100`, users can explicitly select `1` rather than `100`; the chosen value is highlighted. The sample/regex preview reports matched rows, per-field matches, step range, duplicate steps, source lines, and parsed sample points before the rules are applied. Loss and Grad norm are individually optional, but Step and at least one metric are required.

Anomaly detection preserves `NaN` and `Inf` records, flags upward spikes when a value exceeds the previous valid value by the configured spike factor, and flags gradient explosions using a rolling median/MAD baseline plus the configured explosion factor. Events are marked on the raw curve and listed below the charts. The left panel exposes detection enablement, spike factor, and explosion factor controls.

The top-right language control switches the interface between English and Chinese. Uploaded filenames, regex rules, metric values, and chart data are preserved when switching languages.

## Supported log shapes

- JSON / JSONL records with fields such as `step`, `loss`, and `grad_norm` (also accepts `iteration`, `global_step`, `train_loss`, `gradient_norm` and similar aliases)
- CSV with a header row
- Plain text lines such as `step=1200 loss=0.42 grad_norm=1.08`

All parsing happens locally in the browser. Every uploaded run is included in the raw trace chart, and each non-baseline run gets its own pairwise comparison chart.

Ready-to-use sample logs are included in [`sample_logs/`](./sample_logs/): `baseline.log`, `moore.log`, and `anomaly.log` (contains a loss spike, gradient explosion, NaN, and Inf examples).

## Local development

```bash
npm install
npm run dev
```

## Build and deploy

```bash
npm run build
```

### First deployment to GitHub Pages

1. On GitHub, create an empty repository, for example `moore-loss`. Do not add a README or `.gitignore` there because this project already contains them.

2. From this project directory, initialize Git and push the `main` branch:

```bash
cd /home/mt/project/moore_loss
git init
git add .
git commit -m "Initial Moore Loss app"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPOSITORY>.git
git push -u origin main
```

3. In the GitHub repository, open **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**, and save. GitHub documents this as the publishing source for a custom Pages workflow. [GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

4. Open the **Actions** tab and wait for **Deploy Moore Loss to GitHub Pages** to finish. The site URL will normally be:

```text
https://<YOUR_USERNAME>.github.io/<YOUR_REPOSITORY>/
```

After that, every push to `main` rebuilds and redeploys the site automatically. The workflow is in `.github/workflows/deploy.yml`; it installs from the project root, runs `npm run build`, and publishes `dist/`.

## Design notes

- `src/utils/parseLog.js` contains format detection, aliases, and step bucketing.
- `src/utils/sampleRules.js` generates strict parsing rules from user-provided examples and selected values.
- `src/utils/compare.js` owns the comparison math and formatting.
- `src/utils/chartDomain.js` owns readable Y-axis domains and integer training-step ticks.
- `src/main.jsx` keeps the UI composition and SVG chart renderer together so the exported SVG matches the visible chart.
