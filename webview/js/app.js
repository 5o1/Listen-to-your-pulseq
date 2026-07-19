// Main application - event handlers, file loading
import { parseSequenceText } from './reader.js';
import { parseSequenceBinary } from './binaryReader.js';
import { decodeAllBlocks } from './decoder.js';
import {
  playBlocks, stopPlayback, pausePlayback, seekPlayback, getPlaybackPosition,
  isPlaying, exportWav, getAudioContext,
} from './audio.js';
import { startVisualizer, stopVisualizer } from './visualizer.js';

// State
let decodedBlocks = null;
let sequenceDuration = 0;

// DOM
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const btnPlay = document.getElementById('btnPlay');
const btnStop = document.getElementById('btnStop');
const btnExport = document.getElementById('btnExport');
const btnBrowse = document.getElementById('btnBrowse');
const visCanvas = document.getElementById('visCanvas');
const emptyState = document.getElementById('emptyState');
const statusEl = document.getElementById('status');
const playbackProgress = document.getElementById('playbackProgress');
const progressCurrent = document.getElementById('progressCurrent');
const progressDuration = document.getElementById('progressDuration');
const loadedFile = document.getElementById('loadedFile');
const historyToggle = document.getElementById('historyToggle');
const historyLog = document.getElementById('historyLog');
const historyEntries = document.getElementById('historyEntries');

function addHistoryEntry(message, state) {
  const entry = document.createElement('li');
  entry.className = 'history-entry';
  entry.dataset.state = state;
  const time = document.createElement('time');
  time.dateTime = new Date().toISOString();
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const text = document.createElement('span');
  text.textContent = message;
  entry.append(time, text);
  historyEntries.append(entry);
  while (historyEntries.children.length > 50) historyEntries.firstElementChild.remove();
}

function setStatus(message, state = 'info') {
  statusEl.textContent = message;
  statusEl.dataset.state = state;
  addHistoryEntry(message, state);
}

