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
        // Accumulators [row][colForMax], range 0–127 (mirrors Max's 0–127 dial range)
        // Defaults: start=0, length=full, speed=1x (mid), volume=near-full
        this.accumulators = Array(4).fill(null).map(() => [0, 127, 64, 100]);
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

    // Called by GridManager instead of HTTP POST
    // colForMax: 0=start, 1=length, 2=speed, 3=volume
    // deltaSteps: integer step change (10° per step)
    onStep(row, colForMax, deltaSteps) {
        if (row < 0 || row > 3 || colForMax < 0 || colForMax > 3) return;
        const acc = this.accumulators[row];
        acc[colForMax] = Math.max(0, Math.min(127, acc[colForMax] + deltaSteps));
        this._applyParam(row, colForMax);
    }

    _applyParam(row, colForMax) {
        const player = this.players[row];
        if (!player || !this.buffer) return;
        const duration = this.buffer.duration;
        const norm = this.accumulators[row][colForMax] / 127; // 0–1

        switch (colForMax) {
            case 0: { // start position: 0 → start of sample, 1 → end
                player.loopStart = norm * duration;
                if (player.loopEnd <= player.loopStart) {
                    player.loopEnd = Math.min(duration, player.loopStart + 0.05);
                }
                break;
            }
            case 1: { // loop window length
                const minLen = 0.05;
                const available = Math.max(0, duration - player.loopStart - minLen);
                player.loopEnd = Math.min(duration, player.loopStart + minLen + norm * available);
                break;
            }
            case 2: { // speed — exponential: norm 0→0.25x, 0.5→1x, 1→4x
                player.playbackRate = Math.pow(4, 2 * norm - 1);
                break;
            }
            case 3: { // volume — linear norm to dB
                player.volume.value = norm < 0.01 ? -60 : 20 * Math.log10(norm);
                break;
            }
        }
    }
}
