// Hand Tracking Configuration
export const MODEL_TYPE = 'full';  // 'lite' for speed, 'full' for accuracy
export const MAX_HANDS = 2;        // number of hands to detect
export const OFF_W = 256;          // reduced processing width for better performance
export const OFF_H = 192;          // reduced processing height for better performance
export const DETECTION_INTERVAL = 5; // process every 3 frames

// Pinch detection configuration
export const SMOOTHING_WINDOW_SIZE = 5; // Size of the smoothing window
export const DEBOUNCE_TIME = 300; // Debounce time in milliseconds
export const FLASH_DURATION = 200; // Flash duration in milliseconds
export const Z_DIST_SCALE = 1; // Scale factor for z-distance based calculations
export const FIXED_PINCH_THRESHOLD = 25; // Base threshold for pinch detection in pixels
export const SCALE_FACTOR = 0.5; // Factor to scale the direct relationship

export async function setupBackend() {
    await tf.setBackend('webgl');
    await tf.ready();
}

export async function setupCamera(videoElement) {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    });
    videoElement.srcObject = stream;
    await new Promise(r => videoElement.onloadedmetadata = r);
    videoElement.play();
    return videoElement;
}


//was solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
export async function createDetector() {
    return handPoseDetection.createDetector(
        handPoseDetection.SupportedModels.MediaPipeHands,
        {
            runtime: 'mediapipe',
            solutionPath: 'lib/mediapipe/hands',
            modelType: MODEL_TYPE,
            maxHands: MAX_HANDS
        }
    );
}

// Helper function to calculate smoothed value from buffer
export function getSmoothedValue(buffer) {
    if (buffer.length === 0) return 0;
    return buffer.reduce((sum, val) => sum + val, 0) / buffer.length;
}

// Helper function to update buffer with new value
export function updateBuffer(buffer, value) {
    buffer.push(value);
    if (buffer.length > SMOOTHING_WINDOW_SIZE) {
        buffer.shift();
    }
}

//measure how big the hand is in the image and use this as an approximation
//for closeness to the camera, ie position along the z-axis.
export function calculateZDist(hand) {
    if (!hand || !hand.keypoints) return 0;

    // Use wrist (0), index finger base (5), and pinky base (17) to estimate hand size
    const wrist = hand.keypoints[0];
    const indexBase = hand.keypoints[5];
    const pinkyBase = hand.keypoints[17];

    // Calculate average distance from wrist to finger bases
    const dist1 = Math.sqrt(
        Math.pow(wrist.x - indexBase.x, 2) +
        Math.pow(wrist.y - indexBase.y, 2)
    );
    const dist2 = Math.sqrt(
        Math.pow(wrist.x - pinkyBase.x, 2) +
        Math.pow(wrist.y - pinkyBase.y, 2)
    );

    return (dist1 + dist2) / 2;
}

// Helper function to calculate pinch distance
export function calculatePinchDistance(hand) {
    if (!hand || !hand.keypoints) return Infinity;

    // Use thumb tip (4) and index finger tip (8)
    const thumb = hand.keypoints[4];
    const index = hand.keypoints[8];

    return Math.sqrt(
        Math.pow(thumb.x - index.x, 2) +
        Math.pow(thumb.y - index.y, 2)
    );
} 