function setLoadedFile(fileName) {
  loadedFile.replaceChildren();
  if (!fileName) {
    loadedFile.textContent = 'Load a sequence to enable playback';
    return;
  }
  loadedFile.append('Loaded: ');
  loadedFile.append(document.createTextNode(fileName));
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const totalMinutes = Math.floor(seconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const remaining = (seconds % 60).toFixed(1).padStart(4, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}`
    : `${minutes}:${remaining}`;
}

function updateProgress(current = getPlaybackPosition()) {
  const duration = Math.max(0, sequenceDuration);
  const value = duration > 0 ? Math.max(0, Math.min(current, duration)) : 0;
  playbackProgress.max = String(duration);
  playbackProgress.value = String(value);
  playbackProgress.disabled = !decodedBlocks || duration <= 0;
  progressCurrent.textContent = formatTime(value);
  progressDuration.textContent = formatTime(duration);
  const percentage = duration > 0 ? (value / duration) * 100 : 0;
  playbackProgress.style.setProperty('--progress', `${percentage}%`);
}

function resetSequence() {
  decodedBlocks = null;
  sequenceDuration = 0;
  stopPlayback();
  stopVisualizer();
  updatePlayButton();
  document.getElementById('infoBlocks').textContent = '-';
  document.getElementById('infoDuration').textContent = '-';
  setLoadedFile(null);
  updateProgress(0);
  emptyState.style.display = '';
  btnPlay.disabled = true;
  btnStop.disabled = true;
  btnExport.disabled = true;
}

function loadSequence(seq, fileName = 'sequence.seq') {
  if (!seq || !Array.isArray(seq.blocks) || seq.blocks.length === 0) {
    throw new Error('No Pulseq blocks found');
  }
  stopPlayback();
  stopVisualizer();
  updatePlayButton();
  decodedBlocks = decodeAllBlocks(seq);
  let tMax = 0;
  for (const b of decodedBlocks) tMax = Math.max(tMax, b.startTime + b.duration);
  sequenceDuration = tMax;

  document.getElementById('infoBlocks').textContent = seq.blocks.length;
  document.getElementById('infoDuration').textContent = (tMax * 1000).toFixed(1) + ' ms';
  setLoadedFile(fileName);
  updateProgress(0);
  emptyState.style.display = 'none';
  btnPlay.disabled = false;
  btnStop.disabled = false;
  btnExport.disabled = false;
  setStatus(`Loaded: ${seq.blocks.length} blocks, ${(tMax * 1000).toFixed(1)} ms`, 'success');
}

function handleFile(file) {
  setStatus('Reading file...', 'info');
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let seq;
      const isBinary = file.name.toLowerCase().endsWith('.bseq');
      if (isBinary) {
        seq = parseSequenceBinary(new Uint8Array(e.target.result));
      } else {
        // FileReader.readAsText() returns a string. Do not pass it through
        // TextDecoder, which only accepts an ArrayBuffer/typed array.
        const text = typeof e.target.result === 'string'
          ? e.target.result
          : new TextDecoder().decode(e.target.result);
        seq = parseSequenceText(text);
      }
      loadSequence(seq, file.name);
    } catch (err) {
      resetSequence();
      setStatus('Error: ' + err.message, 'error');
      console.error(err);
    }
  };
  reader.onerror = () => {
    resetSequence();
    setStatus('Error: Unable to read file', 'error');
  };
  if (file.name.toLowerCase().endsWith('.bseq')) reader.readAsArrayBuffer(file);
  else reader.readAsText(file);
}

// Event bindings
dropZone.addEventListener('click', (event) => {
  if (event.target !== btnBrowse) fileInput.click();
});
btnBrowse.addEventListener('click', (event) => {
  event.stopPropagation();
  fileInput.click();
});
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', (e) => { const file = e.target.files[0]; if (file) handleFile(file); });

playbackProgress.addEventListener('input', () => {
  updateProgress(Number(playbackProgress.value));
});
playbackProgress.addEventListener('change', () => {
  seekPlayback(Number(playbackProgress.value));
  updateProgress(getPlaybackPosition());
});

btnPlay.addEventListener('click', () => {
  if (isPlaying()) {
    pausePlayback();
    stopVisualizer();
    updatePlayButton();
    updateProgress();
    return;
  }
  if (!decodedBlocks) return;
  playBlocks(decodedBlocks, 44100);
  startVisualizer(visCanvas, getActiveAnalyser, isPlaying);
  updatePlayButton();
  updateProgress();
});

btnStop.addEventListener('click', () => {
  stopPlayback();
  stopVisualizer();
  updatePlayButton();
  updateProgress(0);
});

btnExport.addEventListener('click', () => {
  if (!decodedBlocks) return;
  const wav = exportWav(decodedBlocks, 44100);
  const blob = new Blob([wav], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'sequence.wav'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus('WAV file exported', 'success');
});

historyToggle.addEventListener('click', () => {
  const open = historyLog.hidden;
  historyLog.hidden = !open;
  historyToggle.textContent = open ? 'Hide history log' : 'History log';
  historyToggle.setAttribute('aria-expanded', String(open));
});

function updatePlayButton() {
  const playing = isPlaying();
  const label = playing ? '⏸ Pause' : '▶ Play';
  if (btnPlay.textContent !== label) btnPlay.textContent = label;
  btnPlay.classList.toggle('primary', !playing);
}

// Keep the progress bar and playback controls synchronized with AudioBufferSourceNode.
setInterval(() => {
  updatePlayButton();
  updateProgress();
  if (!isPlaying() && sequenceDuration > 0 && getPlaybackPosition() >= sequenceDuration - 0.01) {
    stopVisualizer();
  }
}, 100);

// Init
updatePlayButton();
updateProgress(0);
setStatus('Ready - load a sequence file to preview.');
const getActiveAnalyser = () => (isPlaying() ? getAudioContext().analyser : null);
