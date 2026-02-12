// Import functions and constants from handTracking.js
import {
    MODEL_TYPE,
    MAX_HANDS,
    OFF_W,
    OFF_H,
    DETECTION_INTERVAL,
    DEBOUNCE_TIME,
    setupBackend,
    createDetector,
    calculateZDist,
    calculatePinchDistance
} from './handTracking.js';

// Normalize pinch distance based on z-distance
const normalizePinch = (rawPinch, handSize) => {
    // Add a small epsilon to prevent division by zero
    const safeHandSize = Math.max(handSize, 1);
    // Use a power function to better handle non-linear relationships
    // The 1.7 power helps reduce the impact of larger z-distances
    return (rawPinch / Math.pow(safeHandSize, 1.7)) * 1000;
};

// Export the HandTracker class
export class HandTracker {
    constructor(videoElement, leftHandCanvas, rightHandCanvas) {
        this.video = videoElement;
        this.leftHandCanvas = leftHandCanvas;
        this.rightHandCanvas = rightHandCanvas;
        this.leftCtx = leftHandCanvas.getContext('2d');
        this.rightCtx = rightHandCanvas.getContext('2d');
        
        // Hand tracking properties
        this.detector = null;
        this.offscreen = document.createElement('canvas');
        this.offctx = this.offscreen.getContext('2d');
        this.offscreen.width = OFF_W;
        this.offscreen.height = OFF_H;
        this.hands = [];
        this.frameCount = 0;

        // Pinch detection state
        this.handSize = [0, 0]; // Raw hand size values for each hand
        this.pinchDist = [0, 0]; // Raw pinch distance values for each hand
        this.normPinchDist = [0, 0]; // Normalized pinch distances for each hand
        this.pinchActive = [false, false]; // Track pinch state for each hand
        this.lastPinchTime = [0, 0]; // Track the last pinch time for each hand
        
        // Handedness detection
        this.handedness = [null, null]; // Track handedness for each hand
    }

    async setup() {
        try {
            await setupBackend();
            this.detector = await createDetector();
        } catch (error) {
            console.error('Error setting up hand tracking:', error);
        }
    }

    drawHands(hands) {
        // Clear both canvases
        this.leftCtx.clearRect(0, 0, this.leftHandCanvas.width, this.leftHandCanvas.height);
        this.rightCtx.clearRect(0, 0, this.rightHandCanvas.width, this.rightHandCanvas.height);

        if (!hands || hands.length === 0) return;

        const sx = this.leftHandCanvas.width / OFF_W;
        const sy = this.leftHandCanvas.height / OFF_H;

        hands.forEach((hand, handIndex) => {
            // Get thumb and index finger positions
            const thumb = hand.keypoints[4];
            const indexFinger = hand.keypoints[8];

            // Get raw values for visualization
            const handSize = this.handSize[handIndex];
            const pinchDist = this.pinchDist[handIndex];
            const normPinchDist = this.normPinchDist[handIndex];
            // Calculate threshold as half of hand width
            const pinchThreshold = handSize / 2;

            // Calculate everything in offscreen coordinates
            const midX = (thumb.x + indexFinger.x) / 2;
            const midY = (thumb.y + indexFinger.y) / 2;

            // Draw on both canvases
            [this.leftCtx, this.rightCtx].forEach(ctx => {
                // Draw line between thumb and index finger
                ctx.beginPath();
                ctx.moveTo(thumb.x * sx, thumb.y * sy);
                ctx.lineTo(indexFinger.x * sx, indexFinger.y * sy);
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Draw circle with scaled threshold radius
                ctx.beginPath();
                ctx.arc(midX * sx, midY * sy, pinchThreshold * 1.5, 0, 2 * Math.PI);
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Draw dot at midpoint, yellow if pinching
                const dotSize = 5; // Fixed size dot
                ctx.beginPath();
                ctx.arc(midX * sx, midY * sy, dotSize, 0, 2 * Math.PI);
                ctx.fillStyle = this.pinchActive[handIndex] ? 'yellow' : 'black';
                ctx.fill();
            });

            // Display raw values
            this.leftCtx.fillStyle = 'black';
            this.leftCtx.fillRect(5, 5, 400, 30); // Add black background
            this.leftCtx.fillStyle = 'white';
            this.leftCtx.font = '16px Arial';
            if (handIndex === 0) { // Left hand
                this.leftCtx.fillText(`handSize: ${Math.round(handSize)} | pinchDist: ${Math.round(pinchDist)} | normPinch: ${Math.round(normPinchDist)} | threshold: ${Math.round(pinchThreshold)}`, 10, 20);
            } else if (handIndex === 1) { // Right hand
                this.leftCtx.fillRect(this.leftHandCanvas.width - 405, 5, 400, 30); // Add black background
                this.leftCtx.fillText(`handSize: ${Math.round(handSize)} | pinchDist: ${Math.round(pinchDist)} | normPinch: ${Math.round(normPinchDist)} | threshold: ${Math.round(pinchThreshold)}`, this.leftHandCanvas.width - 300, 20);
            }
        });
    }

