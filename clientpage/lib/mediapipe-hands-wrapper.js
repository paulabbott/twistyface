// Wrapper to expose MediaPipe Hands in the format expected by hand-pose-detection
// This ensures Hands is available as a constructor when hand-pose-detection loads
(function() {
    // Ensure Hands is available on globalThis (hand-pose-detection expects it there)
    if (typeof Hands !== 'undefined') {
        // Expose Hands on globalThis
        if (typeof globalThis !== 'undefined') {
            globalThis.Hands = Hands;
        }
        // Also ensure it's on window for compatibility
        if (typeof window !== 'undefined') {
            window.Hands = Hands;
        }
        // Create a namespace structure that hand-pose-detection might expect
        // Some versions expect @mediapipe/hands structure
        if (typeof globalThis !== 'undefined' && !globalThis.mediapipe) {
            globalThis.mediapipe = {};
        }
        if (typeof globalThis !== 'undefined' && globalThis.mediapipe) {
            globalThis.mediapipe.hands = { Hands: Hands };
        }
    } else {
        console.error('MediaPipe Hands not found. Make sure hands.js is loaded before this wrapper.');
    }
})();
