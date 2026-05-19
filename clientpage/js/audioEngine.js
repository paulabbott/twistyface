// AudioEngine: replaces Max/MSP with in-browser granular playback via Tone.js
// Four GrainPlayer instances share one buffer — one per grid row.
// Parameters controlled by delta steps matching the Max patch:
//   colForMax 0 = start position
//   colForMax 1 = loop length
//   colForMax 2 = playback speed
//   colForMax 3 = volume

export class AudioEngine {
    constructor() {
        this.players = [];
        this.buffer = null;
        this.started = false;
        this.muted = false;
        this.onParamChange = null;
        this.onMuteChange = null;
        // Accumulators [row][colForMax], range 0–127 (mirrors Max's 0–127 dial range)
        this.accumulators = [
            [0,      32, 63.5, 100],  // row 0: start 0%, volume on
            [31.75,  32, 63.5, 0],    // row 1: start 25%, volume off
            [63.5,   32, 63.5, 0],    // row 2: start 50%, volume off
            [95.25,  32, 63.5, 0],    // row 3: start 75%, volume off
        ];
        this.lastApplied = Array(4).fill(null).map(() => Array(4).fill(null));
    }

    // audioBuffer: a decoded Web Audio API AudioBuffer
    async loadAudioBuffer(audioBuffer) {
        this.buffer = new Tone.ToneAudioBuffer(audioBuffer);
        this._createPlayers();
    }

    _createPlayers() {
        this.players.forEach(p => { try { p.stop(); p.dispose(); } catch (e) {} });
        this.players = [];
        for (let i = 0; i < 4; i++) {
            const player = new Tone.GrainPlayer(this.buffer).toDestination();
            player.loop = true;
            this.players.push(player);
        }
        // Apply defaults
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                this._applyParam(row, col);
            }
        }
    }

    start() {
        if (this.started || !this.players.length) return;
        this.started = true;
        this.players.forEach(p => p.start());
    }

    stop() {
        this.players.forEach(p => { try { p.stop(); } catch (e) {} });
        this.started = false;
    }

    toggleMute() {
        this.muted = !this.muted;
        Tone.getDestination().mute = this.muted;
        if (typeof this.onMuteChange === 'function') {
            this.onMuteChange(this.muted);
        }
    }

    // Per-parameter step multiplier: how many accumulator units per rotation step.
    // Increase to make a parameter move faster per gesture.
    stepMultiplier = [1, 1, 1, 10];  // [start, length, speed, volume]

    // Called by GridManager instead of HTTP POST
    // colForMax: 0=start, 1=length, 2=speed, 3=volume
    // deltaSteps: integer step change (10° per step)
    onStep(row, colForMax, deltaSteps) {
        if (row < 0 || row > 3 || colForMax < 0 || colForMax > 3) return;
        const acc = this.accumulators[row];
        const scaled = deltaSteps * this.stepMultiplier[colForMax];
        acc[colForMax] = Math.max(0, Math.min(127, acc[colForMax] + scaled));
        this._applyParam(row, colForMax);
    }

    _applyParam(row, colForMax) {
        const player = this.players[row];
        if (!player || !this.buffer) return;
        const duration = this.buffer.duration;
        const norm = this.accumulators[row][colForMax] / 127; // 0–1
        let value = null;
        let unit = '';
        let label = '';

        switch (colForMax) {
            case 0: { // start position: 0 → start of sample, 1 → end
                player.loopStart = norm * duration;
                const lengthNorm = this.accumulators[row][1] / 127;
                const minL = 0.05;
                const avail = Math.max(0, duration - player.loopStart - minL);
                player.loopEnd = Math.min(duration, player.loopStart + minL + lengthNorm * avail);
                value = player.loopStart;
                unit = 's';
                label = 'loopStart';
                break;
            }
            case 1: { // loop window length
                const minLen = 0.05;
                const available = Math.max(0, duration - player.loopStart - minLen);
                player.loopEnd = Math.min(duration, player.loopStart + minLen + norm * available);
                value = player.loopEnd - player.loopStart;
                unit = 's';
                label = 'loopLength';
                break;
            }
            case 2: { // speed — exponential: norm 0→0.25x, 0.5→1x, 1→4x
                player.playbackRate = Math.pow(4, 2 * norm - 1);
                value = player.playbackRate;
                unit = 'x';
                label = 'playbackRate';
                break;
            }
            case 3: { // volume — linear 0–10 readout; dB under the hood
                player.volume.value = norm < 0.01 ? -60 : 20 * Math.log10(norm);
                value = norm * 10; // 0 … 10
                unit = 'lvl';
                label = 'volume';
                break;
            }
        }

        if (typeof value === 'number') {
            const prev = this.lastApplied[row][colForMax];
            const changed = prev === null || Math.abs(value - prev) > 1e-6;
            if (changed) {
                this.lastApplied[row][colForMax] = value;
                if (typeof this.onParamChange === 'function') {
                    this.onParamChange({
                        row,
                        col: colForMax,
                        label,
                        value,
                        unit,
                        accumulator: this.accumulators[row][colForMax],
                        norm
                    });
                }
            }
        }
    }
}
