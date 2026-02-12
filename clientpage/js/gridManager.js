// Global threshold for “close enough to zero” (radians)
const EPSILON = 0.01;

export class GridManager {
    constructor(gridCanvas, shaderOverlayCanvas, gridSize = 8) {
        
        this.gridCanvas = gridCanvas;
        this.shaderOverlayCanvas = shaderOverlayCanvas;
        this.ctx = gridCanvas.getContext('2d');
        this.shaderCtx = shaderOverlayCanvas.getContext('2d');
        this.gridSize = gridSize;
        this.squareSize = 0;
        this.padding = 1;
        this.outerPadding = 100;

        // Grid state
        this.gridRotation = Array(gridSize).fill().map(() => Array(gridSize).fill(0));
        this.cumulativeRotation = Array(gridSize).fill().map(() => Array(gridSize).fill(0));
        // Track previous rotation per cell for delta calculations
        this._prevRotation = Array(gridSize).fill().map(() => Array(gridSize).fill(0));
		// Track previous quantized step count per cell for integer DeltaMsg
		this._prevStepCount = Array(gridSize).fill().map(() => Array(gridSize).fill(0));
        // Per-cell exponential decay constants k (1/s) to land all cells near zero together
        this._resetKs = Array(gridSize).fill().map(() => Array(gridSize).fill(0));
        // Define one 'step' as this many degrees of rotation (used for delta reporting)
        this.stepAngleDeg = 10; // keep in sync with rotateCell usage
        // Zeroing schedule state (post-reset messaging)
        this._zeroing = {
            active: false,
            messagesPerRow: 50,
            periodMs: 250,
            targetColForMax: 3,
            perRowRemaining: Array(gridSize).fill(0),
            nextSendAtMs: Array(gridSize).fill(0),
        };
        
    }

    setup() {
        this.updateCanvasSizes();
    }

    updateCanvasSizes() {
        // Calculate available space after outer padding
        const availableWidth = this.gridCanvas.width - (this.outerPadding * 2);
        const availableHeight = this.gridCanvas.height - (this.outerPadding * 2);
        
        // Calculate square size based on grid with inner padding
        const totalPadding = this.padding * (this.gridSize + 1);
        const availableGridWidth = availableWidth - totalPadding;
        const availableGridHeight = availableHeight - totalPadding;
        this.squareSize = Math.min(
            availableGridWidth / this.gridSize,
            availableGridHeight / this.gridSize
        );
    }

