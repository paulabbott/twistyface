# Twistyface

Hand gestures in the browser rotate grid squares, driving Max dials in real time.

![Demo](twistyface_demo.gif)

Twistyface transforms your hand movements into real-time control signals for Max/MSP. Stand in front of your webcam and use simple pinch gestures to manipulate a visual grid that directly controls parameters in your Max patch.

**Video demonstrations:**
- https://youtu.be/g888f3yPpzQ
- https://youtu.be/-fIg5q0av5s
- https://youtu.be/EIoZLmQJgnY

*Note: Resolution and framerate in the demo videos have been negatively affected by screencapture.*

**How to use it:**
- Position yourself so your hands are visible in the camera view
- Make a pinch gesture (thumb and index finger together) over any square in the 4×4 grid
- Your right hand rotates squares clockwise; your left hand rotates them counter-clockwise
- Each rotation sends control data to Max/MSP, allowing you to modulate sound, visuals, or any parameter you've mapped
- Press `r` to reset all rotations, `h` to hide/show the debug view, or `v` to toggle video display modes

### Architecture Overview

Twistyface consists of two main components:
1. **Web Client** (`clientpage/`) - Hand tracking, grid visualization, and WebGL rendering
2. **Max/MSP Server** (`n4m.twistyface.js`) - Node.js bridge that receives rotation data and routes it to Max objects

### Web Client Components

**Hand Tracking** (`js/handTracker.js`, `js/handTracking.js`)
- Uses MediaPipe Hand Pose Detection via TensorFlow.js


- Determines handedness (left/right) using cross-product analysis of wrist-to-thumb and wrist-to-pinky vectors
- Normalizes pinch detection based on hand size and z-distance for consistent behavior across camera distances

**Grid Management** (`js/gridManager.js`)

- Tracks rotation state for each cell (current rotation angle, cumulative rotation)
- Handles cell rotation: 10° increments per pinch gesture, direction based on handedness
- Implements smooth exponential decay reset (configurable duration, typically 1.5-8 seconds)
- Quantizes rotations into discrete steps (10° per step) for delta-based messaging to Max
- Sends rotation data via HTTP POST to `localhost:2112` when cells rotate

**Video Processing** (`js/videoProcessor.js`)
- Manages webcam stream capture and canvas setup
- Coordinates hand tracking, grid management, and WebGL rendering

**WebGL Rendering** (`js/webglContext.js`, shader code in `videoProcessor.js`)
- Applies grid rotations to the video feed using fragment shaders
- Color saturation increases with cumulative rotation (0-200% saturation over 3 full rotations)
- Rest of image is desaturated to grayscale for visual contrast
- Mirrors video horizontally for natural interaction

**Communication Protocol**
- Sends JSON payloads to `http://localhost:2112` with structure:
  ```json
  {
    "row": 0-3,
    "col": 0-3,
    "currentRotation": <radians>,
    "cumulativeRotation": <radians>,
    "timestamp": <ms>,
    "message": "r<row> c<col> <rotation>",
    "DeltaMsg": "r<row> c<col> <stepDelta>"
  }
  ```
- Delta messages use integer step counts (±1 per 10° rotation) for efficient Max integration
- Messages sent immediately when rotation changes, not on a fixed interval

### Max/MSP Server

**Node.js Bridge** (`n4m.twistyface.js`)
- HTTP server listening on port 2112
- Serves static files from `clientpage/` directory (HTML, JS, CSS, libraries)
- Receives POST requests with rotation data
- Parses JSON and outputs to Max via `maxAPI.outlet()`
- Uses Node for Max (n4m) to bridge JavaScript and Max runtime

**Max Patch** (`twistyface.maxpat`)
- Contains `node.script` object running `n4m.twistyface.js`
- Receives rotation data and routes to Max objects (typically dials, sliders, or custom objects)
- Grid cells map to Max controls: `r<row> c<col>` format identifies which control to update

**Dependencies:**
- TensorFlow.js (`lib/tfjs.min.js`)
- MediaPipe Hand Pose Detection (`lib/hand-pose-detection.min.js`)
- Node for Max (n4m) - Max/MSP package
- Native browser APIs: WebGL, Canvas 2D, MediaDevices (getUserMedia)
