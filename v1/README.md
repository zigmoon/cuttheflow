# 🎬 CUT THE FLOW - Professional Online Video Editor

> **Modern, powerful online video editor with timeline editing, audio mixing, and professional export capabilities**

[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![Browser Support](https://img.shields.io/badge/Browser-Chrome%20%7C%20Edge%20%7C%20Firefox-green.svg)](https://cuttheflow.com)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-orange.svg)](https://cuttheflow.com)

> **Version 2 (Astro + Rust) : dépôt dédié — `zigmoon/cuttheflow`.**
> L'interface Astro et le moteur d'export Rust/ffmpeg y vivent à la racine
> (`astro/`, `rust/`), avec le README du produit, le workflow Windows / Linux /
> macOS et les binaires des trois systèmes. Les sources restent aussi ici, dans
> [`astro/`](astro/) et [`rust/`](rust/) ; voir
> [`V2-ASTRO-RUST.md`](V2-ASTRO-RUST.md) pour l'architecture et
> [`AUDIT-COMPLET-2026-10-20.md`](AUDIT-COMPLET-2026-10-20.md) pour l'audit.

## 🌟 What is CUT THE FLOW?

**CUT THE FLOW** is a professional-grade online video editor that runs entirely in your browser. No downloads, no installations, no accounts required. Just open and start creating.

### 🎯 Perfect For:
- Video content creators
- Social media managers
- YouTube creators
- Educators and trainers
- Marketing professionals
- Anyone who needs quick video editing

## ✨ Key Features

### 🎞️ Professional Timeline Editing
- **Multi-track timeline** with unlimited tracks
- **Drag & drop** media management
- **Precise cutting** and trimming
- **Snap-to-grid** functionality
- **Zoom controls** for detailed editing

### 🎵 Advanced Audio Mixing
- **Continuous audio** playback across cuts
- **Multi-track audio** support
- **Volume control** per clip
- **Audio synchronization**
- **Fade in/out** effects

### 💾 Export & Save
- **Exactly 3 export formats** (no mode tabs, no engine selection):
  - **MP4** — H.264 + AAC, the universal choice (iPhone, Android, TV, YouTube)
  - **WEBM** — VP9 + Opus, smaller files at equal quality
  - **MP3** — the timeline audio only (LAME 3.100, 48 kHz stereo 192 kbps)
- **Frame-accurate offline encoding**: every frame is decoded at its exact timeline position,
  so audio and video stay aligned and the output is identical on every machine 🆕
- **Custom resolutions**: 720p, 1080p, 1440p, 4K (per project aspect ratio)
- **Adjustable FPS**: native (from your source), 24, 30 or 60
- **Save/Load projects** — `.ctf` (project **+ media**, self-contained) or `.json` (lightweight,
  media referenced by URL). Both store the app version and your export format, so a project
  reopens with the same settings. 🆕
- **Auto-save reminders**

### ⚡ Performance
- **WebCodecs API** for modern browsers
- **GPU Acceleration** with automatic detection 🎮 🆕
- **Hardware acceleration** support for faster exports
- **4K/8K video support** with automatic proxy generation 🆕
- **Adaptive performance** based on your machine 🆕
- **Smart preview quality** (LOW/AUTO/FULL modes) 🆕
- **Efficient memory usage**
- **Background export** processing
- **No upload required** - everything local

### 🧪 Proven, not guessed 🆕
Exports are validated by an automated test bench (`tools/regression/`) that builds a
13-second / 5-track timeline (2 videos, 1 photo, 1 text, 1 shape, 2 audio tracks), exports it
in all three formats, saves and reloads the project, and checks the results with ffmpeg:
frame count, audio sync drift (**0 ms**), missing/dropped frames (**0**), black frames at cuts
(**none**), layer order, and pixel fidelity (**0/255 difference vs. the source**).

### 🎨 User Experience
- **Keyboard shortcuts** for power users
- **Undo/Redo** (50 states)
- **Copy/Paste clips**
- **Real-time preview**
- **Responsive design**
- **Dark theme** optimized

## 🎥 4K/8K Video Support (NEW!)

**CUT THE FLOW now handles high-resolution videos effortlessly!**

### Automatic Proxy Generation
When you import 4K or 8K videos, the system automatically creates lightweight preview versions (proxies) for smooth editing. Your final export always uses the original high-quality video.

### Three Quality Modes
- **LOW (720p)**: Best for slower machines - Maximum performance
- **AUTO**: Recommended - Adapts to your hardware automatically
- **FULL**: For powerful machines - No proxies, original quality preview

### How It Works
```
Import 4K video → Auto-generates 720p/1080p proxy → Edit smoothly → Export in 4K
```

### Performance Gains
- **400-500% faster** timeline playback with 4K videos
- **60-80% less GPU usage** during editing
- **Zero quality loss** in final export

**📖 See [PERFORMANCE_4K_GUIDE.md](PERFORMANCE_4K_GUIDE.md) for complete documentation**

## 🚀 Quick Start

## 🚀 Getting Started

### Option 1: Use Online (Recommended)
Visit **[cuttheflow.com](https://cuttheflow.com)** and start editing immediately. No installation required!

### Option 2: Self-Host
1. Clone or download this repository
2. Open `index.html` in a modern browser (Chrome, Edge, Firefox)
3. Start editing!

```bash
# Clone the repository
git clone https://github.com/yourusername/cuttheflow.git

# Open in browser
cd cuttheflow
# Then open index.html in your browser
```

### 🎮 Basic Usage

1. **Import Media**: Drag & drop video, audio, or image files
2. **Add to Timeline**: Drag media from library to timeline tracks
3. **Edit**: Cut, trim, move clips on the timeline
4. **Preview**: Use spacebar to play/pause
5. **Export**: Click "Export" button and choose your settings
6. **Save**: Click "Save" to export your project as JSON

### ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `Delete` | Delete selected clip |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+C` | Copy clip |
| `Ctrl+V` | Paste clip |
| `Ctrl+S` | Save project |
| `?` | Show all shortcuts |

---

## 📦 Package Contents

| File | Description |
|------|-------------|
| `js/app.js` | Main application (~10200 lines) |
| `js/export-safeguards.js` | RAM/crash guards for export |
| `js/optimized-export.js` | Optimized canvas frame loop |
| `js/webcodecs-export.js` | WebCodecs H.264 hardware export |
| `js/transmux-export.js` | MP4 transmux post-processing |
| `INTEGRATION_GUIDE.md` | Detailed integration guide |

---

## ✨ Problems Solved

### ❌ Before

```javascript
// Problem: Audio segmented by video cuts
// Result: Audio cuts, incorrect exports

const segments = buildSegments(allClips);
// Audio clips create cuts → ❌
```

### ✅ After

```javascript
// Solution: Clean segmentation
// Result: Continuous audio, perfect exports

const segments = buildCleanSegments(clips, timelineEnd);
// Only video/image create cuts → ✅
```

---

## 🎯 Features

### 1. Clean Segmentation ✅

**Principle:**
- ✅ Video and images create cuts
- ✅ Audio plays continuously
- ✅ Text doesn't create cuts

```javascript
// Segments based only on visual clips
const segments = exporter.buildCleanSegments(clips, timelineEnd, fps);

// Each segment contains:
// - visualClips[] : video/image/text
// - audioClips[]  : audio (continuous)
```

### 2. Modern Export ⚡

**WebCodecs API** (recommended)
```javascript
const exporter = new ModernExportEngine();
const blob = await exporter.export({
    clips: getAllClips(),
    tracks: tracks,
    timelineEnd: 60,
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 8_000_000,
    audioBitrate: 192_000
});
```

**MediaRecorder API** (fallback)
```javascript
const exporter = new SimplifiedExportEngine();
const blob = await exporter.exportWithMediaRecorder({
    clips: getAllClips(),
    tracks: tracks,
    timelineEnd: 60,
    width: 1920,
    height: 1080,
    fps: 30
});
```

### 3. Audio Extraction 🎵

**Manual:**
```javascript
const result = await audioExtractor.extractAudio(clip, tracks);
console.log('Track created:', result.audioTrack.name);
```

**Automatic with buttons:**
```javascript
// Adds 🎵 buttons on video clips
audioExtractor.startAutoInjection();
```

### 4. Utilities 🛠️

```javascript
// Smart automatic export
VideoUtilities.smartExport(tracks);

// Create export UI
VideoUtilities.createExportUI(container, (settings) => {
    // Callback when user clicks "Export"
});

// Download a blob
VideoUtilities.downloadBlob(blob, 'video.mp4');

// Format time
VideoUtilities.formatTime(125.5); // "2:05.50"

// Estimate file size
VideoUtilities.estimateFileSize(60, 8_000_000, 192_000);
```

---

## 🔧 Integration

### Option 1: Direct Replacement

```javascript
// Replace executeExport() :

async function executeExport() {
    try {
        const blob = await VideoUtilities.smartExport(tracks, {
            width: 1920,
            height: 1080,
            fps: 30
        });
        
        showStatus('Export complete!');
    } catch (error) {
        console.error('Export failed:', error);
        alert(error.message);
    }
}
```

### Option 2: Progressive Integration

```javascript
// Keep old function, add new one

async function executeExportModern() {
    // Check WebCodecs support
    if (ModernExportEngine.isSupported()) {
        const exporter = new ModernExportEngine();
        return await exporter.export({
            clips: getAllClips(),
            tracks: tracks,
            timelineEnd: getTimelineEnd(),
            width: 1920,
            height: 1080,
            fps: 30,
            onProgress: updateProgress,
            onStatus: showStatus
        });
    } else {
        // Fallback to old method
        return await executeExport();
    }
}
```

### Option 3: User Selection

```html
<!-- Selection button in UI -->
<select id="exportEngine">
    <option value="modern">Modern (WebCodecs)</option>
    <option value="legacy">Legacy (Original)</option>
    <option value="simple">Simple (MediaRecorder)</option>
</select>

<button onclick="exportWithSelected()">Export</button>
```

```javascript
async function exportWithSelected() {
    const engine = document.getElementById('exportEngine').value;
    
    switch (engine) {
        case 'modern':
            return await new ModernExportEngine().export({...});
        case 'simple':
            return await new SimplifiedExportEngine().exportWithMediaRecorder({...});
        case 'legacy':
            return await executeExportOriginal();
    }
}
```

---

## 📊 Performance Comparison

| Criteria | WebCodecs | MediaRecorder | Original |
|----------|-----------|---------------|----------|
| **Speed** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Quality** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Memory** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Compatibility** | Chrome 94+ | All | All |
| **Segmentation** | ✅ Clean | ✅ Clean | ❌ Buggy |
| **Continuous audio** | ✅ Yes | ✅ Yes | ❌ No |

**Real benchmarks:**
- 60s timeline, 1080p, 30fps
- WebCodecs: ~45 seconds
- MediaRecorder: ~90 seconds
- Original: ~180 seconds (with audio bugs)

---

## 🎮 GPU Acceleration (NEW!)

**CUT THE FLOW** now supports hardware-accelerated rendering using your graphics card!

### 🚀 Features
- **Automatic GPU detection** - Detects your graphics card
- **Toggle ON/OFF** - Enable/disable with one click
- **Performance boost** - Up to 2-3x faster exports
- **WebGL powered** - Uses WebGL 2.0 or WebGL 1.0
- **Smart fallback** - Automatically uses CPU if GPU unavailable

### 📖 How to Use

1. Click **Export** button
2. Scroll to **HARDWARE ACCELERATION** section
3. Click the 🎮 button to toggle GPU acceleration
4. Your GPU name will be displayed automatically

### 💡 When to Enable GPU?

✅ **Always enabled by default** for best performance  
✅ Export videos faster (2-3x speedup)  
✅ Works with NVIDIA, AMD, Intel GPUs  

❌ Disable if you experience visual artifacts  
❌ Disable on very old GPUs  

### 📚 Documentation

See [GPU-ACCELERATION-GUIDE.md](GPU-ACCELERATION-GUIDE.md) for:
- Complete technical details
- Troubleshooting guide
- Performance comparisons
- FAQ

### 🧪 Test Your GPU

Open `test-gpu-detection.html` to:
- Detect your GPU
- Run performance tests
- Check WebGL support

---

## 🌐 Browser Support

| Browser | WebCodecs | MediaRecorder | GPU Acceleration |
|---------|-----------|---------------|------------------|
| **Chrome 94+** | ✅ | ✅ | ✅ |
| **Edge 94+** | ✅ | ✅ | ✅ |
| **Safari 16.4+** | ✅ | ✅ | ✅ |
| **Firefox** | ❌ | ✅ | ✅ |
| **Opera** | ✅ | ✅ | ✅ |

**Automatic detection:**
```javascript
const engine = VideoUtilities.getRecommendedEngine();
// Returns: 'webcodecs', 'mediarecorder', or 'none'
```

---

## 🐛 Troubleshooting

### "WebCodecs not supported"

**Automatic solution:**
```javascript
// System automatically chooses MediaRecorder
await VideoUtilities.smartExport(tracks);
```

**Manual solution:**
```javascript
const exporter = new SimplifiedExportEngine();
await exporter.exportWithMediaRecorder({...});
```

### "Export too slow"

**Automatic optimization:**
```javascript
// smartExport() automatically adjusts quality
const optimal = VideoUtilities.getOptimalSettings(clips, timelineEnd);
console.log('Settings:', optimal);
// Long timeline → quality automatically reduced
```

**Manual optimization:**
```javascript
// Reduce resolution
width: 1280, height: 720  // instead of 1920x1080

// Reduce FPS
fps: 25  // instead of 30

// Reduce bitrate
videoBitrate: 4_000_000  // instead of 8_000_000
```

### "Insufficient memory"

**Solution: Export in chunks**
```javascript
// Split into multiple exports
const chunkDuration = 60; // 60s per chunk
const chunks = Math.ceil(timelineEnd / chunkDuration);

for (let i = 0; i < chunks; i++) {
    const start = i * chunkDuration;
    const end = Math.min(start + chunkDuration, timelineEnd);
    
    const blob = await exporter.export({
        clips: clipsInRange(start, end),
        timelineEnd: end - start,
        ...settings
    });
    
    VideoUtilities.downloadBlob(blob, `part_${i + 1}.mp4`);
}
```

### "Audio out of sync"

**Verification:**
```javascript
// Make sure sample rate is correct
const settings = {
    audioSampleRate: 48000,  // ALWAYS 48000
    // NOT 44100 or other value
};
```

---

## 📖 Complete Documentation

For more details, see:
- [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) - Complete guide (90+ examples)
- [export-demo.html](./export-demo.html) - Interactive demo

---

## 💡 Usage Examples

### Example 1: Simple Export

```javascript
// Simplest possible
const blob = await VideoUtilities.smartExport(tracks);
// That's it! File downloads automatically
```

### Example 2: Custom Export

```javascript
const exporter = new ModernExportEngine();

const blob = await exporter.export({
    clips: getAllClips(),
    tracks: tracks,
    timelineEnd: getTimelineEnd(),
    
    // Resolution
    width: 1920,
    height: 1080,
    
    // Performance
    fps: 30,
    videoBitrate: 8_000_000,
    audioBitrate: 192_000,
    
    // Callbacks
    onProgress: (percent) => {
        console.log(`${percent.toFixed(1)}%`);
    },
    onStatus: (message) => {
        console.log(message);
    }
});

// Download
VideoUtilities.downloadBlob(blob, 'my-video.mp4');
```

### Example 3: Export with UI

```javascript
// Create automatic user interface
const container = document.getElementById('exportPanel');

VideoUtilities.createExportUI(container, async (settings) => {
    console.log('Starting export with:', settings);
    
    const blob = await VideoUtilities.smartExport(tracks, settings);
    
    alert('Export complete!');
});
```

### Example 4: Auto HD/SD Export

```javascript
// System automatically chooses
// - HD for short timelines (< 10 min)
// - SD for long timelines (> 10 min)
// - Reduced quality for very long (> 30 min)

const blob = await VideoUtilities.smartExport(tracks);
```

### Example 5: Export with Estimation

```javascript
const timelineEnd = getTimelineEnd();
const fps = 30;

// Estimate before exporting
const estimatedTime = VideoUtilities.estimateExportTime(timelineEnd, fps, true);
const estimatedSize = VideoUtilities.estimateFileSize(timelineEnd, 8_000_000, 192_000);

console.log(`Estimated time: ${VideoUtilities.formatTime(estimatedTime / 1000)}`);
console.log(`Estimated size: ${VideoUtilities.formatBytes(estimatedSize)}`);

if (confirm(`Export will take ~${Math.ceil(estimatedTime / 60000)} minutes. Continue?`)) {
    await VideoUtilities.smartExport(tracks);
}
```

---

## 🎓 Technical Architecture

### Segmentation

```
Timeline: [0s ────────────────── 10s]

Clips:
  VIDEO 1:  [0s ─── 5s]
  VIDEO 2:       [3s ───── 8s]
  AUDIO:    [0s ──────────── 10s]  ← Continuous, doesn't create cuts

Generated segments:
  Seg 0: [0s ─ 3s]  Video1 + Audio
  Seg 1: [3s ─ 5s]  Video1 + Video2 + Audio
  Seg 2: [5s ─ 8s]  Video2 + Audio
  Seg 3: [8s ─ 10s] Audio only
```

### Export Pipeline

```
1. buildCleanSegments()
   ↓ Analyze clips, create segments
   
2. renderAudioTrack() [OfflineAudioContext]
   ↓ Complete audio mixdown at once
   
3. setupVideoEncoder()
   ↓ WebCodecs configuration
   
4. encodeSegments()
   ↓ Render + encode each frame
   
5. finalize()
   ↓ Flush encoders
   
6. downloadBlob()
   ↓ File download
```

---

## 🔒 Security & Performance

### Memory Limits

```javascript
// Automatic protection against memory overflow
const MAX_CHUNK_SIZE = 500 * 1024 * 1024; // 500 MB

// If exceeded → export automatically stopped
```

### Timeouts

```javascript
// Global timeout to avoid infinite exports
const EXPORT_TIMEOUT = 30 * 60 * 1000; // 30 minutes max
```

### Optimized Cache

```javascript
// Images/videos are cached to avoid reloading
const mediaCache = new Map();

// Automatic cleanup after export
exporter.cleanup();
```

---

## 📝 Changelog

### Version 2.0 (Current)

✅ Clean segmentation (continuous audio)  
✅ WebCodecs API support  
✅ MediaRecorder fallback  
✅ Audio extraction  
✅ Smart export  
✅ UI utilities  
✅ Optimized performance  

### Version 1.0 (Original)

❌ Segmented audio (bugs)  
❌ Limited performance  
❌ No audio extraction  
❌ Complex code  

---

## 🤝 Support

### Getting Help

1. Check the [complete documentation](./INTEGRATION_GUIDE.md)
2. Test with the [demo](./export-demo.html)
3. Enable debug logs:

```javascript
window.DEBUG_EXPORT = true;
```

4. Check browser console (F12)

### Common Issues

| Problem | Solution |
|---------|----------|
| Export fails | Check console for detailed errors |
| Audio out of sync | Use `audioSampleRate: 48000` |
| Too slow | Reduce resolution/FPS or use WebCodecs |
| No support | Automatic fallback to MediaRecorder |

---

## 🌐 Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome 94+ | ✅ Full | WebCodecs support |
| Edge 94+ | ✅ Full | WebCodecs support |
| Firefox 90+ | ⚠️ Limited | MediaRecorder fallback |
| Safari 16+ | ⚠️ Limited | MediaRecorder fallback |

### Required Browser Features
- **HTML5 Video/Audio**
- **FileReader API**
- **Blob/URL APIs**
- **Canvas API**
- **WebCodecs API** (optional, for best performance)

---

## 🔧 Technical Stack

### Core Technologies
- **Pure JavaScript** (ES6+)
- **HTML5 Canvas** for rendering
- **WebCodecs API** for modern export
- **MediaRecorder API** for fallback
- **Web Audio API** for audio mixing
- **IndexedDB** for project storage (future)

### Architecture
```
CUT THE FLOW/
├── index.html              # Main application
├── css/
│   └── style.css          # All styling
├── js/
│   ├── app.js             # Main CutTheFlow class (~10200 lines)
│   ├── export-safeguards.js  # RAM/crash guards
│   ├── optimized-export.js   # Canvas frame loop
│   ├── webcodecs-export.js   # WebCodecs H.264 export
│   └── transmux-export.js    # MP4 transmux
├── manifest.json          # PWA manifest
├── service-worker.js      # PWA offline
└── README.md              # This file
```

### Performance Optimizations
- Hardware-accelerated rendering
- Efficient memory management
- Web Workers for background processing
- Lazy loading of media files
- Optimized canvas rendering

---

## 📊 SEO & Marketing

### Target Keywords
- **Primary**: online video editor, browser video editor, timeline editor
- **Secondary**: video editing tool, web video editor, NLE, frame-accurate export
- **Long-tail**: online video editor with timeline, edit videos in browser, no download video editor, MP4 WebM MP3 export

### Meta Information
Complete SEO optimization with:
- ✅ Title tags (55-60 characters)
- ✅ Meta descriptions (150-160 characters)
- ✅ Open Graph tags (social sharing)
- ✅ Twitter Card tags
- ✅ Structured data (Schema.org)
- ✅ Sitemap.xml
- ✅ Robots.txt
- ✅ Humans.txt
- ✅ Canonical URLs

### Features for SEO
- Fast loading time (< 3s)
- Mobile responsive
- Semantic HTML5
- Accessibility (WCAG 2.1)
- Progressive Web App (PWA)
- HTTPS ready
- No external dependencies (privacy)

---

## 📈 Analytics & Monitoring

### Recommended Tracking
```javascript
// Google Analytics 4 (optional)
gtag('event', 'video_export', {
  'resolution': '1920x1080',
  'duration': 60,
  'format': 'webm'
});

// Custom events
window.addEventListener('export_complete', (e) => {
  console.log('Export completed:', e.detail);
});
```

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### Development Setup
```bash
# 1. Fork the repository
# 2. Clone your fork
git clone https://github.com/yourusername/cuttheflow.git

# 3. Create a branch
git checkout -b feature/your-feature

# 4. Make changes and commit
git commit -am "Add your feature"

# 5. Push and create PR
git push origin feature/your-feature
```

### Areas for Contribution
- 🐛 Bug fixes
- ✨ New features
- 📚 Documentation improvements
- 🌍 Translations
- 🎨 UI/UX enhancements
- ⚡ Performance optimizations

---

## 📄 License

**Proprietary license — all rights reserved.** CUT THE FLOW is not open source.
See the full text in [LICENSE](LICENSE).

Copyright (c) 2026 Simon Dupont (Zigmoon). All rights reserved.

The Software is the exclusive property of its author. You may **use** the hosted web
application and you **own everything you produce with it** (your media, your exported videos).
You may **not** copy, redistribute, resell, host, modify, create derivative works from, or
reuse the Software (or any part of it) without written permission — including using it to
build or train a competing product, or removing the copyright notices.

Commercial licensing, custom builds, white-labelling and partnerships: **contact@zigmoon.com**

Third-party libraries bundled in `vendor/` (JSZip, MP4Box.js, lamejs) and the fonts keep their
own licenses, which prevail over this one for the parts they cover.

---

## 🎯 Quick Summary

**CUT THE FLOW is:**
- ✅ Runs entirely in the browser — no installation or download required
- ✅ Privacy-first (no cloud uploads, no account)
- ✅ Professional-grade features, frame-accurate export
- ✅ Fast and responsive
- ✅ Works offline (PWA)
- ✅ Proprietary software — all rights reserved by the author

**Installation:**
All scripts are loaded in `index.html`. No build step required.

**That's it! 🎉**

---

**Last update:** November 2024  
**Version:** 2.0.0  
**Compatibility:** Chrome 94+, Edge 94+, Safari 16.4+, Firefox (fallback)