    drawGrid() {
        // Draw on left overlay
        this.ctx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
        this.ctx.globalAlpha = 0.25; // Set 25% opacity

        // Calculate total grid width and centering offsets
        const totalGridWidth = (this.squareSize * this.gridSize) + (this.padding * (this.gridSize - 1));
        const totalGridHeight = (this.squareSize * this.gridSize) + (this.padding * (this.gridSize - 1));
        const availableWidth = this.gridCanvas.width - (this.outerPadding * 2);
        const availableHeight = this.gridCanvas.height - (this.outerPadding * 2);
        const horizontalOffset = this.outerPadding + (availableWidth - totalGridWidth) / 2;
        const verticalOffset = this.outerPadding + (availableHeight - totalGridHeight) / 2;

        // Draw grid of squares on left overlay
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                // Mirror the x coordinate
                const mirroredCol = this.gridSize - 1 - col;
                const x = horizontalOffset + this.padding + mirroredCol * (this.squareSize + this.padding);
                const y = verticalOffset + this.padding + row * (this.squareSize + this.padding);

                this.ctx.strokeStyle = 'white';
                this.ctx.lineWidth = 1;
                this.ctx.strokeRect(x, y, this.squareSize, this.squareSize);
            }
        }

        // Reset opacity
        this.ctx.globalAlpha = 1.0;

        // Draw on right overlay
        this.shaderCtx.clearRect(0, 0, this.shaderOverlayCanvas.width, this.shaderOverlayCanvas.height);
        this.shaderCtx.globalAlpha = 0.25; // Set 25% opacity

        // Draw grid of squares on right overlay
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                const x = horizontalOffset + this.padding + col * (this.squareSize + this.padding);
                const y = verticalOffset + this.padding + row * (this.squareSize + this.padding);

                this.shaderCtx.strokeStyle = 'white';
                this.shaderCtx.lineWidth = 1;
                this.shaderCtx.strokeRect(x, y, this.squareSize, this.squareSize);
            }
        }

        // Reset opacity
        this.shaderCtx.globalAlpha = 1.0;
    }

    getGridCellIndex(x, y) {
        const totalGridWidth = (this.squareSize * this.gridSize) + (this.padding * (this.gridSize - 1));
        const totalGridHeight = (this.squareSize * this.gridSize) + (this.padding * (this.gridSize - 1));
        const availableWidth = this.gridCanvas.width - (this.outerPadding * 2);
        const availableHeight = this.gridCanvas.height - (this.outerPadding * 2);
        const horizontalOffset = this.outerPadding + (availableWidth - totalGridWidth) / 2;
        const verticalOffset = this.outerPadding + (availableHeight - totalGridHeight) / 2;

        // Convert screen coordinates to grid coordinates
        const gridX = Math.floor((x - horizontalOffset - this.padding) / (this.squareSize + this.padding));
        const gridY = Math.floor((y - verticalOffset - this.padding) / (this.squareSize + this.padding));

        // Mirror the x coordinate
        const mirroredGridX = this.gridSize - 1 - gridX;

        // Return null if outside grid
        if (mirroredGridX < 0 || mirroredGridX >= this.gridSize || gridY < 0 || gridY >= this.gridSize) {
            return null;
        }

        return { row: gridY, col: mirroredGridX };
    }

    rotateCell(row, col, angle = 5, clockwise = true) {
        
        if (row >= 0 && row < this.gridSize && col >= 0 && col < this.gridSize) {
            // Convert angle to radians and add to current rotation
            const angleInRadians = angle * (Math.PI / 180);
            // If clockwise is false, negate the angle to rotate counter-clockwise
            this.gridRotation[row][col] += clockwise ? -angleInRadians : angleInRadians;
            // Update cumulative rotation (always positive)
            this.cumulativeRotation[row][col] += Math.abs(angleInRadians);
            
            // Send rotation data to Max server immediately when rotation changes
            this.sendRotationToMax(row, col);
            
            return true;
        } else {
            // invalid coordinates; no-op without noisy logging
        }
        return false;
    }

    // Gradually reduce rotations toward zero; returns true when all cells reach ~0
    smoothResetStep(dt, speed = 2.0) {
        let allZero = true;
        const epsilon = EPSILON;
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                const r = this.gridRotation[row][col];
                if (Math.abs(r) > epsilon) {
                    // Exponential decay: r(t+dt) = r(t) * exp(-k * dt)
                    const k = this._resetKs?.[row]?.[col] || speed; // speed used as fallback k (1/s)
                    let newR = r * Math.exp(-k * dt);
                    // Clamp tiny values to zero
                    if (Math.abs(newR) < epsilon) newR = 0;
                    // Update current rotation only; cumulativeRotation is for saturation (do not change during reset)
                    const dec = Math.abs(r - newR);
                    this.gridRotation[row][col] = newR;
                    // Debug: log current rotation during reset (mapped to Max column index)
                    try {
                        const colForMax = this.gridSize - 1 - col;
                        console.log(`Reset rot -> r${row} c${colForMax} = ${newR}`);
                    } catch (e) {
                        // ignore logging issues
                    }
                    // Notify Max of the change (mark as reset phase)
                    this.sendRotationToMax(row, col, true);
                    allZero = false;
                }
            }
        }
        return allZero;
    }


    // Initialize zeroing schedule
    startZeroingSchedule() {
        const now = Date.now();
        this._zeroing.active = true;
        for (let row = 0; row < this.gridSize; row++) {
            this._zeroing.perRowRemaining[row] = this._zeroing.messagesPerRow;
            this._zeroing.nextSendAtMs[row] = now;
        }
    }

    // Zero out phase: only send c=3 messages, 10 messages per row, spaced by 500ms
    zeroOutRemainingStepCounts() {
        if (!this._zeroing.active) {
            this.startZeroingSchedule();
        }
        let anyRemaining = false;
        const col = this.gridSize - 1 - this._zeroing.targetColForMax; // internal col index for c=3
        const now = Date.now();
        for (let row = 0; row < this.gridSize; row++) {
            if (this._zeroing.perRowRemaining[row] > 0) {
                anyRemaining = true;
                if (now >= this._zeroing.nextSendAtMs[row]) {
                    // During zeroing stage: send fixed step of -1 to Max for c=3
                    const colForMax = this._zeroing.targetColForMax; // 3
                    const deltaStepsInt = -1;
                    // Update local tracker to reflect one message sent
                    this._prevStepCount[row][col] = (this._prevStepCount[row][col] || 0) + deltaStepsInt;

                    const cellData = {
                        row: row,
                        col: colForMax,
                        currentRotation: 0,
                        cumulativeRotation: this.cumulativeRotation[row][col],
                        timestamp: Date.now(),
                        message: 'r' + row + ' c' + colForMax + ' 0',
                        DeltaMsg: 'r' + row + ' c' + colForMax + ' ' + deltaStepsInt
                    };

                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', 'http://localhost:2112', true);
                    xhr.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
                    xhr.send(JSON.stringify(cellData));
                    try { console.log(`Sent: r${row} c${colForMax} steps=${deltaStepsInt}`); } catch (_) {}

                    this._zeroing.perRowRemaining[row] -= 1;
                    this._zeroing.nextSendAtMs[row] = now + this._zeroing.periodMs;
                }
            }
        }
        if (!anyRemaining) {
            this._zeroing.active = false;
            return true;
        }
        return false;
    }

    // Snapshot per-cell speeds so all cells arrive at zero after durationSec
    startTimedReset(durationSec = 1.5) {
        const epsilon = EPSILON;
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                const r0 = this.gridRotation[row][col];
                if (Math.abs(r0) > epsilon) {
                    // Choose k so that r(T) ≈ epsilon: r0 * exp(-k T) = epsilon → k = ln(r0/epsilon) / T
                    const T = Math.max(0.001, durationSec);
                    this._resetKs[row][col] = Math.log(Math.abs(r0) / epsilon) / T;
                } else {
                    this._resetKs[row][col] = 0;
                }
            }
        }
    }

    getGridData() {
        const squarePositions = [];
        const squareSizes = [];
        const squareRotations = [];
        const squareCumulativeRotations = [];

        // Calculate total grid width and centering offsets
        const totalGridWidth = (this.squareSize * this.gridSize) + (this.padding * (this.gridSize - 1));
        const totalGridHeight = (this.squareSize * this.gridSize) + (this.padding * (this.gridSize - 1));
        const availableWidth = this.gridCanvas.width - (this.outerPadding * 2);
        const availableHeight = this.gridCanvas.height - (this.outerPadding * 2);
        const horizontalOffset = this.outerPadding + (availableWidth - totalGridWidth) / 2;
        const verticalOffset = this.outerPadding + (availableHeight - totalGridHeight) / 2;

        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                const x = (horizontalOffset + this.padding + col * (this.squareSize + this.padding)) / this.gridCanvas.width;
                const y = (verticalOffset + this.padding + row * (this.squareSize + this.padding)) / this.gridCanvas.height;
                const width = this.squareSize / this.gridCanvas.width;
                const height = this.squareSize / this.gridCanvas.height;

                squarePositions.push(x, y);
                squareSizes.push(width, height);
                squareRotations.push(this.gridRotation[row][col]);
                squareCumulativeRotations.push(this.cumulativeRotation[row][col]);
            }
        }

        return {
            positions: squarePositions,
            sizes: squareSizes,
            rotations: squareRotations,
            cumulativeRotations: squareCumulativeRotations
        };
    }

    exportRotationData() {
        const rotations = [];
        
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                rotations.push({
                    row: row,
                    col: col,
                    currentRotation: this.gridRotation[row][col],
                    cumulativeRotation: this.cumulativeRotation[row][col]
                });
            }
        }

        return {
            gridSize: this.gridSize,
            timestamp: Date.now(),
            rotations: rotations
        };
    }

    sendRotationToMax(row, col, isResetPhase = false, forceSend = false) {
        // Send individual cell rotation data to squiggle server (same format as squiggle)
        
        // Convert internal mirrored column index so that top-left is (0,0) when sending to Max
        const colForMax = this.gridSize - 1 - col;

// I don't like this forMAx thing, it feels like there should be a row and col that makes
//sense internally, but for now lets just get the right values out so it maps to the control
//in a perdicatable way.
        
		// Compute integer delta steps using quantized step counts so reset perfectly cancels user steps.
		// Note: refactor to accumulator if timing granularity matters in Max.
        const stepRad = (this.stepAngleDeg * Math.PI) / 180;
		const currStepCount = stepRad > 0 ? Math.round(this.gridRotation[row][col] / stepRad) : 0;
		const deltaStepsInt = currStepCount - this._prevStepCount[row][col];

        // During reset (and generally), only send when a whole step boundary is crossed.
        // If no step change, update trackers and exit early to avoid spamming Max.
        if (deltaStepsInt === 0 && !forceSend) {
            this._prevRotation[row][col] = this.gridRotation[row][col];
            this._prevStepCount[row][col] = currStepCount;
            return;
        }
        // If we're in the reset phase, only send for column 3 (Max-side index)
        if (isResetPhase && colForMax !== 3) {
            this._prevRotation[row][col] = this.gridRotation[row][col];
            this._prevStepCount[row][col] = currStepCount;
            return;
        }

        const cellData = {
            row: row,
            col: colForMax,
            currentRotation: this.gridRotation[row][col],
            cumulativeRotation: this.cumulativeRotation[row][col],
            timestamp: Date.now(),
            message: 'r'+row+' c'+colForMax+' '+this.gridRotation[row][col],
			DeltaMsg: 'r'+row+' c'+colForMax+' '+deltaStepsInt
        };

        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'http://localhost:2112', true);
        xhr.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
        
        const payload = JSON.stringify(cellData);
        xhr.send(payload);
        // Debug: concise send log
        try { console.log(`Sent: r${row} c${colForMax} steps=${deltaStepsInt}`); } catch (e) {}
        
        xhr.onerror = function() {
            console.error(`❌ Failed to send cell [${row},${col}] rotation to Max`);
        };
        // Update previous rotation after send
        this._prevRotation[row][col] = this.gridRotation[row][col];
		// Update previous step count after send
		this._prevStepCount[row][col] = currStepCount;
    }
} 