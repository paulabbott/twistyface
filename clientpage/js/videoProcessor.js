// Import required classes
import { HandTracker } from './handTracker.js';
import { WebGLContext } from './webglContext.js';
import { GridManager } from './gridManager.js';

// Configuration: set to false to disable automatic reset after idle
const RESET_ON_IDLE = false;

export class VideoProcessor {
    constructor(videoElement, shaderCanvas, shaderOverlayCanvas, handCanvas, gridSize = 4) {
        this.video = videoElement;
        this.shaderCanvas = shaderCanvas;
        this.shaderOverlayCanvas = shaderOverlayCanvas;
        this.handCanvas = handCanvas;
        this.gridSize = gridSize;
        this.glContext = new WebGLContext(shaderCanvas);

        this.handTracker = new HandTracker(videoElement, handCanvas);
        this.gridManager = new GridManager(shaderOverlayCanvas, gridSize);

        // Idle timer properties
        this.lastActivityTime = Date.now();
        this.idleTimer = null;
        this.countdownTimer = null;
        this.isCountdownActive = false;
        // Smooth reset state
        this.isResetting = false;
        this.isZeroingOut = false; // Track if we're zeroing out remaining step counts after reset
        this.resetSpeed = 2.0; // fallback rad/s if per-cell speed not set
        this.resetDurationSec = 8.0; // slower, smoother decay so all cells hit zero together
        this._lastTs = performance.now();
        this._zeroOutInterval = null; // Timer for zeroing out step counts

        // Max MSP integration properties (using squiggle server)
        // Individual cell rotations are sent immediately on change

        this.setup();
        this.setupKeyboardControls();
        if (RESET_ON_IDLE) this.startIdleTimer();
    }

    setupKeyboardControls() {
        document.addEventListener('keydown', (event) => {
            if (event.key === 'z') { // 'z' for reset
                // Cancel any ongoing zeroing out process
                this.isZeroingOut = false;
                if (this._zeroOutInterval) {
                    clearInterval(this._zeroOutInterval);
                    this._zeroOutInterval = null;
                }
                // Begin smooth reset instead of instant zero
                console.log('stage=reset-start');
                this.gridManager.startTimedReset(this.resetDurationSec);
                this.isResetting = true;
                if (RESET_ON_IDLE) this.startIdleTimer(); // Restart idle timer after manual reset
            } else if (event.key === 'd') { // 'd' for debug data
                this.debugRotationData();
            }
            this.updateActivity(); // Update activity on any key press
        });
    }

    async setup() {
        try {
            // First setup the video stream
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            this.video.srcObject = stream;

            await new Promise((resolve) => {
                this.video.addEventListener('loadedmetadata', resolve);
            });

            // Initialize WebGL and shaders first
            this.initializeWebGL();
            this.setupEventListeners();
            this.startRendering();

            // Then setup hand tracking in the background
            await this.handTracker.setup();
            this.gridManager.setup();
        } catch (error) {
            console.error('Error setting up video:', error);
        }
    }

