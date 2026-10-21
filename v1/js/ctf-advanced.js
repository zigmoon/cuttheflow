/**
 * CUT THE FLOW — Advanced Features Module
 * ========================================
 * Patches CutTheFlow.prototype with:
 *   1. Real audio waveforms + silence detection
 *   2. Blob URL centralization (_revokeUrl, _safeGetContext)
 *   3. Temporal clip index for O(log n) preview lookup
 *   4. Clip transitions (crossfade, wipe, fadeToBlack)
 *   5. Auto-subtitles via Web Speech API
 *
 * Load AFTER app.js in index.html. All methods are added to the prototype
 * so existing code paths are unaffected until explicitly called.
 */
(function () {
  if (typeof CutTheFlow === 'undefined') return;

  const CTF = CutTheFlow.prototype;

  // ═══════════════════════════════════════════════════════════════════
  // 1. SAFE BLOB URL REVOCATION
  // ═══════════════════════════════════════════════════════════════════
  CTF._revokeUrl = function (url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch (_) {}
  };

  CTF._safeGetContext = function (canvas, opts) {
    if (!canvas) return null;
    let ctx = null;
    if (opts) { try { ctx = canvas.getContext('2d', opts); } catch (_) {} }
    if (!ctx) { try { ctx = canvas.getContext('2d', { alpha: false }); } catch (_) {} }
    if (!ctx) { try { ctx = canvas.getContext('2d'); } catch (_) {} }
    return ctx;
  };

  // ═══════════════════════════════════════════════════════════════════
  // 2. AUDIO WAVEFORMS + SILENCE DETECTION
  // ═══════════════════════════════════════════════════════════════════
  CTF._getDecodeAudioContext = function () {
    if (!this.__decodeAudioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.__decodeAudioCtx = new AC(); } catch (_) { return null; }
    }
    return this.__decodeAudioCtx;
  };

  CTF.generateWaveform = async function (media) {
    if (!media || (media.type !== 'audio' && media.type !== 'video')) return;
    if (media.waveform && media.waveform.peaks && media.waveform.peaks.length) return;
    if (!media.file) return;

    const ctx = this._getDecodeAudioContext();
    if (!ctx) return;

    try {
      const arrayBuf = await media.file.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
      const duration = audioBuf.duration || media.duration || 0;
      if (!duration || !isFinite(duration)) return;

      const PEAKS_PER_SECOND = 60;
      const MAX_PEAKS = 12000;
      const totalPeaks = Math.min(MAX_PEAKS, Math.max(1, Math.ceil(duration * PEAKS_PER_SECOND)));
      const peaksPerSecond = totalPeaks / duration;
      const chCount = audioBuf.numberOfChannels;
      const frameCount = audioBuf.length;
      const samplesPerPeak = Math.max(1, Math.floor(frameCount / totalPeaks));

      const channels = [];
      for (let c = 0; c < chCount; c++) channels.push(audioBuf.getChannelData(c));

      const peaks = new Array(totalPeaks).fill(0);
      for (let p = 0; p < totalPeaks; p++) {
        const start = p * samplesPerPeak;
        const end = Math.min(frameCount, start + samplesPerPeak);
        let max = 0;
        for (let i = start; i < end; i++) {
          for (let c = 0; c < chCount; c++) {
            const a = channels[c][i] < 0 ? -channels[c][i] : channels[c][i];
            if (a > max) max = a;
          }
        }
        peaks[p] = max;
      }

      let globalMax = 0;
      for (let p = 0; p < totalPeaks; p++) if (peaks[p] > globalMax) globalMax = peaks[p];
      if (globalMax > 0.0001) {
        const inv = 1 / globalMax;
        for (let p = 0; p < totalPeaks; p++) peaks[p] = Math.min(1, peaks[p] * inv);
      }

      media.waveform = { peaks, peaksPerSecond, duration };
      media.silences = CTF._detectSilences(peaks, peaksPerSecond);
      console.log('〰️ waveform for ' + media.name + ' (' + totalPeaks + ' peaks, ' + media.silences.length + ' silences)');
    } catch (e) {
      console.warn('Waveform decode failed:', media.name, e);
      media.waveform = null;
    }
  };

  CTF._detectSilences = function (peaks, peaksPerSecond, thresh, minDur) {
    thresh = thresh || 0.06;
    minDur = minDur || 0.35;
    const silences = [];
    const minPeaks = Math.max(1, Math.round(minDur * peaksPerSecond));
    let runStart = -1;
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i] < thresh) {
        if (runStart === -1) runStart = i;
      } else if (runStart !== -1) {
        if (i - runStart >= minPeaks) silences.push({ start: runStart / peaksPerSecond, end: i / peaksPerSecond });
        runStart = -1;
      }
    }
    if (runStart !== -1 && peaks.length - runStart >= minPeaks) {
      silences.push({ start: runStart / peaksPerSecond, end: peaks.length / peaksPerSecond });
    }
    return silences;
  };

  CTF._drawClipWaveform = function (clipEl, clip, media) {
    if (!this.prefs || !this.prefs.showWaveform) return;
    const wf = media && media.waveform;
    if (!wf || !wf.peaks || !wf.peaks.length) return;

    const isVideo = clip.type === 'video';
    const clipPx = Math.max(4, clip.duration * this.zoomLevel);
    const canvas = document.createElement('canvas');
    canvas.className = 'clip-waveform' + (isVideo ? ' clip-waveform-video' : '');
    const cssW = Math.round(clipPx);
    const cssH = isVideo ? 16 : 30;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const peaks = wf.peaks;
    const pps = wf.peaksPerSecond;
    const srcStart = clip.sourceStart || 0;
    const mid = cssH / 2;

    ctx.fillStyle = isVideo ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.8)';
    const cols = cssW;
    for (let x = 0; x < cols; x++) {
      const tSec = srcStart + (x / cssW) * clip.duration;
      const pi = Math.floor(tSec * pps);
      const amp = (pi >= 0 && pi < peaks.length) ? peaks[pi] : 0;
      const h = Math.max(0.5, amp * (cssH - 2));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }

    if (isVideo) clipEl.appendChild(canvas);
    else clipEl.insertBefore(canvas, clipEl.firstChild);
  };

  // Hook into handleFiles to auto-generate waveforms on import
  const _origHandleFiles = CTF.handleFiles;
  CTF.handleFiles = async function (files) {
    await _origHandleFiles.call(this, files);
    // Generate waveforms for newly imported audio/video media
    const promises = [];
    for (const file of files) {
      const media = this.mediaLibrary.find(function (m) { return m.name === file.name && m.file && m.file.size === file.size; });
      if (media && (media.type === 'audio' || media.type === 'video') && media.waveform === undefined) {
        media.waveform = null;
        promises.push(this.generateWaveform(media));
      }
    }
    if (promises.length) {
      Promise.all(promises).then(function () {
        if (this.renderTracks) this.renderTracks();
      }.bind(this));
    }
  };

  // Hook into createClipElement to draw waveforms
  const _origCreateClipElement = CTF.createClipElement;
  CTF.createClipElement = function (clip) {
    const el = _origCreateClipElement.call(this, clip);
    const media = this._mediaMap ? this._mediaMap.get(clip.mediaId) : this.mediaLibrary.find(function (m) { return m.id === clip.mediaId; });
    if ((clip.type === 'audio' || clip.type === 'video') && media && media.waveform) {
      this._drawClipWaveform(el, clip, media);
    }
    return el;
  };

  // ═══════════════════════════════════════════════════════════════════
  // 3. TEMPORAL CLIP INDEX (O(log n) lookup)
  // ═══════════════════════════════════════════════════════════════════
  CTF._rebuildClipIndex = function () {
    this._clipIndex = [];
    for (var i = 0; i < this.tracks.length; i++) {
      var track = this.tracks[i];
      if (!track || track.muted || track._effectiveMute) continue;
      if (!track.clips || !Array.isArray(track.clips)) continue;
      for (var j = 0; j < track.clips.length; j++) {
        var clip = track.clips[j];
        this._clipIndex.push({ startTime: clip.startTime, endTime: clip.startTime + clip.duration, clip: clip, trackIndex: i });
      }
    }
    this._clipIndex.sort(function (a, b) { return a.startTime - b.startTime; });
  };

  CTF._getClipsAtTime = function (time) {
    if (!this._clipIndex) this._rebuildClipIndex();
    var idx = this._clipIndex;
    var videoClip = null;
    var videoTrackIndex = -1;
    var overlays = [];

    var lo = 0, hi = idx.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (idx[mid].startTime - (this.TIME_EPSILON || 0.0001) <= time) lo = mid + 1;
      else hi = mid;
    }
    for (var i = lo - 1; i >= 0; i--) {
      var entry = idx[i];
      if (entry.endTime + (this.TIME_EPSILON || 0.0001) < time) break;
      if (time >= entry.startTime - (this.TIME_EPSILON || 0.0001) && time < entry.endTime + (this.TIME_EPSILON || 0.0001)) {
        var clip = entry.clip;
        if ((clip.type === 'video' || clip.type === 'image') && !videoClip) {
          videoClip = clip;
          videoTrackIndex = entry.trackIndex;
        } else if (clip.type === 'text' || clip.type === 'block') {
          overlays.push({ clip: clip, trackIndex: entry.trackIndex });
        }
      }
    }
    return { videoClip: videoClip, videoTrackIndex: videoTrackIndex, overlays: overlays };
  };

  // Hook fullRefresh to rebuild index
  var _origFullRefresh = CTF.fullRefresh;
  CTF.fullRefresh = function () {
    this._rebuildClipIndex();
    return _origFullRefresh.call(this);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 4. CLIP TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════
  CTF._applyTransitionMask = function (ctx, clip, t, w, h) {
    var trans = clip.transition;
    if (!trans || trans === 'none') return;
    var elapsed = t - clip.startTime;
    var dur = clip.transitionDuration || 0.5;
    if (elapsed >= dur) return;
    var progress = Math.max(0, Math.min(1, elapsed / dur));
    var e = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    ctx.save();
    switch (trans) {
      case 'crossfade': break;
      case 'fadeToBlack':
      case 'fadeFromBlack':
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#000';
        ctx.globalAlpha = 1 - e;
        ctx.fillRect(0, 0, w, h);
        break;
      case 'wipeLeft':
        ctx.beginPath();
        ctx.rect(0, 0, e * w, h);
        ctx.clip();
        break;
      case 'wipeRight':
        ctx.beginPath();
        ctx.rect(w - e * w, 0, e * w, h);
        ctx.clip();
        break;
    }
    ctx.restore();
  };

  // ═══════════════════════════════════════════════════════════════════
  // 5. AUTO-SUBTITLES (Web Speech API)
  // ═══════════════════════════════════════════════════════════════════
  CTF.generateSubtitles = async function (clip) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this.showStatus('⚠️ Speech Recognition not available (use Chrome/Edge)', 'error'); return; }
    if (!clip || (clip.type !== 'video' && clip.type !== 'audio')) return;
    var media = this.mediaLibrary.find(function (m) { return m.id === clip.mediaId; });
    if (!media || !media.file) { this.showStatus('⚠️ No audio source', 'error'); return; }

    this.showStatus('🎤 Generating subtitles...', 'info');
    var subs = [];
    var recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'fr-FR';

    var startTime = 0;
    recognition.onresult = function (event) {
      var now = performance.now();
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) {
          var text = result[0].transcript.trim();
          if (text) {
            subs.push({ start: Math.max(0, (now - startTime) / 1000), end: (now - startTime) / 1000 + 2, text: text });
          }
        }
      }
    };
    recognition.onerror = function (e) { console.warn('Speech error:', e.error); };

    try {
      var audioCtx = this._getDecodeAudioContext();
      if (!audioCtx) throw new Error('No AudioContext');
      var arrayBuf = await media.file.arrayBuffer();
      var audioBuf = await audioCtx.decodeAudioData(arrayBuf.slice(0));
      var source = audioCtx.createBufferSource();
      source.buffer = audioBuf;
      var dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      source.connect(audioCtx.destination);

      startTime = performance.now();
      recognition.start();
      source.start(0);

      await new Promise(function (resolve) {
        source.onended = function () { try { recognition.stop(); } catch (_) {} resolve(); };
        setTimeout(function () { try { recognition.stop(); } catch (_) {} resolve(); }, (audioBuf.duration + 3) * 1000);
      });

      // Merge adjacent duplicates
      var merged = [];
      for (var s = 0; s < subs.length; s++) {
        if (merged.length > 0 && subs[s].text === merged[merged.length - 1].text) {
          merged[merged.length - 1].end = subs[s].end;
        } else {
          merged.push({ start: subs[s].start, end: subs[s].end, text: subs[s].text });
        }
      }

      clip.subtitles = merged;
      clip.subtitleEnabled = merged.length > 0;
      this.showStatus('✅ ' + merged.length + ' subtitles generated');
      if (this.renderProperties) this.renderProperties();
      if (this.updatePreview) this.updatePreview();
    } catch (e) {
      console.error('Subtitle failed:', e);
      this.showStatus('❌ Subtitle generation failed', 'error');
    }
  };

  // Hook updatePreview to show subtitles overlay
  var _origUpdatePreview = CTF.updatePreview;
  CTF.updatePreview = function () {
    _origUpdatePreview.call(this);
    // Show active subtitle for the current clip
    var clip = this._currentPreviewClip;
    var subEl = document.getElementById('subtitleOverlay');
    if (!subEl) return;
    if (clip && clip.subtitleEnabled && clip.subtitles && clip.subtitles.length) {
      var clipTime = this.currentTime - clip.startTime;
      var activeSub = null;
      for (var i = 0; i < clip.subtitles.length; i++) {
        if (clipTime >= clip.subtitles[i].start && clipTime < clip.subtitles[i].end) {
          activeSub = clip.subtitles[i];
          break;
        }
      }
      if (activeSub) {
        subEl.textContent = activeSub.text;
        subEl.style.display = 'block';
      } else {
        subEl.style.display = 'none';
      }
    } else {
      subEl.style.display = 'none';
    }
  };

  console.log('✅ CUT THE FLOW Advanced Features loaded (waveforms, transitions, subtitles, perf index)');
})();
