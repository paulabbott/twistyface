import { VideoProcessor } from './videoProcessor.js';
import { AudioEngine } from './audioEngine.js';

const GRID_SIZE = 4;

// Built-in samples (add files at these paths in the repo root / samples/)
const SAMPLE_PRESETS = {
    sample1: '/440sample-trim.mp3',
    sample2: '/samples/sample2.mp3',
    sample3: '/samples/sample3.mp3',
};

document.addEventListener('DOMContentLoaded', () => {
    const audioEngine = new AudioEngine();
    const audioCtx = new AudioContext();

    // --- DOM refs ---
    const introOverlay  = document.getElementById('introOverlay');
    const recordBtn     = document.getElementById('recordBtn');
    const uploadBtn     = document.getElementById('uploadBtn');
    const fileInput     = document.getElementById('fileInput');
    const statusMsg     = document.getElementById('statusMsg');
    const recordTimer   = document.getElementById('recordTimer');
    const debugOverlay  = document.getElementById('debugOverlay');
    const modeIndicator = document.getElementById('modeIndicator');
    const helpOverlay   = document.getElementById('helpOverlay');
    const sampleButtons = {
        sample1: document.getElementById('sample1Btn'),
        sample2: document.getElementById('sample2Btn'),
        sample3: document.getElementById('sample3Btn'),
    };

    let sampleReady = false;
    let activeSampleKey = null;

    // --- Video processor (camera starts immediately) ---
    const video               = document.getElementById('video');
    const canvas              = document.getElementById('canvas');
    const shaderOverlayCanvas = document.getElementById('shaderOverlayCanvas');
    const handCanvas          = document.getElementById('handCanvas');

    const videoProcessor = new VideoProcessor(
        video, canvas, shaderOverlayCanvas, handCanvas, GRID_SIZE
    );
    videoProcessor.gridManager.onStep = (row, col, delta) => audioEngine.onStep(row, col, delta);

    // --- Debug: per-square values (numbers only) for all rows ---
    const squareLabels = []; // squareLabels[row][col]
    const loopSegments = []; // one per row

    for (let row = 0; row < GRID_SIZE; row++) {
        squareLabels[row] = [];
        for (let col = 0; col < GRID_SIZE; col++) {
            const label = document.createElement('div');
            label.style.position = 'absolute';
            label.style.top = `${(row / GRID_SIZE) * 100}%`;
            label.style.left = `${(col / GRID_SIZE) * 100}%`;
            label.style.width = `${100 / GRID_SIZE}%`;
            label.style.height = `${100 / GRID_SIZE}%`;
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.justifyContent = 'center';
            label.style.textAlign = 'center';
            label.style.color = '#fff';
            label.style.fontFamily = 'Menlo, Consolas, monospace';
            label.style.fontSize = '20px';
            label.style.lineHeight = '1.5';
            label.style.pointerEvents = 'none';
            label.style.transform = 'translateY(-20px)';
            label.textContent = '–';
            if (debugOverlay) debugOverlay.appendChild(label);
            squareLabels[row].push(label);
        }

        // Loop segment bar for this row: 1px white track, 5px yellow marker
        const loopBar = document.createElement('div');
        loopBar.style.position = 'absolute';
        loopBar.style.left = '5%';
        loopBar.style.width = '90%';
        loopBar.style.top = `${((row + 0.5) / GRID_SIZE) * 100}%`;
        loopBar.style.height = '5px';
        loopBar.style.transform = 'translateY(-50%)';
        loopBar.style.background = 'transparent';

        const loopTrack = document.createElement('div');
        loopTrack.style.position = 'absolute';
        loopTrack.style.left = '0';
        loopTrack.style.right = '0';
        loopTrack.style.top = '50%';
        loopTrack.style.height = '1px';
        loopTrack.style.transform = 'translateY(-50%)';
        loopTrack.style.background = '#fff';
        loopBar.appendChild(loopTrack);

        const loopSeg = document.createElement('div');
        loopSeg.style.position = 'absolute';
        loopSeg.style.top = '50%';
        loopSeg.style.height = '5px';
        loopSeg.style.transform = 'translateY(-50%)';
        loopSeg.style.background = '#ffff00';
        loopSeg.style.left = '0%';
        loopSeg.style.width = '100%';
        loopBar.appendChild(loopSeg);
        if (debugOverlay) debugOverlay.appendChild(loopBar);
        loopSegments.push(loopSeg);
    }

    function formatParamValue(update) {
        if (update.unit === 's') return update.value.toFixed(3);
        if (update.unit === 'x') return update.value.toFixed(3);
        if (update.unit === 'dB') return update.value.toFixed(2);
        if (update.unit === 'lvl') return update.value.toFixed(1);
        return update.value.toFixed(3);
    }

    function updateLoopBar(row) {
        const player = audioEngine.players[row];
        if (!player || !audioEngine.buffer) return;
        const duration = audioEngine.buffer.duration;
        if (duration <= 0) return;
        const startPct = (player.loopStart / duration) * 100;
        const endPct = (player.loopEnd / duration) * 100;
        loopSegments[row].style.left = `${startPct}%`;
        loopSegments[row].style.width = `${endPct - startPct}%`;
    }

    audioEngine.onParamChange = (update) => {
        const { row, col } = update;
        if (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) {
            squareLabels[row][col].textContent = formatParamValue(update);
        }
        if (update.label === 'loopStart' || update.label === 'loopLength') {
            updateLoopBar(row);
        }
    };

    // --- Sample loading helpers ---
    function setActiveSampleButton(key) {
        Object.entries(sampleButtons).forEach(([k, btn]) => {
            if (btn) btn.classList.toggle('active', k === key);
        });
        activeSampleKey = key;
    }

    async function loadArrayBuffer(arrayBuffer, label = 'Sample') {
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        await audioEngine.loadAudioBuffer(audioBuffer);
        sampleReady = true;
        setStatus(`${label} ready. Press R to close panel.`);
    }

    async function loadSamplePreset(key) {
        const url = SAMPLE_PRESETS[key];
        if (!url) return;
        setStatus(`Loading ${key}…`);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            await loadArrayBuffer(arrayBuffer, key);
            setActiveSampleButton(key);
        } catch (err) {
            setStatus(`${key} not found (${url}).`);
        }
    }

    function setStatus(msg) {
        statusMsg.textContent = msg;
    }

    async function beginSession() {
        if (!sampleReady) return;
        await Tone.start();
        if (!audioEngine.started) audioEngine.start();
        if (introOverlay) introOverlay.style.display = 'none';
        if (debugOverlay) debugOverlay.style.display = 'flex';
    }

    // --- Recording ---
    let mediaRecorder = null;
    let chunks = [];
    let timerInterval = null;
    let elapsedSec = 0;
    const MAX_RECORD_SEC = 30;

    recordBtn.addEventListener('click', async () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
            return;
        }

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            setStatus('Microphone access denied.');
            return;
        }

        chunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            clearInterval(timerInterval);
            recordTimer.textContent = '';
            recordBtn.textContent = 'Record';
            recordBtn.classList.remove('recording');
            setActiveSampleButton(null);
            setStatus('Processing recording…');
            const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
            const arrayBuffer = await blob.arrayBuffer();
            await loadArrayBuffer(arrayBuffer, 'Recording');
        };

        mediaRecorder.start();
        elapsedSec = 0;
        recordTimer.textContent = '0:00';
        recordBtn.textContent = 'Stop';
        recordBtn.classList.add('recording');
        timerInterval = setInterval(() => {
            elapsedSec++;
            const m = Math.floor(elapsedSec / 60);
            const s = String(elapsedSec % 60).padStart(2, '0');
            recordTimer.textContent = `${m}:${s}`;
            if (elapsedSec >= MAX_RECORD_SEC) stopRecording();
        }, 1000);
        setStatus('Recording… (max 30s)');
    });

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
    }

    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        setStatus(`Loading ${file.name}…`);
        const arrayBuffer = await file.arrayBuffer();
        await loadArrayBuffer(arrayBuffer, file.name);
        setActiveSampleButton(null);
        fileInput.value = '';
    });

    Object.entries(sampleButtons).forEach(([key, btn]) => {
        btn?.addEventListener('click', () => loadSamplePreset(key));
    });

    function toggleHelpOverlay() {
        if (!helpOverlay) return;
        const show = !helpOverlay.classList.contains('visible');
        helpOverlay.classList.toggle('visible', show);
        helpOverlay.setAttribute('aria-hidden', show ? 'false' : 'true');
    }

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', async (e) => {
        if (e.target.closest('input, textarea')) return;
        const key = e.key.toLowerCase();
        if (key === 'escape') {
            if (helpOverlay?.classList.contains('visible')) {
                helpOverlay.classList.remove('visible');
                helpOverlay.setAttribute('aria-hidden', 'true');
            }
            return;
        }
        if (key === 'h') {
            toggleHelpOverlay();
            return;
        }
        if (key === 'm') {
            audioEngine.toggleMute();
        } else if (key === 'g') {
            const gridOn = videoProcessor.gridManager.toggleGridLines();
            if (modeIndicator) {
                modeIndicator.textContent = gridOn ? 'Grid on' : 'Grid off';
                modeIndicator.classList.add('visible');
                setTimeout(() => modeIndicator.classList.remove('visible'), 2000);
            }
        } else if (key === 'r') {
            if (!introOverlay) return;
            const hidden = introOverlay.style.display === 'none';
            if (hidden) {
                introOverlay.style.display = 'flex';
                if (modeIndicator) {
                    modeIndicator.textContent = 'Record panel on';
                    modeIndicator.classList.add('visible');
                    setTimeout(() => modeIndicator.classList.remove('visible'), 2000);
                }
            } else {
                await beginSession();
                if (modeIndicator) {
                    modeIndicator.textContent = 'Record panel off';
                    modeIndicator.classList.add('visible');
                    setTimeout(() => modeIndicator.classList.remove('visible'), 2000);
                }
            }
        }
    });
    audioEngine.onMuteChange = (muted) => {
        setStatus(muted ? 'MUTED' : '');
    };

    loadSamplePreset('sample1');
});
