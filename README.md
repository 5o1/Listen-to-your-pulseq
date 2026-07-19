<p align="center">
  <a href="https://5o1.github.io/Listen-to-your-pulseq/"><img src="webview/assets/logo-lockup.svg" alt="Listen to your Pulseq - gradient waveform audio preview" width="760"></a>
</p>

# [Listen-to-your-pulseq](https://5o1.github.io/Listen-to-your-pulseq/)

Audio preview for pypulseq gradient waveforms - Python package + web demo,
designed for MRI music and gradient noise preview.

Convert PyPulseq `.seq` / `.bseq` sequences into audible gradient waveforms,
visualize the combined Gx/Gy/Gz spectrum, and export WAV files for MRI sound
design, gradient noise analysis, and sequence sonification.

[![Test](https://github.com/5o1/Listen-to-your-pulseq/actions/workflows/test.yml/badge.svg)](https://github.com/5o1/Listen-to-your-pulseq/actions/workflows/test.yml)
[![Pages](https://github.com/5o1/Listen-to-your-pulseq/actions/workflows/pages.yml/badge.svg)](https://github.com/5o1/Listen-to-your-pulseq/actions/workflows/pages.yml)
[![pypulseq](https://img.shields.io/badge/-pypulseq-gray?logo=github)](https://github.com/imr-framework/pypulseq)

## Web Demo

**[Launch demo](https://5o1.github.io/Listen-to-your-pulseq/)** — upload `.seq` or `.bseq` files, hear gradient waveforms, seek with the playback progress bar, and export WAV.

The parser is based on [seqeyes_plugin](https://github.com/bughht/seqeyes_plugin) (MIT).

## Python Package

```bash
pip install pypulseq_audio
```

```python
from pypulseq import Sequence
import pypulseq_audio
pypulseq_audio.patch()

seq = Sequence()
# ... build your sequence ...
seq.listen(play_now=True)
```

### API

**`Sequence.listen(...)`** returns `np.ndarray`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `speaker` | `Callable \| None` | `None` | Callback `(waveform, rate)`. Auto-detects Jupyter. |
| `save_dir` | `str \| None` | `None` | Directory to save WAV. |
| `save_path` | `str \| None` | `None` | Deprecated alias for `save_dir`. |
| `save_filename` | `str` | `'seq.wav'` | Output filename. |
| `time_range` | `tuple` | `(0, inf)` | Time range in seconds; output is trimmed to this interval. |
| `time_disp` | `str` | `'s'` | Deprecated compatibility option; `time_range` is always in seconds. |
| `grad_disp` | `str` | `'kHz/m'` | Output scale: `'kHz/m'` or `'mT/m'`. |
| `play_now` | `bool` | `True` | Play immediately. |
| `rate` | `int` | `44100` | Sample rate in Hz. |

The three gradient channels are sampled and summed into one waveform.

**`Sequence.duration_update(append_only=True)`** returns `float`

## Development

```bash
pip install -e ".[jupyter,test]"
pytest tests/ -v
```

To run the Playwright browser automation tests:

```bash
cd webview
npm ci
npx playwright install chromium
npm test
```

Build the static webview artifact locally:

```bash
cd webview
npm run build
```

The output is written to `webview/dist/`.

Useful Playwright commands:

```bash
npm run test:headed   # run with a visible browser
npm run test:debug    # open the Playwright inspector
npm run test:ui       # interactive test runner
npm run test:report   # open the latest HTML report
npm run serve         # serve the built webview
```

The GitHub Actions browser job installs Chromium, runs the suite with retries,
and uploads the HTML report, JUnit output, traces, screenshots, and retry videos
for diagnosis. Set `PW_PORT` to override the local test server port.

## Release

Create a tag matching the version in `pyproject.toml` (for example, `v0.2.0`).
The release workflow builds and validates the Python wheel/sdist, builds the
static webview, and attaches the webview ZIP alongside the Python artifacts on
the GitHub Release.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for third-party attributions.