    initializeWebGL() {
        const vertexShaderSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0, 1);
                v_texCoord = a_texCoord;
            }
        `;

        const fragmentShaderSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_texture;
            uniform vec2 u_squarePos[${this.gridSize * this.gridSize}];
            uniform vec2 u_squareSize[${this.gridSize * this.gridSize}];
            uniform float u_squareRotation[${this.gridSize * this.gridSize}];
            uniform float u_squareCumulativeRotation[${this.gridSize * this.gridSize}];
            
            vec2 rotate(vec2 coord, float angle) {
                float s = sin(angle);
                float c = cos(angle);
                return vec2(
                    coord.x * c - coord.y * s,
                    coord.x * s + coord.y * c
                );
            }

            // Convert RGB to HSL
            vec3 rgb2hsl(vec3 c) {
                float h = 0.0;
                float s = 0.0;
                float l = 0.0;
                float r = c.r;
                float g = c.g;
                float b = c.b;
                float cmin = min(r, min(g, b));
                float cmax = max(r, max(g, b));
                float delta = cmax - cmin;
                
                l = (cmax + cmin) / 2.0;
                
                if (delta == 0.0) {
                    h = 0.0;
                    s = 0.0;
                } else {
                    if (l < 0.5) {
                        s = delta / (cmax + cmin);
                    } else {
                        s = delta / (2.0 - cmax - cmin);
                    }
                    
                    if (r == cmax) {
                        h = (g - b) / delta;
                    } else if (g == cmax) {
                        h = 2.0 + (b - r) / delta;
                    } else {
                        h = 4.0 + (r - g) / delta;
                    }
                    
                    h = h / 6.0;
                    if (h < 0.0) h += 1.0;
                }
                
                return vec3(h, s, l);
            }

            // Convert HSL to RGB
            vec3 hsl2rgb(vec3 c) {
                vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
                return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
            }
            
            void main() {
                vec2 coord = v_texCoord;
                
                // Flip the entire image horizontally
                coord.x = 1.0 - coord.x;
                
                // Get the original color
                vec4 color = texture2D(u_texture, coord);
                
                // Convert to HSL and desaturate the entire image
                vec3 hsl = rgb2hsl(color.rgb);
                hsl.y = 0.0; // Set saturation to 0 for grayscale
                color.rgb = hsl2rgb(hsl);
                
                // Check each square
                for (int i = 0; i < ${this.gridSize * this.gridSize}; i++) {
                    if (coord.x >= u_squarePos[i].x && 
                        coord.x <= u_squarePos[i].x + u_squareSize[i].x &&
                        coord.y >= u_squarePos[i].y && 
                        coord.y <= u_squarePos[i].y + u_squareSize[i].y) {
                        
                        // Convert to local coordinates (0 to 1)
                        vec2 localCoord = (coord - u_squarePos[i]) / u_squareSize[i];
                        
                        // Center the coordinates (-0.5 to 0.5)
                        localCoord = localCoord - vec2(0.5);
                        
                        // Rotate
                        localCoord = rotate(localCoord, u_squareRotation[i]);
                        
                        // Move back to 0 to 1 range
                        localCoord = localCoord + vec2(0.5);
                        
                        // Convert back to texture coordinates
                        vec2 rotatedCoord = u_squarePos[i] + localCoord * u_squareSize[i];
                        
                        // Get the original color at the rotated position
                        vec4 originalColor = texture2D(u_texture, rotatedCoord);
                        
                        // Convert to HSL
                        vec3 originalHsl = rgb2hsl(originalColor.rgb);
                        
                        // Adjust saturation based on cumulative rotation
                        float cumulativeRotation = u_squareCumulativeRotation[i];
                        // Map cumulative rotation to saturation, reaching 200% after 3 full rotations (6π)
                        float saturation = cumulativeRotation / (6.0 * 3.14159);
                        // Clamp between 0 and 2.0 (200%)
                        saturation = clamp(saturation, 0.0, 2.0);
                        originalHsl.y = saturation;
                        
                        // Convert back to RGB
                        color.rgb = hsl2rgb(originalHsl);
                    }
                }
                
                gl_FragColor = color;
            }
        `;

        this.glContext.createProgram(vertexShaderSource, fragmentShaderSource);
        this.glContext.createTexture();

        const positions = new Float32Array([
            -1.0, -1.0,
            1.0, -1.0,
            -1.0, 1.0,
            1.0, 1.0,
        ]);

        const texCoords = new Float32Array([
            0.0, 1.0,
            1.0, 1.0,
            0.0, 0.0,
            1.0, 0.0,
        ]);

        this.glContext.buffers.position = this.glContext.createBuffer(positions);
        this.glContext.buffers.texCoord = this.glContext.createBuffer(texCoords);
    }

    setupEventListeners() {
        this.video.addEventListener('loadeddata', () => this.updateCanvasSizes());
        window.addEventListener('resize', () => this.updateCanvasSizes());
    }

    updateCanvasSizes() {
        const container = this.video.parentElement;
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        const videoAspect = this.video.videoWidth / this.video.videoHeight;
        const containerAspect = containerWidth / containerHeight;
        let videoWidth, videoHeight;

        // Scale to fill container while maintaining aspect ratio
        if (videoAspect > containerAspect) {
            // Video is wider than container, scale by height
            videoHeight = containerHeight;
            videoWidth = videoHeight * videoAspect;
        } else {
            // Video is taller than container, scale by width
            videoWidth = containerWidth;
            videoHeight = videoWidth / videoAspect;
        }

        this.handCanvas.width = videoWidth;
        this.handCanvas.height = videoHeight;
        this.shaderCanvas.width = this.video.videoWidth;
        this.shaderCanvas.height = this.video.videoHeight;
        this.shaderOverlayCanvas.width = videoWidth;
        this.shaderOverlayCanvas.height = videoHeight;

        this.glContext.gl.viewport(0, 0, this.shaderCanvas.width, this.shaderCanvas.height);
        this.gridManager.updateCanvasSizes();
        this.gridManager.drawGrid();
    }

    render() {
        if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            const gl = this.glContext.gl;

            gl.bindTexture(gl.TEXTURE_2D, this.glContext.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);

            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);

            this.glContext.setAttribute('a_position', this.glContext.buffers.position, 2);
            this.glContext.setAttribute('a_texCoord', this.glContext.buffers.texCoord, 2);

            // Time delta for animations
            const now = performance.now();
            const dt = Math.max(0, (now - this._lastTs) / 1000);
            this._lastTs = now;

            // Smooth reset progression
            if (this.isResetting) {
                const done = this.gridManager.smoothResetStep(dt, this.resetSpeed);
                if (done) {
                    console.log('stage=reset-done');
                    this.isResetting = false;
                    // After visual reset completes, presume all values need zeroing in Max
                    this.isZeroingOut = true;
                    console.log('stage=zeroing-start');
                    // Initialize zeroing schedule on the grid manager
                    if (typeof this.gridManager.startZeroingSchedule === 'function') {
                        this.gridManager.startZeroingSchedule();
                    }
                }
            }

            // Continue zeroing out step counts after reset
            if (this.isZeroingOut) {
                const allZeroed = this.gridManager.zeroOutRemainingStepCounts();
                    if (allZeroed) {
                    this.isZeroingOut = false;
                    if (this._zeroOutInterval) {
                        clearInterval(this._zeroOutInterval);
                        this._zeroOutInterval = null;
                    }
                    console.log('stage=idle');
                }
            }

            // Get grid data from GridManager
            const gridData = this.gridManager.getGridData();

            // Set uniform arrays
            const totalSquares = this.gridSize * this.gridSize;
            for (let i = 0; i < totalSquares; i++) {
                this.glContext.setUniform(`u_squarePos[${i}]`, '2f',
                    gridData.positions[i * 2],
                    gridData.positions[i * 2 + 1]
                );
                this.glContext.setUniform(`u_squareSize[${i}]`, '2f',
                    gridData.sizes[i * 2],
                    gridData.sizes[i * 2 + 1]
                );
                this.glContext.setUniform(`u_squareRotation[${i}]`, '1f',
                    gridData.rotations[i]
                );
                this.glContext.setUniform(`u_squareCumulativeRotation[${i}]`, '1f',
                    gridData.cumulativeRotations[i]
                );
            }

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Detect and draw hands
            this.handTracker.detectHands().then(hands => {
                if (!hands) return; // Skip if no hands detected
                
                this.handTracker.drawHands(hands);
                
                // Update grid rotations based on pinch state
                hands.forEach((hand, handIndex) => {
                    const pinchState = this.handTracker.getPinchState(handIndex);
                    if (pinchState.isActive) {
                        this.updateActivity(); // Update activity when pinching
                        // During reset/zeroing, ignore pinch so reset completes fully
                        if (this.isResetting || this.isZeroingOut) {
                            return;
                        }
                        const handPositions = this.handTracker.getHandPositions();
                        const position = handPositions[handIndex];
                        if (position) {
                            const midX = (position.thumb.x + position.indexFinger.x) / 2;
                            const midY = (position.thumb.y + position.indexFinger.y) / 2;
                            const gridCell = this.gridManager.getGridCellIndex(midX, midY);
                            if (gridCell) {
                                // Use handedness to determine rotation direction
                                // Right hand => clockwise, Left hand => counter-clockwise
                                const isRightHand = position.handedness === 'right';
                                this.gridManager.rotateCell(gridCell.row, gridCell.col, 10, isRightHand);
                            }
                        }
                    }
                });
            }).catch(error => {
                console.error('Error in hand detection:', error);
            });

            // Individual cell rotations are sent immediately when they change
        }

        requestAnimationFrame(() => this.render());
    }

    startRendering() {
        this.render();
    }

    startIdleTimer() {
        // Clear any existing timers
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.countdownTimer) clearTimeout(this.countdownTimer);
        
        // Reset activity time
        this.lastActivityTime = Date.now();
        this.isCountdownActive = false;
        
        // Start new idle timer (only if enabled)
        if (RESET_ON_IDLE) {
            this.idleTimer = setTimeout(() => {
                this.startCountdown();
            }, 20000); // 20 seconds
        }
    }

    startCountdown() {
        if (!RESET_ON_IDLE || this.isCountdownActive) return;
        
        this.isCountdownActive = true;
        this.showCountdownMessage('Resetting in 3 seconds...');
        
        this.countdownTimer = setTimeout(() => {
            // Cancel any ongoing zeroing out process
            this.isZeroingOut = false;
            if (this._zeroOutInterval) {
                clearInterval(this._zeroOutInterval);
                this._zeroOutInterval = null;
            }
            // Begin smooth timed reset after countdown
            this.gridManager.startTimedReset(this.resetDurationSec);
            this.isResetting = true;
            this.isCountdownActive = false;
            this.startIdleTimer(); // Restart the idle timer after reset
        }, 3000); // 3 seconds
    }

    showCountdownMessage(message) {
        // Create or get the message element
        let messageElement = document.getElementById('countdownMessage');
        if (!messageElement) {
            messageElement = document.createElement('div');
            messageElement.id = 'countdownMessage';
            messageElement.style.position = 'fixed';
            messageElement.style.top = '50%';
            messageElement.style.left = '50%';
            messageElement.style.transform = 'translate(-50%, -50%)';
            messageElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            messageElement.style.color = 'white';
            messageElement.style.padding = '20px';
            messageElement.style.borderRadius = '10px';
            messageElement.style.fontSize = '24px';
            messageElement.style.zIndex = '1000';
            document.body.appendChild(messageElement);
        }
        
        messageElement.textContent = message;
        messageElement.style.display = 'block';
        
        // Hide the message after 3 seconds
        setTimeout(() => {
            messageElement.style.display = 'none';
        }, 3000);
    }

    updateActivity() {
        if (RESET_ON_IDLE) this.startIdleTimer();
    }

    debugRotationData() {
        const rotationData = this.gridManager.exportRotationData();
        console.log('Rotation data:', rotationData);
    }

} 