    detectHandedness(hand) {
        if (!hand || !hand.keypoints) return null;
        
        // Get key points for handedness detection
        const wrist = hand.keypoints[0];
        const thumbCMC = hand.keypoints[1];  // Thumb base
        const pinkyMCP = hand.keypoints[17]; // Pinky base
        
        // Calculate the cross product of vectors from wrist to thumb and wrist to pinky
        // This will be positive for right hand and negative for left hand
        const vector1 = {
            x: thumbCMC.x - wrist.x,
            y: thumbCMC.y - wrist.y
        };
        const vector2 = {
            x: pinkyMCP.x - wrist.x,
            y: pinkyMCP.y - wrist.y
        };
        
        // Cross product in 2D: v1.x * v2.y - v1.y * v2.x
        const crossProduct = vector1.x * vector2.y - vector1.y * vector2.x;
        
        // Since the camera is mirrored, we need to invert the result
        return crossProduct > 0 ? 'left' : 'right';
    }

    async detectHands() {
        if (!this.detector) return;

        // Only process every DETECTION_INTERVAL frames
        this.frameCount++;
        if (this.frameCount % DETECTION_INTERVAL !== 0) return;

        // Draw video to offscreen canvas with lower quality for better performance
        this.offctx.imageSmoothingEnabled = false;
        this.offctx.drawImage(this.video, 0, 0, OFF_W, OFF_H);

        // Detect hands
        try {
            this.hands = await this.detector.estimateHands(this.offscreen, {
                flipHorizontal: true
            });

            // Process each detected hand
            this.hands.forEach((hand, handIndex) => {
                // Detect handedness
                this.handedness[handIndex] = this.detectHandedness(hand);

                // Calculate and update hand size
                this.handSize[handIndex] = calculateZDist(hand);

                // Calculate and update pinch distance
                this.pinchDist[handIndex] = calculatePinchDistance(hand);

                // Calculate normalized pinch distance
                this.normPinchDist[handIndex] = normalizePinch(this.pinchDist[handIndex], this.handSize[handIndex]);

                // Calculate threshold as half of hand width
                const pinchThreshold = this.handSize[handIndex] / 2;
                
                // Use scaled threshold for detection
                if (this.pinchDist[handIndex] < pinchThreshold) {
                    const currentTime = Date.now();
                    
                    if (!this.pinchActive[handIndex] && (currentTime - this.lastPinchTime[handIndex] > DEBOUNCE_TIME)) {
                        // Set pinch as active and update time
                        this.pinchActive[handIndex] = true;
                        this.lastPinchTime[handIndex] = currentTime;
                    }
                } else {
                    // Reset pinch state when pinch is released
                    this.pinchActive[handIndex] = false;
                }
            });

            return this.hands;
        } catch (error) {
            console.error('Error detecting hands:', error);
        }
    }

    // Getter for pinch state
    getPinchState(handIndex) {
        return {
            isActive: this.pinchActive[handIndex],
            lastPinchTime: this.lastPinchTime[handIndex]
        };
    }

    // Getter for hand positions with handedness
    getHandPositions() {
        return this.hands.map((hand, index) => {
            if (!hand || !hand.keypoints) return null;
            const thumb = hand.keypoints[4];
            const indexFinger = hand.keypoints[8];
            const sx = this.leftHandCanvas.width / OFF_W;
            const sy = this.leftHandCanvas.height / OFF_H;
            return {
                thumb: { x: thumb.x * sx, y: thumb.y * sy },
                indexFinger: { x: indexFinger.x * sx, y: indexFinger.y * sy },
                handedness: this.handedness[index]
            };
        });
    }
} 