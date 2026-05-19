import { VideoProcessor } from './videoProcessor.js';
import { AudioEngine } from './audioEngine.js';

const GRID_SIZE = 4;

document.addEventListener('DOMContentLoaded', () => {
    const audioEngine = new AudioEngine();
    const audioCtx = new AudioContext();

    // --- DOM refs ---
    const setupScreen   = document.getElementById('setupScreen');
    const recordBtn     = document.getElementById('recordBtn');
    const stopBtn       = document.getElementById('stopBtn');
    const dropZone      = document.getElementById('dropZone');
    const fileInput     = document.getElementById('fileInput');
    const statusMsg     = document.getElementById('statusMsg');
    const startBtn      = document.getElementById('startBtn');
    const recordTimer   = document.getElementById('recordTimer');
    const debugOverlay  = document.getElementById('debugOverlay');
    const modeIndicator = document.getElementById('modeIndicator');

    // --- Video processor (camera starts immediately) ---
    const video               = document.getElementById('video');
    const gridCanvas          = document.getElementById('gridCanvas');
    const handCanvas          = document.getElementById('handCanvas');
    const canvas              = document.getElementById('canvas');
    const shaderOverlayCanvas = document.getElementById('shaderOverlayCanvas');
    const rightHandCanvas     = document.getElementById('rightHandCanvas');

    const videoProcessor = new VideoProcessor(
        video, gridCanvas, handCanvas, canvas,
        shaderOverlayCanvas, rightHandCanvas, GRID_SIZE
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
    async function loadArrayBuffer(arrayBuffer) {
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        await audioEngine.loadAudioBuffer(audioBuffer);
        setStatus('Sample ready.');
        startBtn.disabled = false;
    }

    async function loadDefaultSample() {
        try {
            setStatus('Loading default sample…');
            const response = await fetch('/440sample-trim.mp3');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            await loadArrayBuffer(arrayBuffer);
        } catch (err) {
            setStatus('Default sample not found. Record or drop a file.');
        }
    }

    function setStatus(msg) {
        statusMsg.textContent = msg;
    }

    // --- Recording ---
    let mediaRecorder = null;
    let chunks = [];
    let timerInterval = null;
    let elapsedSec = 0;
    const MAX_RECORD_SEC = 30;

    recordBtn.addEventListener('click', async () => {
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
            setStatus('Processing recording…');
            const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
            const arrayBuffer = await blob.arrayBuffer();
            await loadArrayBuffer(arrayBuffer);
        };

        mediaRecorder.start();
        elapsedSec = 0;
        recordTimer.textContent = '0:00';
        timerInterval = setInterval(() => {
            elapsedSec++;
            const m = Math.floor(elapsedSec / 60);
            const s = String(elapsedSec % 60).padStart(2, '0');
            recordTimer.textContent = `${m}:${s}`;
            if (elapsedSec >= MAX_RECORD_SEC) stopRecording();
        }, 1000);

        recordBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        setStatus('Recording… (max 30s)');
    });

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        stopBtn.style.display = 'none';
        recordBtn.style.display = 'inline-block';
    }

    stopBtn.addEventListener('click', stopRecording);

    // --- File drop ---
    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', async e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (!file) return;
        setStatus(`Loading ${file.name}…`);
        const arrayBuffer = await file.arrayBuffer();
        await loadArrayBuffer(arrayBuffer);
    });

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        setStatus(`Loading ${file.name}…`);
        const arrayBuffer = await file.arrayBuffer();
        await loadArrayBuffer(arrayBuffer);
    });

    // --- Keyboard shortcuts (m = mute, g = grid lines) ---
    document.addEventListener('keydown', (e) => {
        if (e.target.closest('input, textarea')) return;
        const key = e.key.toLowerCase();
        if (key === 'm') {
            audioEngine.toggleMute();
        } else if (key === 'g') {
            const gridOn = videoProcessor.gridManager.toggleGridLines();
            if (modeIndicator) {
                modeIndicator.textContent = gridOn ? 'Grid on' : 'Grid off';
                modeIndicator.classList.add('visible');
                setTimeout(() => modeIndicator.classList.remove('visible'), 2000);
            }
        }
    });
    audioEngine.onMuteChange = (muted) => {
        setStatus(muted ? 'MUTED' : '');
    };

    // --- Start ---
    startBtn.addEventListener('click', async () => {
        await Tone.start();
        audioEngine.start();
        setupScreen.style.display = 'none';
    });

    loadDefaultSample();
});
