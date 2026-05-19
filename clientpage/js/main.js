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

    // --- Sample loading helpers ---
    async function loadArrayBuffer(arrayBuffer) {
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        await audioEngine.loadAudioBuffer(audioBuffer);
        setStatus('Sample ready.');
        startBtn.disabled = false;
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

    // --- Start ---
    startBtn.addEventListener('click', async () => {
        await Tone.start();
        audioEngine.start();
        setupScreen.style.display = 'none';
    });
});
