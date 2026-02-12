// Import VideoProcessor
import { VideoProcessor } from './videoProcessor.js';

// Configuration
const GRID_SIZE = 4; // Change this value to set grid size (e.g., 3 for 3x3, 5 for 5x5)

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('video');
    const gridCanvas = document.getElementById('gridCanvas');
    const handCanvas = document.getElementById('handCanvas');
    const canvas = document.getElementById('canvas');
    const shaderOverlayCanvas = document.getElementById('shaderOverlayCanvas');
    const rightHandCanvas = document.getElementById('rightHandCanvas');

    const videoProcessor = new VideoProcessor(video, gridCanvas, handCanvas, canvas, shaderOverlayCanvas, rightHandCanvas, GRID_SIZE);
}); 