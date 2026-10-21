// ============================================
        // APPLICATION CLASS
        // ============================================
        class CutTheFlow {
            constructor() {
                // Constants
                this.TRACK_HEADER_WIDTH = 120; // Width of track header
                this.SNAP_THRESHOLD = 0.3; // Snap within 0.3 seconds (300ms)
                this.MAX_TIMELINE = 3 * 60 * 60; // Maximum 3 hours (10800 seconds)
                this.TIME_PRECISION = 10000; // 0.0001s precision for perfect cuts
                this.TIME_EPSILON = 1 / 10000; // 0.0001s — tolerance for floating-point boundary checks
                this._fxFilter = ''; // Active FX CSS filter string (combined with color grading)
                this._pixelateRaf = null; // rAF handle for pixelate preview loop
                
                // State
                this.mediaLibrary = [];
                this.tracks = [];
                this.selectedClip = null;
                // Shift+click multi-selection on the timeline. Always contains
                // selectedClip.id when selectedClip is set, plus any additional
                // clips the user has shift-added. Used for group drag and group delete.
                this.selectedClipIds = new Set();
                this.currentTime = 0;
                this.isPlaying = false;
                this.zoomLevel = 100; // pixels per second
                this.mediaIdCounter = 1;
                this.trackIdCounter = 1;
                this.clipIdCounter = 1;
                this.draggedMedia = null;
                this.draggedClip = null;
                this.resizingClip = null;
                this.selectedResolution = '1920x1080';
                this.selectedAspectRatio = '16:9'; // Project aspect ratio
                this.selectedFps = 30;
                // 🎬 Format d'export : c'est désormais LA seule décision d'export (le moteur
                // en découle via _exportEngineFor()). On le persiste donc :
                //   • dans localStorage  → survit à un rechargement de page
                //   • dans les .ctf/.json → survit au partage du projet
                this.selectedFormat = 'mp4';
                this._restoreSelectedFormat();
                // Le moteur découle du format : on le dérive ici pour que `selectedEncoder`
                // ne soit jamais `undefined` avant la première ouverture de la popin.
                this.selectedEncoder = this._exportEngineFor(this.selectedFormat);
                this.useGpuAcceleration = true; // Hardware acceleration
                this.useGpuExport = true;        // GPU for export (WebCodecs / canvas)
                this.currentHardwareProfile = null; // Detected hardware profile

                // ── User Preferences (persisted in localStorage) ───────────────────
                this.prefs = {
                    gpuPreview:      true,   // GPU canvas acceleration in preview
                    gpuExport:       true,   // GPU/WebCodecs for export
                    snapEnabled:     true,   // Magnetic snap when dragging clips
                    snapThreshold:   0.3,    // Snap distance in seconds
                    loopPlayback:    false,  // Loop timeline on end
                    autoSaveDelay:   30,     // Auto-save interval in seconds
                    showWaveform:    true,   // Show audio waveforms on clips
                    rippleEnabled:   false,  // Ripple edit mode (shift clips on delete)
                    darkUI:          true,   // Dark theme (future: light toggle)
                    exportQualityFirst: true,  // ✅ ON par défaut : export parfait sans frames sautées, audio synchro garanti
                    adaptivePreview: false,  // OFF by default: full-quality preview for everyone (opt-in only)
                    previewForcePerformance: false, // Manuel : force le mode preview "performance" (petites machines)
                };
                this._loadPrefs();
                this._previewHandlesActive = false; // Only show video handles when user clicks in preview
                this._isTransformingPreview = false; // True while user is dragging/resizing a preview overlay
                this._lastXfKey = null;              // Cache key for _applyVideoTransform skip
                this._lastOverlayAnimKey = null;     // Cache key for overlay animation skip
                this._cachedActiveClip = null;       // Cached active clip for track scan skip
                this.markIn = null;
                this.markOut = null;
                this.playbackTimer = null;
                this.isProcessingFiles = false;
                this.audioElements = {}; // Cache for audio elements
                this.clipboardClip = null; // Clipboard for copy/paste
                this.videoCache = {}; // Cache for preloaded video elements
                this.preloadQueue = []; // Queue of videos to preload
                this.isPreloading = false;
                this.preloadProgress = 0;
                this.proxyTasks = new Map(); // Proxy generation tasks keyed by mediaId
                
                // Color Grading State
                this.colorGrading = {
                    lift: 0,
                    gamma: 0,
                    gain: 0,
                    saturation: 100,
                    contrast: 100,
                    temp: 0
                };

                // Undo/Redo system
                this.history = [];
                this.historyIndex = -1;
                this.maxHistorySize = 50;
                
                // Save reminder system
                this.saveReminderInterval = null;
                this.saveReminderDisabled = localStorage.getItem('saveReminderDisabled') === 'true';
                this.isExporting = false; // Block save reminders during export
                
                // Demo Mode - DISABLED - Everything is FREE now!
                this.isDemoMode = false;

                // AI Assistant State
                // 🥇 2026-09-16 — DeepSeek 4.1 Flash par défaut (noms officiels de l'API :
                //    « deepseek-flash » = DeepSeek-V4.1-Flash ; les anciens noms
                //    deepseek-chat / deepseek-v4-flash sont retirés côté DeepSeek).
                this.aiProvider = localStorage.getItem('ctf_ai_provider') || 'deepseek';
                this.aiModel = localStorage.getItem('ctf_ai_model') || 'deepseek-flash';
                // Clé par fournisseur (une seule clé globale serait utilisée à tort
                // après un changement de fournisseur). L'ancienne clé globale reste
                // lue en repli pour ne pas perdre la saisie des utilisateurs existants.
                this.aiKeys = {
                    deepseek: localStorage.getItem('ctf_ai_apikey_deepseek') || localStorage.getItem('ctf_ai_apikey') || '',
                    openrouter: localStorage.getItem('ctf_ai_apikey_openrouter') || '',
                    groq: localStorage.getItem('ctf_ai_apikey_groq') || '',
                    openai: localStorage.getItem('ctf_ai_apikey_openai') || '',
                    anthropic: localStorage.getItem('ctf_ai_apikey_anthropic') || '',
                    google: localStorage.getItem('ctf_ai_apikey_google') || ''
                };
                this.aiApiKey = this.aiKeys[this.aiProvider] || '';
                this.aiChatHistory = [];
                this.aiProcessing = false;

                // Auto-save system
                this.autoSaveDB = null;
                this.autoSaveTimer = null;
                this.autoSaveDirty = false;
                this.autoSaveInterval = 30000; // 30 seconds
                this.projectName = 'Untitled';
                this.selectedSaveFormat = 'ctf';
                this.exportedVideoBlob = null;
                this.exportedVideoUrl = null;
                this.exportedMimeType = null;

                this.init();
            }

            init() {
                console.log('CUT THE FLOW - Initializing...');
                
                // Initialize default tracks
                this.addTrack('VIDEO 1');
                this.addTrack('VIDEO 2');
                this.addTrack('VIDEO 3');
                this.addTrack('AUDIO 1');
                this.addTrack('AUDIO 2');
                
                // Setup event listeners
                this.setupEventListeners();
                
                // Render
                this.render();
                
                // Save initial state for undo/redo
                this.saveState();
                
                // Collapse the intermediate states accumulated by addTrack() calls during
                // init into a single clean baseline so Ctrl+Z starts from a real user action
                this.history = [this.history[this.historyIndex]];
                this.historyIndex = 0;
                
                // Initialize undo/redo buttons state
                this.updateUndoRedoButtons();
                
                // Start save reminder (every 5 minutes)
                this.startSaveReminder();
                
                // Initialize color wheels
                this.initColorWheels();
                
                // Initialize format preset (default 16:9)
                this.setFormatPreset(this.selectedAspectRatio);
                
                // Initialize AI panel
                this.initAIPanel();
                
                // Initialize IndexedDB and check for auto-save
                this.initAutoSaveDB().then(() => {
                    this.checkAutoSave();
                    this.startAutoSave();
                });
                
                // Initialize fullscreen listener
                this._initFullscreenListener();
                
                console.log('CUT THE FLOW - Ready!');
                this.showStatus('Ready to create!');
            }

            initColorWheels() {
                // Initialize interactive color wheels
                const wheels = ['Lift', 'Gamma', 'Gain'];
                wheels.forEach(name => {
                    const wheel = document.getElementById(`wheel${name}`);
                    const cursor = wheel?.querySelector('.wheel-cursor');
                    if (!wheel || !cursor) return;
                    
                    // Center cursor initially
                    cursor.style.left = '50%';
                    cursor.style.top = '50%';
                    
                    let isDragging = false;
                    
                    const updateCursor = (e) => {
                        const rect = wheel.getBoundingClientRect();
                        const centerX = rect.width / 2;
                        const centerY = rect.height / 2;
                        
                        let x = e.clientX - rect.left;
                        let y = e.clientY - rect.top;
                        
                        // Constrain to circle
                        const dx = x - centerX;
                        const dy = y - centerY;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const maxRadius = centerX - 10; // Keep inside border
                        
                        if (distance > maxRadius) {
                            const angle = Math.atan2(dy, dx);
                            x = centerX + Math.cos(angle) * maxRadius;
                            y = centerY + Math.sin(angle) * maxRadius;
                        }
                        
                        cursor.style.left = x + 'px';
                        cursor.style.top = y + 'px';
                        
                        // Update color grading value
                        const normalizedX = (x - centerX) / maxRadius;
                        const normalizedY = (y - centerY) / maxRadius;
                        const value = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY) * 100;
                        
                        // For now, just update the slider
                        const slider = wheel.parentElement.querySelector('.wheel-slider');
                        if (slider) {
                            const angle = Math.atan2(normalizedY, normalizedX);
                            const sliderValue = normalizedX * 50; // -50 to 50 range
                            slider.value = sliderValue;
                            this.updateColor(name.toLowerCase(), sliderValue);
                        }
                    };
                    
                    wheel.addEventListener('pointerdown', (e) => {
                        isDragging = true;
                        updateCursor(e);
                        e.preventDefault();
                    });
                    
                    document.addEventListener('pointermove', (e) => {
                        if (isDragging) {
                            updateCursor(e);
                        }
                    });
                    
                    document.addEventListener('pointerup', () => {
                        isDragging = false;
                    });
                });
            }

            setupEventListeners() {
                // === Prevent browser zoom (Ctrl+wheel, Ctrl++/-, pinch) ===
                document.addEventListener('wheel', (e) => {
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                    }
                }, { passive: false });

                document.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
                        e.preventDefault();
                    }
                });

                // Prevent pinch-to-zoom on touch devices
                document.addEventListener('gesturestart', (e) => e.preventDefault());
                document.addEventListener('gesturechange', (e) => e.preventDefault());
                document.addEventListener('touchstart', (e) => {
                    if (e.touches.length > 1) e.preventDefault();
                }, { passive: false });

                // Close mobile drawer on resize to desktop
                window.addEventListener('resize', () => {
                    if (window.innerWidth > 768) {
                        this.closeMobileDrawer();
                    }
                }, { passive: true });

                // File input
                const fileInput = document.getElementById('fileInput');
                fileInput.addEventListener('change', (e) => {
                    this.handleFiles(e.target.files);
                    // Reset input to allow re-importing the same file
                    e.target.value = '';
                });

                // Media Library drag & drop
                const mediaLibrary = document.getElementById('mediaLibrary');
                const dropZoneHint = mediaLibrary.querySelector('.drop-zone-hint');
                
                // Track if we're in a drag operation to prevent click triggering
                let isDragging = false;

                // 🛡️ ACCÈS SÛR AU GLISSER — un `DragEvent` peut n'avoir AUCUN `dataTransfer`
                //    (événement synthétique d'un test, d'une extension, ou glisser inter-onglets
                //    exotique). Or une exception dans un gestionnaire `dragover` interrompt le
                //    glisser en cours et laisse l'interface dans un état incohérent :
                //    on ne lit plus jamais `e.dataTransfer` directement.
                const dtFiles = (e) => (e && e.dataTransfer && e.dataTransfer.files) || [];
                const dtHasFiles = (e) => !!(e && e.dataTransfer && e.dataTransfer.types &&
                    typeof e.dataTransfer.types.includes === 'function' &&
                    e.dataTransfer.types.includes('Files'));
                
                // Click to browse (only on empty area or hint, and not during drag)
                mediaLibrary.addEventListener('click', (e) => {
                    if (!isDragging && (e.target === mediaLibrary || e.target.closest('.drop-zone-hint'))) {
                        this.openFileBrowser();
                    }
                });

                mediaLibrary.addEventListener('dragenter', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    isDragging = true;
                    mediaLibrary.classList.add('drag-over');
                });

                mediaLibrary.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    isDragging = true;
                    mediaLibrary.classList.add('drag-over');
                });

                mediaLibrary.addEventListener('dragleave', (e) => {
                    e.stopPropagation();
                    const rect = mediaLibrary.getBoundingClientRect();
                    if (e.clientX < rect.left || e.clientX >= rect.right ||
                        e.clientY < rect.top || e.clientY >= rect.bottom) {
                        isDragging = false;
                        mediaLibrary.classList.remove('drag-over');
                    }
                });

                mediaLibrary.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    isDragging = false;
                    mediaLibrary.classList.remove('drag-over');
                    const files = dtFiles(e);
                    if (files.length > 0) {
                        console.log('Files dropped:', files.length);
                        this.handleFiles(files);
                    }
                });

                // Timeline area drag & drop for external files
                const timelineArea = document.querySelector('.timeline-area');
                if (timelineArea) {
                    timelineArea.addEventListener('dragover', (e) => {
                        // Only accept file drops from outside
                        if (dtHasFiles(e)) {
                            e.preventDefault();
                            e.stopPropagation();
                            timelineArea.classList.add('drop-target');
                        }
                    });

                    timelineArea.addEventListener('dragleave', (e) => {
                        e.stopPropagation();
                        timelineArea.classList.remove('drop-target');
                    });

                    timelineArea.addEventListener('drop', (e) => {
                        // Only handle external file drops
                        const files = dtFiles(e);
                        if (files.length > 0) {
                            e.preventDefault();
                            e.stopPropagation();
                            this._clearDropTargets();
                            console.log('Files dropped on timeline:', files.length);

                            // Use first track, or create one if none exist
                            const targetTrack = this.tracks[0];
                            if (targetTrack) {
                                this.handleFilesAndAddToTrack(files, targetTrack.id, 0);
                            } else {
                                this.handleFiles(files);
                            }
                        }
                    });
                }

                // 🧹 NETTOYAGE DES ÉTATS DE DÉPÔT — filet de sécurité.
                // Un `dragleave` ne se déclenche PAS de façon fiable (drop hors de la zone,
                // glisser annulé par Échap, onglet qui perd le focus, élément recréé pendant
                // le drag). Sans ce nettoyage, une piste pouvait garder sa teinte de survol
                // indéfiniment. Ces trois écoutants couvrent tous les cas de fin de glisser.
                document.addEventListener('dragend', () => this._clearDropTargets());
                document.addEventListener('drop', () => this._clearDropTargets());
                window.addEventListener('blur', () => this._clearDropTargets());
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') this._clearDropTargets();
                });

                // Preview area drag & drop for external files
                const previewSection = document.querySelector('.preview-section');
                if (previewSection) {
                    previewSection.addEventListener('dragenter', (e) => {
                        if (dtHasFiles(e)) {
                            e.preventDefault();
                            e.stopPropagation();
                            previewSection.classList.add('drag-over');
                        }
                    });

                    previewSection.addEventListener('dragover', (e) => {
                        if (dtHasFiles(e)) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'copy';
                        }
                    });

                    previewSection.addEventListener('dragleave', (e) => {
                        e.stopPropagation();
                        const rect = previewSection.getBoundingClientRect();
                        if (e.clientX < rect.left || e.clientX >= rect.right ||
                            e.clientY < rect.top || e.clientY >= rect.bottom) {
                            previewSection.classList.remove('drag-over');
                        }
                    });

                    previewSection.addEventListener('drop', (e) => {
                        const files = dtFiles(e);
                        if (files.length > 0) {
                            e.preventDefault();
                            e.stopPropagation();
                            previewSection.classList.remove('drag-over');
                            console.log('Files dropped on preview:', files.length);
                            // Import AND place on timeline (first video track at playhead)
                            const targetTrack = this.tracks.find(t => t.name.toLowerCase().includes('video')) || this.tracks[0];
                            if (targetTrack) {
                                const dropTime = this.currentTime || 0;
                                this.handleFilesAndAddToTrack(files, targetTrack.id, dropTime);
                            } else {
                                this.handleFiles(files);
                                this.showStatus('✓ Files imported — add a track to place them on the timeline');
                            }
                        }
                    });
                }

                // Prevent default drag behavior on document
                document.addEventListener('dragover', (e) => {
                    e.preventDefault();
                });

                document.addEventListener('drop', (e) => {
                    e.preventDefault();
                });

                // Attach seeked listener on previewVideo so every async seek
                // (ruler click, scrub, clip select) refreshes the frame once decoded.
                const previewVideoEl = document.getElementById('previewVideo');
                if (previewVideoEl) {
                    previewVideoEl.addEventListener('seeked', () => {
                        if (!this.isPlaying) this.updatePreview();
                    });
                }

                // Apply GPU compositor layer hints based on prefs (set once at init)
                this._applyGpuLayerHints(this.useGpuAcceleration);

                // Preview video click - pause + show resize handles (never play)
                const previewWrapper = document.getElementById('previewWrapper');
                if (previewWrapper) {
                    previewWrapper.addEventListener('click', (e) => {
                        // Ignore clicks on the selection overlay or its handles —
                        // those are handled by _addVideoSelectHandles (drag/resize).
                        if (e.target.closest('.video-select-overlay')) return;

                        // If playing, pause first
                        if (this.isPlaying) {
                            this.pause();
                        }

                        // Find the clip at current playhead position and select it in the timeline
                        const activeClip = this._findClipAtTime(this.currentTime);
                        if (activeClip && (activeClip.type === 'video' || activeClip.type === 'image')) {
                            // Select in timeline but keep preview handles active
                            this.selectClip(activeClip, { keepPreviewHandles: true });
                        }

                        // Activate selection handles and show them
                        this._previewHandlesActive = true;
                        this.updatePreview();
                    });
                    // Click outside preview → hide handles
                    document.addEventListener('click', (e) => {
                        // Don't hide if clicking on the overlay/handles
                        if (e.target.closest('.video-select-overlay')) return;
                        // 🐛 BUGFIX (2026-09-10) — ne PAS masquer le cadre quand on clique
                        // sur un clip de la timeline : c'est précisément l'action qui doit
                        // l'afficher (sinon le clic « hors aperçu » annulait aussitôt la
                        // sélection et les poignées n'apparaissaient jamais).
                        if (e.target.closest('.timeline-clip')) return;
                        if (this._previewHandlesActive && !previewWrapper.contains(e.target)) {
                            this._previewHandlesActive = false;
                            this.updatePreview();
                        }
                    });
                }

                // Timeline scroll sync and ruler click
                const timelineScroll = document.getElementById('timelineScroll');
                const rulerContent = document.getElementById('rulerContent');
                
                // Ruler click - move playhead
                if (rulerContent) {
                    rulerContent.addEventListener('click', (e) => {
                        this.handleRulerClick(e);
                    });
                }

                // 🐛 CORRECTIF (2026-09-10) — DÉSYNCHRONISATION RULER / PISTES AU ZOOM
                // Avant : le ruler était un SECOND conteneur défilant, synchronisé par
                // `rulerContent.scrollLeft = timelineScroll.scrollLeft`. Or les deux n'ont
                // PAS la même largeur défilable (le ruler n'a pas les 120 px d'en-tête de
                // piste, et ses libellés absolus débordent un peu) : son maximum de
                // défilement était donc inférieur de ~20 à 130 px à celui des pistes.
                // Quand l'utilisateur zoomait/dézoomait en étant loin dans la timeline, le
                // ruler « butait » sur son maximum et se DÉCALait des pistes : les numéros
                // de temps ne correspondaient plus aux clips (« je perds les numéros »).
                // Correction : le ruler ne défile plus de façon autonome. On le translate
                // exactement du même nombre de pixels que les pistes → alignement garanti
                // quelle que soit la position ou le niveau de zoom.
                this._syncRulerScroll = () => {
                    const rc = document.getElementById('rulerContent');
                    const marks = document.getElementById('rulerMarks');
                    if (!rc || !marks) return;
                    const s = timelineScroll ? timelineScroll.scrollLeft : 0;
                    this._rulerScrollLeft = s;   // source de vérité pour les clics/scrub
                    marks.style.transform = s ? `translateX(${-s}px)` : '';
                    rc.scrollLeft = 0;           // le ruler lui-même ne défile plus
                };

                // Sync timeline and ruler scroll
                if (timelineScroll && rulerContent) {
                    timelineScroll.addEventListener('scroll', () => {
                        this._syncRulerScroll();
                    });
                    this._syncRulerScroll();
                    
                    // Zoom with mouse wheel in timeline
                    timelineScroll.addEventListener('wheel', (e) => {
                        // Zoom only on Ctrl+wheel; let plain / shift+wheel scroll normally.
                        // (Previous `e.ctrlKey || !e.shiftKey` hijacked every wheel event.)
                        if (e.ctrlKey) {
                            e.preventDefault();
                            
                            // Get mouse position relative to timeline for zoom centering
                            const rect = timelineScroll.getBoundingClientRect();
                            const mouseX = e.clientX - rect.left + timelineScroll.scrollLeft - this.TRACK_HEADER_WIDTH;
                            const mouseTime = mouseX / this.zoomLevel;
                            // Zoom in or out
                            if (e.deltaY < 0) {
                                this.zoomIn();
                            } else {
                                this.zoomOut();
                            }
                            
                            // Adjust scroll to keep mouse position centered
                            const newMouseX = mouseTime * this.zoomLevel;
                            const scrollAdjust = newMouseX - mouseX;
                            timelineScroll.scrollLeft += scrollAdjust;
                        }
                    }, { passive: false });
                }

                // Playhead drag - move by dragging the green square
                const playhead = document.getElementById('playhead');
                if (playhead) {
                    playhead.addEventListener('pointerdown', (e) => {
                        // Only start drag if clicking on the playhead itself or its handle (::before)
                        const rect = playhead.getBoundingClientRect();
                        const clickX = e.clientX;
                        const playheadCenter = rect.left + (rect.width / 2);
                        
                        // Check if click is near the playhead (within 20px)
                        if (Math.abs(clickX - playheadCenter) <= 20) {
                            e.preventDefault();
                            e.stopPropagation();
                            this.startPlayheadDrag(e);
                        }
                    });
                }

                // Keyboard shortcuts (industry standard)
                document.addEventListener('keydown', (e) => {
                    // Ignore if typing in an editable element
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
                        e.target.tagName === 'SELECT' || e.target.isContentEditable) return;

                    switch(e.code) {
                        case 'Space': // Play/Pause
                            e.preventDefault();
                            this.togglePlay();
                            break;
                        case 'KeyK': // Play/Pause (Premiere/Final Cut)
                            e.preventDefault();
                            this.togglePlay();
                            break;
                        case 'KeyJ': // Rewind
                            e.preventDefault();
                            this.currentTime = this.quantizeTime(Math.max(0, this.currentTime - 1));
                            this.forceVideoUpdate = true;
                            this.updatePlayhead();
                            break;
                        case 'KeyL': // Fast Forward
                            e.preventDefault();
                            this.currentTime = this.quantizeTime(Math.min(this.MAX_TIMELINE, this.currentTime + 1));
                            this.forceVideoUpdate = true;
                            this.updatePlayhead();
                            break;
                        case 'KeyI': // Mark In Point
                            e.preventDefault();
                            this.markIn = this.currentTime;
                            this.showStatus('In point marked at ' + this.formatTime(this.markIn));
                            this.renderRuler(); // L4 fix: refresh ruler so in-marker appears immediately
                            break;
                        case 'KeyO': // Mark Out Point
                            e.preventDefault();
                            this.markOut = this.currentTime;
                            this.showStatus('Out point marked at ' + this.formatTime(this.markOut));
                            this.renderRuler(); // L4 fix: refresh ruler so out-marker appears immediately
                            break;
                        case 'KeyC': // Copy or Cut
                            if (e.ctrlKey || e.metaKey) {
                                // Ctrl+C: Copy selected clip
                                e.preventDefault();
                                this.copyClip();
                            } else {
                                // C alone: Cut at playhead
                                e.preventDefault();
                                this.cutAtPlayhead();
                            }
                            break;
                        case 'KeyV': // Paste
                            if (e.ctrlKey || e.metaKey) {
                                e.preventDefault();
                                this.pasteClip();
                            }
                            break;
                        case 'KeyU': // Unlink audio
                            e.preventDefault();
                            this.unlinkAudio();
                            break;
                        case 'Delete': // Delete selected clip (Shift+Delete = ripple delete)
                        case 'Backspace':
                            if (this.selectedClip || this.selectedClipIds.size > 0) {
                                e.preventDefault();
                                // Snapshot ids — deleteClip mutates the set via selectClip(null)
                                const ids = this.selectedClipIds.size > 0
                                    ? [...this.selectedClipIds]
                                    : [this.selectedClip.id];
                                if (e.shiftKey) {
                                    for (const id of ids) {
                                        const found = this._findClipById(id);
                                        if (found) this.rippleDeleteClip(found.clip);
                                    }
                                } else {
                                    for (const id of ids) {
                                        const found = this._findClipById(id);
                                        if (found) this.deleteClip(found.clip);
                                    }
                                }
                                this.selectedClipIds.clear();
                                this.selectedClip = null;
                            }
                            break;
                        case 'ArrowLeft': // Step backward (1 frame)
                            e.preventDefault();
                            this.currentTime = this.quantizeTime(Math.max(0, this.currentTime - 1 / (this.selectedFps || 30)));
                            this.forceVideoUpdate = true;
                            this.updatePlayhead();
                            break;
                        case 'ArrowRight': // Step forward
                            e.preventDefault();
                            this.currentTime = this.quantizeTime(Math.min(this.MAX_TIMELINE, this.currentTime + 1 / (this.selectedFps || 30)));
                            this.forceVideoUpdate = true;
                            this.updatePlayhead();
                            break;
                        case 'Home': // Go to start
                            e.preventDefault();
                            this.goToStart();
                            break;
                        case 'End': // Go to end of last clip
                            e.preventDefault();
                            this.goToEnd();
                            break;
                        case 'Equal': // Zoom in (+)
                        case 'NumpadAdd':
                            if (e.shiftKey || e.code === 'NumpadAdd') {
                                e.preventDefault();
                                this.zoomIn();
                            }
                            break;
                        case 'Minus': // Zoom out (-)
                        case 'NumpadSubtract':
                            e.preventDefault();
                            this.zoomOut();
                            break;
                        case 'Escape': // Close FAQ, deselect or close properties
                            e.preventDefault();
                            const faqM = document.getElementById('faqModal');
                            if (faqM && faqM.classList.contains('show')) {
                                this.closeFAQ();
                                break;
                            }
                            const panel = document.getElementById('propertiesPanel');
                            if (panel && panel.classList.contains('open')) {
                                panel.classList.remove('open');
                            } else {
                                this.selectedClip = null;
                                this.selectedClipIds.clear();
                                if (this.isPlaying) {
                                    document.querySelectorAll('.timeline-clip.selected').forEach(el => el.classList.remove('selected'));
                                } else {
                                    this.renderTracks();
                                }
                                this.renderProperties();
                            }
                            break;
                        case 'KeyP': // Toggle Properties (P)
                            if (e.ctrlKey || e.metaKey) {
                                e.preventDefault();
                                this.toggleProperties();
                            }
                            break;
                        case 'KeyS': // Save (Ctrl+S)
                            if (e.ctrlKey || e.metaKey) {
                                e.preventDefault();
                                this.saveProject();
                            }
                            break;
                        case 'KeyZ': // Undo
                            if (e.ctrlKey || e.metaKey) {
                                e.preventDefault();
                                if (e.shiftKey) {
                                    this.redo();
                                } else {
                                    this.undo();
                                }
                            }
                            break;
                        case 'KeyY': // Redo (Ctrl+Y)
                            if (e.ctrlKey || e.metaKey) {
                                e.preventDefault();
                                this.redo();
                            }
                            break;
                    }
                });
            }

            toggleShortcuts() {
                this.showFAQ();
            }

            showFAQ() {
                const modal = document.getElementById('faqModal');
                const overlay = document.getElementById('faqOverlay');
                modal.classList.add('show');
                overlay.classList.add('show');
            }

            closeFAQ() {
                const modal = document.getElementById('faqModal');
                const overlay = document.getElementById('faqOverlay');
                modal.classList.remove('show');
                overlay.classList.remove('show');
            }

            // ============================================
            // FULLSCREEN
            // ============================================

            toggleFullscreen() {
                if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                    const el = document.documentElement;
                    const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
                    if (rfs) {
                        rfs.call(el).catch(err => {
                            this.showStatus(`Fullscreen error: ${err.message}`, 'error');
                        });
                    }
                } else {
                    const efs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
                    if (efs) efs.call(document);
                }
            }

            _initFullscreenListener() {
                const update = () => {
                    const btn = document.getElementById('fullscreenBtn');
                    if (!btn) return;
                    if (document.fullscreenElement || document.webkitFullscreenElement) {
                        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
                        btn.title = 'Exit Fullscreen';
                    } else {
                        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
                        btn.title = 'Fullscreen';
                    }
                };
                document.addEventListener('fullscreenchange', update);
                document.addEventListener('webkitfullscreenchange', update);
            }

            initAIPanel() {
                // Restore provider selection first (it syncs models, label, key, hint)
                this.selectAIProvider(this.aiProvider);
                // Restore saved model (selectAIProvider defaults to first option)
                const savedModel = localStorage.getItem('ctf_ai_model');
                const modelSelect = document.getElementById('aiModelSelect');
                if (savedModel && modelSelect) {
                    const opt = modelSelect.querySelector(`option[value="${savedModel}"]`);
                    if (opt && !opt.hidden) {
                        modelSelect.value = savedModel;
                        this.aiModel = savedModel;
                    }
                }
                // Enter key sends prompt
                const promptInput = document.getElementById('aiPromptInput');
                if (promptInput) {
                    promptInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            this.sendAIPrompt();
                        }
                    });
                }
                // Welcome message with example prompts
                this._aiShowWelcome();
            }

            _aiShowWelcome() {
                const log = document.getElementById('aiChatLog');
                if (!log || log.children.length > 0) return;
                const div = document.createElement('div');
                div.className = 'ai-msg ai-msg-welcome';
                div.innerHTML = `<strong>✦ CUT THE FLOW AI</strong><br>
<span style="opacity:.7">Your AI editing assistant — speak naturally in French or English.</span>

<div class="ai-prompt-categories">

  <div class="ai-cat">
    <div class="ai-cat-label">✂️ MONTAGE</div>
    <div class="ai-examples">
      <button class="ai-example-btn" data-prompt="Split the first clip at 5 seconds">Split clip at 5s</button>
      <button class="ai-example-btn" data-prompt="Remove the section between 10s and 15s and close the gap">Remove 10s–15s</button>
      <button class="ai-example-btn" data-prompt="Create an insert edit: split at playhead, push everything right by 3 seconds, leave a gap for a new clip">Insert edit at playhead</button>
      <button class="ai-example-btn" data-prompt="Make a J-cut on the first two clips: extend the audio of clip 2 so it starts 1 second before its video">J-cut between clips</button>
      <button class="ai-example-btn" data-prompt="Trim 2 seconds from the end of every clip on the timeline">Trim all clips -2s</button>
      <button class="ai-example-btn" data-prompt="Delete all gaps between clips on the first video track (ripple all clips to close the gaps)">Remove all gaps</button>
    </div>
  </div>

  <div class="ai-cat">
    <div class="ai-cat-label">📝 TITRES & TEXTE</div>
    <div class="ai-examples">
      <button class="ai-example-btn" data-prompt="Add a centered title 'MY VIDEO' in white, 64px Arial, at 0s for 4 seconds on the top track">Title card 4s</button>
      <button class="ai-example-btn" data-prompt="Add a lower-third: a semi-transparent black bar (100% wide, 15% height) at the bottom, with white text 'Interview — John Doe' on top of it, both for 5 seconds starting at 3s">Lower third</button>
      <button class="ai-example-btn" data-prompt="Add end credits: black fullscreen block for 6 seconds at the end, with centered white text 'Directed by Me' on top">End credits</button>
      <button class="ai-example-btn" data-prompt="Add a subtitle 'Hello World' in 32px at the bottom of the frame, from 2s to 5s">Subtitle overlay</button>
    </div>
  </div>

  <div class="ai-cat">
    <div class="ai-cat-label">🎨 COLOR & LOOK</div>
    <div class="ai-examples">
      <button class="ai-example-btn" data-prompt="Apply the cinema filter preset for a warm cinematic look">Cinema look</button>
      <button class="ai-example-btn" data-prompt="Make it black and white: apply the noir preset">Noir B&W</button>
      <button class="ai-example-btn" data-prompt="Give it a vintage faded film look with desaturated warm tones">Vintage film</button>
      <button class="ai-example-btn" data-prompt="Boost saturation to 150% and add +10 contrast for a punchy social media look">Punchy social media</button>
      <button class="ai-example-btn" data-prompt="Reset all color grading to default">Reset grading</button>
    </div>
  </div>

  <div class="ai-cat">
    <div class="ai-cat-label">🔊 AUDIO</div>
    <div class="ai-examples">
      <button class="ai-example-btn" data-prompt="Mute all audio tracks">Mute all audio</button>
      <button class="ai-example-btn" data-prompt="Unlink audio from the first video clip and put it on a separate audio track">Unlink audio</button>
      <button class="ai-example-btn" data-prompt="Set volume of the first audio track to 50%">Lower volume 50%</button>
      <button class="ai-example-btn" data-prompt="Solo the audio track so I can hear only it">Solo audio track</button>
    </div>
  </div>

  <div class="ai-cat">
    <div class="ai-cat-label">⬛ TRANSITIONS & EFFECTS</div>
    <div class="ai-examples">
      <button class="ai-example-btn" data-prompt="Add a fade-in from black (2s) at the very beginning of the timeline">Fade in from black</button>
      <button class="ai-example-btn" data-prompt="Add a fade-out to black (3s) at the end of the timeline">Fade to black</button>
      <button class="ai-example-btn" data-prompt="Add a 1-second dip-to-black between the first two clips: insert a black block at the gap">Dip to black</button>
      <button class="ai-example-btn" data-prompt="Add a white flash (0.5s, opacity 0.8) at the playhead position for an impact effect">White flash impact</button>
    </div>
  </div>

  <div class="ai-cat">
    <div class="ai-cat-label">🧠 ANALYSE & INFO</div>
    <div class="ai-examples">
      <button class="ai-example-btn" data-prompt="Describe my current timeline: how many tracks, clips, total duration, and give me an overview">Describe timeline</button>
      <button class="ai-example-btn" data-prompt="List all gaps between clips across all tracks">Find all gaps</button>
      <button class="ai-example-btn" data-prompt="Which clip is the longest? Which is the shortest?">Longest/shortest clip</button>
      <button class="ai-example-btn" data-prompt="Suggest improvements to make this edit more dynamic and professional">Suggest improvements</button>
    </div>
  </div>

</div>`;
                log.appendChild(div);
                // Example buttons click handler
                div.querySelectorAll('.ai-example-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const input = document.getElementById('aiPromptInput');
                        if (input) {
                            input.value = btn.dataset.prompt;
                            input.focus();
                        }
                    });
                });
            }

            toggleAIPanel() {
                const panel = document.getElementById('aiPanel');
                const btn = document.querySelector('.toolbar-icon.ai-btn');
                panel.classList.toggle('show');
                if (btn) btn.classList.toggle('active', panel.classList.contains('show'));
                // Focus input when opening
                if (panel.classList.contains('show')) {
                    setTimeout(() => {
                        const input = document.getElementById('aiPromptInput');
                        if (input) input.focus();
                    }, 200);
                }
                // On mobile, manage backdrop
                if (window.innerWidth <= 768) {
                    const backdrop = document.getElementById('mobileBackdrop');
                    if (backdrop) backdrop.classList.toggle('show', panel.classList.contains('show'));
                }
            }

            // ============================================
            // MOBILE TAB NAVIGATION
            // ============================================

            mobileTab(tab) {
                const mediaLib = document.querySelector('.media-library');
                const aiPanel = document.getElementById('aiPanel');
                const backdrop = document.getElementById('mobileBackdrop');
                const tabs = document.querySelectorAll('.mobile-tab');
                const aiBtn = document.querySelector('.toolbar-icon.ai-btn');
                const propsPanel = document.getElementById('propertiesPanel');
                const colorPanel = document.getElementById('colorPanel');
                const fxPanel = document.getElementById('fxPanel');

                // Close all sheets first
                if (mediaLib) mediaLib.classList.remove('mobile-open');
                if (aiPanel) aiPanel.classList.remove('show');
                if (backdrop) backdrop.classList.remove('show');
                if (aiBtn) aiBtn.classList.remove('active');
                if (propsPanel) propsPanel.classList.remove('open');
                if (colorPanel) colorPanel.style.display = 'none';
                if (fxPanel) fxPanel.style.display = 'none';
                const fadePanel = document.getElementById('fadePanel');
                if (fadePanel) fadePanel.style.display = 'none';
                document.getElementById('fadeTriggerBtn')?.classList.remove('active');

                // Highlight active tab
                tabs.forEach(t => t.classList.remove('active'));
                const activeTab = document.querySelector(`.mobile-tab[data-mtab="${tab}"]`);
                if (activeTab) activeTab.classList.add('active');

                switch (tab) {
                    case 'media':
                        if (mediaLib) mediaLib.classList.add('mobile-open');
                        if (backdrop) backdrop.classList.add('show');
                        break;

                    case 'ai':
                        if (aiPanel) aiPanel.classList.add('show');
                        if (aiBtn) aiBtn.classList.add('active');
                        if (backdrop) backdrop.classList.add('show');
                        setTimeout(() => {
                            const input = document.getElementById('aiPromptInput');
                            if (input) input.focus();
                        }, 300);
                        break;

                    case 'fx':
                        if (fxPanel) {
                            fxPanel.style.display = 'block';
                            if (backdrop) backdrop.classList.add('show');
                        }
                        break;

                    case 'color':
                        if (colorPanel) {
                            colorPanel.style.display = 'block';
                            if (backdrop) backdrop.classList.add('show');
                        }
                        break;

                    case 'export':
                        this.showExportModal();
                        // Switch tab highlight back to timeline since export is a modal
                        tabs.forEach(t => t.classList.remove('active'));
                        const tlTab = document.querySelector('.mobile-tab[data-mtab="timeline"]');
                        if (tlTab) tlTab.classList.add('active');
                        break;

                    case 'timeline':
                    default:
                        // Everything closed — timeline is the default view
                        break;
                }
            }

            // ============================================
            // MOBILE DRAWER (hamburger menu)
            // ============================================

            toggleMobileDrawer() {
                const drawer = document.getElementById('mobileDrawer');
                const backdrop = document.getElementById('mobileDrawerBackdrop');
                const btn = document.getElementById('burgerBtn');
                if (!drawer) return;
                const isOpen = drawer.classList.contains('open');
                if (isOpen) {
                    this.closeMobileDrawer();
                } else {
                    drawer.classList.add('open');
                    if (backdrop) backdrop.classList.add('show');
                    if (btn) {
                        btn.classList.add('open');
                        btn.setAttribute('aria-expanded', 'true');
                    }
                    // Prevent body scroll while drawer open
                    document.body.style.overflow = 'hidden';
                }
            }

            closeMobileDrawer() {
                const drawer = document.getElementById('mobileDrawer');
                const backdrop = document.getElementById('mobileDrawerBackdrop');
                const btn = document.getElementById('burgerBtn');
                if (drawer) drawer.classList.remove('open');
                if (backdrop) backdrop.classList.remove('show');
                if (btn) {
                    btn.classList.remove('open');
                    btn.setAttribute('aria-expanded', 'false');
                }
                document.body.style.overflow = '';
            }

            clearAIChat() {
                const log = document.getElementById('aiChatLog');
                if (log) log.innerHTML = '';
                this.aiChatHistory = [];
                this._aiShowWelcome();
            }

            selectAIProvider(provider) {
                this.aiProvider = provider;
                localStorage.setItem('ctf_ai_provider', provider);
                // Update buttons
                document.querySelectorAll('.ai-provider-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.provider === provider);
                });
                // Update model list visibility
                const modelSelect = document.getElementById('aiModelSelect');
                if (modelSelect) {
                    const optgroups = modelSelect.querySelectorAll('optgroup');
                    optgroups.forEach(og => {
                        const isMatch = og.label.toLowerCase() === provider;
                        og.querySelectorAll('option').forEach(o => o.hidden = !isMatch);
                    });
                    // Select first visible option of active provider
                    const activeGroup = [...optgroups].find(og => og.label.toLowerCase() === provider);
                    if (activeGroup) {
                        const firstOpt = activeGroup.querySelector('option:not([hidden])');
                        if (firstOpt) {
                            modelSelect.value = firstOpt.value;
                            this.aiModel = firstOpt.value;
                            localStorage.setItem('ctf_ai_model', firstOpt.value);
                        }
                    }
                }
                // Libellés « Model » / « API Key » + champ de clé propre au fournisseur
                const meta = (CutTheFlow.AI_PROVIDERS || {})[provider] || { label: provider, keyPage: '', keyHint: '' };
                const modelLabel = document.getElementById('aiModelLabel');
                if (modelLabel) modelLabel.textContent = 'Model — ' + meta.label;
                const keyLabel = document.getElementById('aiKeyLabel');
                if (keyLabel) keyLabel.textContent = 'API Key — ' + meta.label;
                const hint = document.getElementById('aiKeyHint');
                if (hint) {
                    hint.innerHTML = meta.keyHint
                        ? `Clé : <a href="${meta.keyPage}" target="_blank" rel="noopener">${meta.keyHint}</a> — stockée uniquement dans votre navigateur.`
                        : 'Clé stockée uniquement dans votre navigateur (localStorage), jamais envoyée ailleurs qu\'au fournisseur choisi.';
                }
                const keyInput = document.getElementById('aiApiKey');
                if (keyInput) {
                    keyInput.placeholder = meta.keyPlaceholder || 'API Key';
                    keyInput.value = (this.aiKeys && this.aiKeys[provider]) || '';
                }
                this.aiApiKey = (this.aiKeys && this.aiKeys[provider]) || '';
                if (modelSelect) this._aiSyncModelForProvider(provider);
            }

            /**
             * Si le modèle mémorisé n'appartient pas au fournisseur courant, on remet
             * le premier modèle de ce fournisseur (sinon on enverrait p.ex. un nom
             * Anthropic à l'API DeepSeek).
             */
            _aiSyncModelForProvider(provider) {
                const modelSelect = document.getElementById('aiModelSelect');
                if (!modelSelect) return;
                const current = modelSelect.querySelector(`option[value="${modelSelect.value}"]`);
                const owner = current && current.closest('optgroup') ? current.closest('optgroup').label.toLowerCase() : null;
                if (owner !== provider) {
                    const group = [...modelSelect.querySelectorAll('optgroup')].find(og => og.label.toLowerCase() === provider);
                    const firstOpt = group && group.querySelector('option:not([hidden])');
                    if (firstOpt) {
                        modelSelect.value = firstOpt.value;
                        this.aiModel = firstOpt.value;
                        localStorage.setItem('ctf_ai_model', firstOpt.value);
                    }
                } else {
                    this.aiModel = modelSelect.value;
                }
            }

            selectAIModel(model) {
                this.aiModel = model;
                localStorage.setItem('ctf_ai_model', model);
            }

            saveAIKey(key) {
                this.aiApiKey = key;
                if (!this.aiKeys) this.aiKeys = {};
                this.aiKeys[this.aiProvider] = key;
                localStorage.setItem('ctf_ai_apikey_' + this.aiProvider, key);
            }

            _aiAppendMsg(type, text) {
                const log = document.getElementById('aiChatLog');
                const div = document.createElement('div');
                div.className = `ai-msg ai-msg-${type}`;
                div.textContent = text;
                log.appendChild(div);
                log.scrollTop = log.scrollHeight;
                return div;
            }

            _aiBuildSystemPrompt() {
                // Build a comprehensive snapshot of the current timeline for the AI
                const tracksInfo = this.tracks.map(t => ({
                    id: t.id,
                    name: t.name,
                    muted: t.muted,
                    solo: t.solo,
                    volume: t.volume,
                    clips: t.clips.map(c => {
                        const info = {
                            id: c.id,
                            type: c.type,
                            name: c.name,
                            startTime: Math.round(c.startTime * 1000) / 1000,
                            duration: Math.round(c.duration * 1000) / 1000,
                            endTime: Math.round((c.startTime + c.duration) * 1000) / 1000,
                            sourceStart: Math.round(c.sourceStart * 1000) / 1000,
                            sourceDuration: c.sourceDuration === Infinity ? 'infinite' : Math.round(c.sourceDuration * 1000) / 1000
                        };
                        if (c.mediaId) info.mediaId = c.mediaId;
                        if (c.content) info.content = c.content;
                        if (c.style) info.style = c.style;
                        if (c.color) info.color = c.color;
                        if (c.opacity !== undefined && c.opacity !== 1.0) info.opacity = c.opacity;
                        if (c.width !== undefined) info.block = { width: c.width, height: c.height, posX: c.posX, posY: c.posY };
                        if (c.audioMuted) info.audioMuted = true;
                        if (c.audioUnlinked) info.audioUnlinked = true;
                        return info;
                    })
                }));
                
                const mediaInfo = this.mediaLibrary.map(m => ({
                    id: m.id,
                    name: m.name,
                    type: m.type,
                    duration: m.duration ? Math.round(m.duration * 1000) / 1000 : null,
                    width: m.width || null,
                    height: m.height || null
                }));

                const totalDuration = this.getTimelineEndTime();

                return `You are the AI editing assistant for CUT THE FLOW, a professional browser-based NLE (Non-Linear Video Editor).
You understand video editing deeply: cuts, trims, splits, J-cuts, L-cuts, ripple edits, insert edits, overwrite edits, color grading, text overlays, audio separation, track management, etc.
You speak French and English fluently. Always reply in the SAME language the user used.

Your personality: concise, expert-level, professional video editor. Think like an experienced editor on Premiere Pro or DaVinci Resolve.
When the user asks something vague, make a smart professional choice (e.g. standard durations, conventional placements).
When the user asks for analysis or suggestions, return helpful text in "explanation" with NO actions.

═══════════════════════════════════════
SOFTWARE ARCHITECTURE
═══════════════════════════════════════
- Timeline-based editor (like Premiere Pro / DaVinci Resolve)
- Tracks are stacked vertically: top track = highest visual priority (overlays)
- Each track contains CLIPS positioned on the timeline by startTime + duration
- Clip types: video, audio, image, text, block (colored rectangle)
- sourceStart = offset into original media (for trimmed clips)
- Playhead = current time position (currentTime)
- All times are in SECONDS (decimals ok, e.g. 2.5 = 2 seconds 500ms)
- Track names typically: "VIDEO 1", "VIDEO 2", "AUDIO 1" etc.

═══════════════════════════════════════
CURRENT PROJECT STATE
═══════════════════════════════════════
Playhead: ${Math.round(this.currentTime * 1000) / 1000}s
Total Duration: ${Math.round(totalDuration * 1000) / 1000}s
Zoom: ${this.zoomLevel} px/s
Selected Clip: ${this.selectedClip ? `id=${this.selectedClip.id} "${this.selectedClip.name}"` : 'none'}
${this.markIn !== null ? `Mark In: ${this.markIn}s` : ''}${this.markOut !== null ? ` | Mark Out: ${this.markOut}s` : ''}

Color Grading: lift=${this.colorGrading.lift} gamma=${this.colorGrading.gamma} gain=${this.colorGrading.gain} saturation=${this.colorGrading.saturation}% contrast=${this.colorGrading.contrast}% temp=${this.colorGrading.temp}

TRACKS (${this.tracks.length}):
${JSON.stringify(tracksInfo, null, 2)}

MEDIA LIBRARY (${this.mediaLibrary.length} items):
${JSON.stringify(mediaInfo, null, 2)}

═══════════════════════════════════════
AVAILABLE ACTIONS
═══════════════════════════════════════
Return a JSON object with "explanation" (string, brief) and "actions" (array).

── CLIP OPERATIONS ──

ADD_CLIP — Add a media from library to a track
  { "action": "ADD_CLIP", "mediaId": N, "trackId": N, "startTime": N, "duration": N (optional, defaults to media duration) }

DELETE_CLIP — Remove a clip
  { "action": "DELETE_CLIP", "clipId": N }

MOVE_CLIP — Reposition a clip (time and/or track)
  { "action": "MOVE_CLIP", "clipId": N, "startTime": N, "trackId": N (optional) }

TRIM_CLIP — Change clip timing (trim in/out, change position)
  { "action": "TRIM_CLIP", "clipId": N, "startTime": N, "duration": N, "sourceStart": N }
  All fields optional except clipId. Use to trim left (increase sourceStart, decrease duration, increase startTime), trim right (decrease duration), or reposition.

SPLIT_CLIP — Cut a clip at a specific time
  { "action": "SPLIT_CLIP", "clipId": N, "splitTime": N }
  splitTime must be BETWEEN clip.startTime and clip.endTime (exclusive).

RIPPLE_DELETE — Delete a clip and close the gap (shift all clips after it to the left)
  { "action": "RIPPLE_DELETE", "clipId": N }

SET_CLIP_PROPERTY — Set any clip property directly
  { "action": "SET_CLIP_PROPERTY", "clipId": N, "property": "name", "value": "..." }
  Works for: name, content (text), color (block), opacity, width, height, posX, posY

SET_CLIP_STYLE — Update text clip styling
  { "action": "SET_CLIP_STYLE", "clipId": N, "color": "#hex", "fontSize": "48px", "fontFamily": "Arial" }
  All style fields optional.

UNLINK_AUDIO — Extract audio from a video clip to a separate track
  { "action": "UNLINK_AUDIO", "clipId": N }

── TEXT & GRAPHICS ──

ADD_TEXT — Add a text overlay clip
  { "action": "ADD_TEXT", "content": "Hello", "startTime": N, "duration": N, "trackId": N (optional), "style": { "color": "#fff", "fontSize": "48px", "fontFamily": "Arial" } }

ADD_BLOCK — Add a colored rectangle overlay
  { "action": "ADD_BLOCK", "color": "#000", "startTime": N, "duration": N, "trackId": N (optional), "opacity": 0.5, "width": 100, "height": 100, "posX": 0, "posY": 0 }
  width/height/posX/posY are percentages of the video frame. 100×100 at 0,0 = full screen.

── TRACK OPERATIONS ──

ADD_TRACK — Create a new track
  { "action": "ADD_TRACK", "name": "TRACK NAME" }

DELETE_TRACK — Remove a track (and all its clips)
  { "action": "DELETE_TRACK", "trackId": N }

MUTE_TRACK — Set track mute state
  { "action": "MUTE_TRACK", "trackId": N, "muted": true/false }

SOLO_TRACK — Solo a track (mutes all others)
  { "action": "SOLO_TRACK", "trackId": N, "solo": true/false }

SET_VOLUME — Set track volume (0-100)
  { "action": "SET_VOLUME", "trackId": N, "volume": N }

RENAME_TRACK — Rename a track
  { "action": "RENAME_TRACK", "trackId": N, "name": "NEW NAME" }

── COLOR GRADING ──

SET_COLOR_GRADING — Set global color grading values
  { "action": "SET_COLOR_GRADING", "lift": N, "gamma": N, "gain": N, "saturation": N, "contrast": N, "temp": N }
  All fields optional. Ranges: lift/gamma/gain/temp = -50 to 50, saturation/contrast = 0 to 200.

APPLY_FILTER_PRESET — Apply a named filter preset
  { "action": "APPLY_FILTER_PRESET", "preset": "cinema" }
  Presets: none, warm, cool, vivid, fade, vintage, cinema, noir, sepia

── NAVIGATION ──

SEEK — Move playhead to a time
  { "action": "SEEK", "time": N }

MARK_IN — Set in point
  { "action": "MARK_IN", "time": N }

MARK_OUT — Set out point
  { "action": "MARK_OUT", "time": N }

SET_ZOOM — Set timeline zoom level (5–500 px/s)
  { "action": "SET_ZOOM", "zoom": N }

── COMPOSITE OPERATIONS (use multiple actions) ──

For complex edits, combine multiple atomic actions in a single response:
- "J-Cut": UNLINK_AUDIO from clip, then TRIM video shorter on the right, MOVE the audio clip to start earlier
- "L-Cut": UNLINK_AUDIO, TRIM audio shorter on the left, extend video into next clip's territory
- "Insert edit": SPLIT at playhead, MOVE second part right, ADD_CLIP in the gap
- "Replace edit": DELETE_CLIP then ADD_CLIP at same position and same duration
- "Fade in from black": ADD_BLOCK (black, fullscreen, 2-3s) at time 0 with opacity going from 1→0 (use opacity 0.8)
- "Fade to black": ADD_BLOCK (black, fullscreen, 2-3s) at the end
- "Lower third": ADD_BLOCK at bottom 20% + ADD_TEXT on top of it, both same timing
- "Remove section": SPLIT at start point, SPLIT at end point, RIPPLE_DELETE the middle clip
- "Dip to black": ADD_BLOCK (black, 1s) in the gap between two clips
- "Title card": ADD_BLOCK (black fullscreen) + ADD_TEXT (title) at same position on upper track
- "End credits": ADD_BLOCK (black) + ADD_TEXT (credits) at timeline end
- "Clean up timeline": Multiple MOVE_CLIP to remove gaps and stack clips sequentially

═══════════════════════════════════════
RESPONSE RULES
═══════════════════════════════════════
1. Return ONLY valid JSON: { "explanation": "...", "actions": [...] }
2. No markdown. No code fences. No extra text. JUST the JSON object.
3. Use exact clip IDs and track IDs from the state above. NEVER invent IDs.
4. Times in seconds. Decimals allowed (e.g. 1.5).
5. Actions execute in ORDER — use this for dependent operations (split then delete the right half).
6. If the user asks something impossible or unclear, return { "explanation": "...", "actions": [] } with a helpful explanation.
7. When creating overlays (text/block), prefer using the topmost track (lowest track index = highest visual priority). Create a new track if needed.
8. For "delete silence" or "remove gaps": identify clips with gaps between them and MOVE later clips earlier (or use RIPPLE_DELETE).
9. Think like a professional video editor. Understand common editing terminology in BOTH French and English (montage, coupure, fondu, piste, découper, etc.).
10. When the user asks for ANALYSIS (describe, list, suggest, find gaps, etc.), return a rich "explanation" and "actions": [].
11. Always be smart about TRACK SELECTION: video content goes on VIDEO tracks, audio on AUDIO tracks, text overlays on the topmost available track.
12. For text styling, use reasonable defaults: white color, 48px for titles, 32px for subtitles, 24px for lower thirds.
13. Understand that the timeline reads left-to-right. Time 0 = beginning. Higher startTime = later in the video.`;
            }

            async sendAIPrompt() {
                const input = document.getElementById('aiPromptInput');
                const prompt = input.value.trim();
                if (!prompt || this.aiProcessing) return;

                if (!this.aiApiKey) {
                    this._aiAppendMsg('error', 'Please enter your API key first.');
                    return;
                }

                // Show user message
                this._aiAppendMsg('user', prompt);
                input.value = '';

                // Show loading
                this.aiProcessing = true;
                const sendBtn = document.getElementById('aiSendBtn');
                sendBtn.disabled = true;
                const loadingMsg = this._aiAppendMsg('system', '⏳ Thinking...');

                try {
                    const systemPrompt = this._aiBuildSystemPrompt();
                    let response;

                    if (this.aiProvider === 'anthropic') {
                        response = await this._aiCallAnthropic(systemPrompt, prompt);
                    } else if (this.aiProvider === 'google') {
                        response = await this._aiCallGoogle(systemPrompt, prompt);
                    } else if (CutTheFlow.AI_OPENAI_COMPATIBLE[this.aiProvider]) {
                        // deepseek / openrouter / groq / openai : même contrat d'API
                        response = await this._aiCallOpenAICompatible(
                            systemPrompt, prompt,
                            this.aiProvider,
                            CutTheFlow.AI_OPENAI_COMPATIBLE[this.aiProvider]
                        );
                    } else {
                        response = await this._aiCallOpenAI(systemPrompt, prompt);
                    }

                    // Remove loading message
                    loadingMsg.remove();

                    // Parse response
                    let parsed;
                    try {
                        parsed = this._aiParseJSON(response);
                    } catch (e) {
                        this._aiAppendMsg('error', 'Failed to parse AI response:\n' + response.substring(0, 300));
                        return;
                    }

                    // Show explanation
                    if (parsed.explanation) {
                        this._aiAppendMsg('ai', parsed.explanation);
                    }

                    // Execute actions (with undo support)
                    if (parsed.actions && parsed.actions.length > 0) {
                        const results = this._aiExecuteActions(parsed.actions);
                        this._aiAppendMsg('action', results.join('\n'));
                        // _aiExecuteActions already calls saveState/renderTimeline/renderCanvas
                        this.renderTracks();
                        this.updatePreview();
                    } else if (!parsed.explanation) {
                        this._aiAppendMsg('ai', 'No actions to perform.');
                    }

                } catch (err) {
                    loadingMsg.remove();
                    this._aiAppendMsg('error', `API Error: ${err.message}`);
                } finally {
                    this.aiProcessing = false;
                    sendBtn.disabled = false;
                }
            }

            async _aiCallAnthropic(systemPrompt, userPrompt) {
                const res = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': this.aiApiKey,
                        'anthropic-version': '2023-06-01',
                        'anthropic-dangerous-direct-browser-access': 'true'
                    },
                    body: JSON.stringify({
                        model: this.aiModel,
                        max_tokens: 4096,
                        temperature: 0.3,
                        system: systemPrompt,
                        messages: [
                            ...this.aiChatHistory,
                            { role: 'user', content: userPrompt }
                        ]
                    })
                });
                if (!res.ok) {
                    const errBody = await res.text();
                    throw new Error(`Anthropic ${res.status}: ${errBody.substring(0, 200)}`);
                }
                const data = await res.json();
                const aiText = data.content[0].text;
                // Save to conversation history
                this.aiChatHistory.push({ role: 'user', content: userPrompt });
                this.aiChatHistory.push({ role: 'assistant', content: aiText });
                // Keep history manageable
                if (this.aiChatHistory.length > 20) this.aiChatHistory = this.aiChatHistory.slice(-20);
                return aiText;
            }

            /**
             * Parse la réponse du modèle. Les modèles renvoient parfois une réponse
             * entourée de ```json … ```, précédée d'un texte, ou avec une virgule
             * finale : on nettoie avant de désespérer.
             */
            _aiParseJSON(response) {
                let cleaned = String(response || '').trim();
                if (cleaned.startsWith('```')) {
                    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
                }
                try {
                    return JSON.parse(cleaned);
                } catch (_) { /* on tente le nettoyage ci-dessous */ }
                // Isole le premier objet JSON équilibré (ignore le bavardage autour)
                const start = cleaned.indexOf('{');
                if (start >= 0) {
                    let depth = 0, inStr = false, esc = false;
                    for (let i = start; i < cleaned.length; i++) {
                        const ch = cleaned[i];
                        if (inStr) {
                            if (esc) esc = false;
                            else if (ch === '\\') esc = true;
                            else if (ch === '"') inStr = false;
                            continue;
                        }
                        if (ch === '"') inStr = true;
                        else if (ch === '{') depth++;
                        else if (ch === '}') {
                            depth--;
                            if (depth === 0) {
                                const slice = cleaned.slice(start, i + 1);
                                try { return JSON.parse(slice); } catch (_) {}
                                try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); } catch (_) {}
                                break;
                            }
                        }
                    }
                }
                throw new Error('Réponse non JSON');
            }

            /**
             * Appel d'un fournisseur « OpenAI-compatible » (DeepSeek, OpenRouter,
             * Groq, OpenAI). Un seul code pour les quatre : mêmes en-têtes, même
             * corps. Deux différences réelles gérées ici :
             *   • les modèles de raisonnement OpenAI (o3/o4-mini/gpt-5) refusent
             *     `temperature` et attendent `max_completion_tokens` ;
             *   • certains modèles gratuits (OpenRouter/Groq) refusent
             *     `response_format` → on réessaie automatiquement sans les
             *     paramètres optionnels si l'API répond 400 sur un paramètre.
             */
            async _aiCallOpenAICompatible(systemPrompt, userPrompt, provider, endpoint) {
                const model = this.aiModel;
                const isReasoning = provider === 'openai' && /^(o\d|gpt-5)/.test(model);
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.aiApiKey}`
                };
                if (provider === 'openrouter') {
                    // Recommandé par OpenRouter (identification de l'appelant)
                    headers['HTTP-Referer'] = location.origin;
                    headers['X-Title'] = 'CUT THE FLOW';
                }

                const buildBody = (rich) => {
                    const body = {
                        model,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            ...this.aiChatHistory,
                            { role: 'user', content: userPrompt }
                        ]
                    };
                    if (isReasoning) {
                        body.max_completion_tokens = 4096;
                    } else {
                        body.max_tokens = 4096;
                        if (rich) body.temperature = 0.3;
                    }
                    if (rich && !isReasoning) body.response_format = { type: 'json_object' };
                    return body;
                };

                const doFetch = async (rich) => fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(buildBody(rich))
                });

                let res = await doFetch(true);
                if (!res.ok && (res.status === 400 || res.status === 422)) {
                    // Paramètre refusé par ce modèle → nouvelle tentative minimale
                    const errText = await res.text();
                    console.warn(`⚠️ ${provider} a refusé la requête enrichie (${res.status}) — nouvelle tentative sans paramètres optionnels.`, errText.substring(0, 200));
                    res = await doFetch(false);
                    if (!res.ok) {
                        throw new Error(`${provider} ${res.status}: ${(await res.text()).substring(0, 200)}`);
                    }
                } else if (!res.ok) {
                    throw new Error(`${provider} ${res.status}: ${(await res.text()).substring(0, 200)}`);
                }

                const data = await res.json();
                const aiText = data?.choices?.[0]?.message?.content;
                if (!aiText) throw new Error(`${provider} : réponse vide (${JSON.stringify(data).substring(0, 200)})`);
                this.aiChatHistory.push({ role: 'user', content: userPrompt });
                this.aiChatHistory.push({ role: 'assistant', content: aiText });
                if (this.aiChatHistory.length > 20) this.aiChatHistory = this.aiChatHistory.slice(-20);
                return aiText;
            }

            /** Conservé pour compatibilité — DeepSeek est un fournisseur OpenAI-compatible. */
            async _aiCallDeepSeek(systemPrompt, userPrompt) {
                return this._aiCallOpenAICompatible(
                    systemPrompt, userPrompt, 'deepseek',
                    CutTheFlow.AI_OPENAI_COMPATIBLE.deepseek
                );
            }

            async _aiCallOpenAI(systemPrompt, userPrompt) {
                return this._aiCallOpenAICompatible(
                    systemPrompt, userPrompt, 'openai',
                    CutTheFlow.AI_OPENAI_COMPATIBLE.openai
                );
            }

            async _aiCallGoogle(systemPrompt, userPrompt) {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.aiModel}:generateContent?key=${this.aiApiKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        system_instruction: { parts: [{ text: systemPrompt }] },
                        contents: [
                            ...this.aiChatHistory.map(m => ({
                                role: m.role === 'assistant' ? 'model' : 'user',
                                parts: [{ text: m.content }]
                            })),
                            { role: 'user', parts: [{ text: userPrompt }] }
                        ],
                        generationConfig: {
                            maxOutputTokens: 4096,
                            temperature: 0.3,
                            responseMimeType: 'application/json'
                        }
                    })
                });
                if (!res.ok) {
                    const errBody = await res.text();
                    throw new Error(`Google ${res.status}: ${errBody.substring(0, 200)}`);
                }
                const data = await res.json();
                const aiText = data.candidates[0].content.parts[0].text;
                this.aiChatHistory.push({ role: 'user', content: userPrompt });
                this.aiChatHistory.push({ role: 'assistant', content: aiText });
                if (this.aiChatHistory.length > 20) this.aiChatHistory = this.aiChatHistory.slice(-20);
                return aiText;
            }

            _aiFindClip(clipId) {
                for (const t of this.tracks) {
                    const c = t.clips.find(c => c.id === clipId);
                    if (c) return { clip: c, track: t };
                }
                return null;
            }

            _aiExecuteActions(actions) {
                const results = [];
                for (const act of actions) {
                    try {
                        switch (act.action) {

                            // ── CLIP OPERATIONS ──

                            case 'ADD_CLIP': {
                                const media = this.mediaLibrary.find(m => m.id === act.mediaId);
                                if (!media) { results.push(`✗ ADD_CLIP: media ${act.mediaId} not found`); break; }
                                const track = this.tracks.find(t => t.id === act.trackId);
                                if (!track) { results.push(`✗ ADD_CLIP: track ${act.trackId} not found`); break; }
                                const isAudio = media.type.startsWith('audio');
                                const isImage = media.type.startsWith('image');
                                const clip = {
                                    id: this.clipIdCounter++,
                                    trackId: track.id,
                                    type: isAudio ? 'audio' : isImage ? 'image' : 'video',
                                    name: media.name,
                                    mediaId: media.id,
                                    url: media.proxyUrl || media.url,
                                    originalUrl: media.url,
                                    startTime: act.startTime || 0,
                                    duration: act.duration || media.duration || 5,
                                    sourceStart: 0,
                                    sourceDuration: media.duration || Infinity
                                };
                                if (isImage) {
                                    clip.sourceDuration = Infinity;
                                    clip.width = media.width || 1920;
                                    clip.height = media.height || 1080;
                                }
                                track.clips.push(clip);
                                results.push(`✓ ADD_CLIP: "${media.name}" → ${track.name} at ${act.startTime || 0}s`);
                                break;
                            }

                            case 'DELETE_CLIP': {
                                let found = false;
                                for (const t of this.tracks) {
                                    const idx = t.clips.findIndex(c => c.id === act.clipId);
                                    if (idx !== -1) {
                                        const removed = t.clips.splice(idx, 1)[0];
                                        results.push(`✓ DELETE_CLIP: "${removed.name}" (id ${act.clipId})`);
                                        found = true;
                                        break;
                                    }
                                }
                                if (!found) results.push(`✗ DELETE_CLIP: clip ${act.clipId} not found`);
                                break;
                            }

                            case 'RIPPLE_DELETE': {
                                const found = this._aiFindClip(act.clipId);
                                if (!found) { results.push(`✗ RIPPLE_DELETE: clip ${act.clipId} not found`); break; }
                                const { clip, track } = found;
                                const endTime = clip.startTime + clip.duration;
                                const gapDuration = clip.duration;
                                track.clips = track.clips.filter(c => c.id !== clip.id);
                                // Shift all clips after the deleted one to the left
                                for (const c of track.clips) {
                                    if (c.startTime >= endTime) {
                                        c.startTime = Math.max(0, c.startTime - gapDuration);
                                    }
                                }
                                results.push(`✓ RIPPLE_DELETE: "${clip.name}" removed, gap closed`);
                                break;
                            }

                            case 'MOVE_CLIP': {
                                const found = this._aiFindClip(act.clipId);
                                if (!found) { results.push(`✗ MOVE_CLIP: clip ${act.clipId} not found`); break; }
                                const { clip, track: srcTrack } = found;
                                if (act.startTime !== undefined) clip.startTime = act.startTime;
                                if (act.trackId && act.trackId !== srcTrack.id) {
                                    srcTrack.clips = srcTrack.clips.filter(c => c.id !== clip.id);
                                    const destTrack = this.tracks.find(t => t.id === act.trackId);
                                    if (destTrack) {
                                        clip.trackId = destTrack.id;
                                        destTrack.clips.push(clip);
                                        results.push(`✓ MOVE_CLIP: ${clip.name} → ${destTrack.name} at ${clip.startTime}s`);
                                    } else {
                                        srcTrack.clips.push(clip); // rollback
                                        results.push(`✗ MOVE_CLIP: dest track ${act.trackId} not found`);
                                    }
                                } else {
                                    results.push(`✓ MOVE_CLIP: ${clip.name} → ${clip.startTime}s`);
                                }
                                break;
                            }

                            case 'TRIM_CLIP': {
                                const found = this._aiFindClip(act.clipId);
                                if (!found) { results.push(`✗ TRIM_CLIP: clip ${act.clipId} not found`); break; }
                                const { clip } = found;
                                if (act.startTime !== undefined) clip.startTime = act.startTime;
                                if (act.duration !== undefined) clip.duration = act.duration;
                                if (act.sourceStart !== undefined) clip.sourceStart = act.sourceStart;
                                results.push(`✓ TRIM_CLIP: ${clip.name} → start=${clip.startTime}s dur=${clip.duration}s src=${clip.sourceStart}s`);
                                break;
                            }

                            case 'SPLIT_CLIP': {
                                const found = this._aiFindClip(act.clipId);
                                if (!found) { results.push(`✗ SPLIT_CLIP: clip ${act.clipId} not found`); break; }
                                const { clip, track } = found;
                                const splitTime = act.splitTime;
                                if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) {
                                    results.push(`✗ SPLIT_CLIP: time ${splitTime}s outside clip [${clip.startTime}s-${clip.startTime + clip.duration}s]`);
                                    break;
                                }
                                const offset = splitTime - clip.startTime;
                                const newClip = {
                                    ...clip,
                                    id: this.clipIdCounter++,
                                    startTime: splitTime,
                                    duration: clip.duration - offset,
                                    sourceStart: clip.sourceStart + offset,
                                    name: clip.name + ' (2)'
                                };
                                clip.duration = offset;
                                track.clips.push(newClip);
                                results.push(`✓ SPLIT_CLIP: "${clip.name}" split at ${splitTime}s → new clip id ${newClip.id}`);
                                break;
                            }

                            case 'SET_CLIP_PROPERTY': {
                                const found = this._aiFindClip(act.clipId);
                                if (!found) { results.push(`✗ SET_CLIP_PROPERTY: clip ${act.clipId} not found`); break; }
                                const { clip } = found;
                                const prop = act.property;
                                const allowed = ['name', 'content', 'color', 'opacity', 'width', 'height', 'posX', 'posY'];
                                if (!allowed.includes(prop)) {
                                    results.push(`✗ SET_CLIP_PROPERTY: "${prop}" not allowed (use: ${allowed.join(', ')})`);
                                    break;
                                }
                                clip[prop] = act.value;
                                results.push(`✓ SET_CLIP_PROPERTY: ${clip.name}.${prop} = ${act.value}`);
                                break;
                            }

                            case 'SET_CLIP_STYLE': {
                                const found = this._aiFindClip(act.clipId);
                                if (!found) { results.push(`✗ SET_CLIP_STYLE: clip ${act.clipId} not found`); break; }
                                const { clip } = found;
                                if (clip.type !== 'text') {
                                    results.push(`✗ SET_CLIP_STYLE: clip ${act.clipId} is not a text clip`);
                                    break;
                                }
                                if (!clip.style) clip.style = {};
                                if (act.color) clip.style.color = act.color;
                                if (act.fontSize) clip.style.fontSize = act.fontSize;
                                if (act.fontFamily) clip.style.fontFamily = act.fontFamily;
                                results.push(`✓ SET_CLIP_STYLE: "${clip.content}" → ${JSON.stringify(clip.style)}`);
                                break;
                            }

                            case 'UNLINK_AUDIO': {
                                const found = this._aiFindClip(act.clipId);
                                if (!found) { results.push(`✗ UNLINK_AUDIO: clip ${act.clipId} not found`); break; }
                                const { clip, track: srcTrack } = found;
                                if (clip.type !== 'video') {
                                    results.push(`✗ UNLINK_AUDIO: clip ${act.clipId} is not a video clip`);
                                    break;
                                }
                                // Create audio clip on a new or existing audio track
                                let audioTrack = this.tracks.find(t => t.name.includes('AUDIO'));
                                if (!audioTrack) audioTrack = this.addTrack('AUDIO 1');
                                // 🐛 CORRECTIF (2026-09-10) — utiliser l'URL ORIGINALE (pré-proxy).
                                // `clip.url` peut pointer sur une version proxy basse qualité :
                                // l'audio extrait était alors dégradé par rapport au fichier
                                // source. On privilégie media.originalUrl, comme le fait
                                // app.unlinkAudio() (l'outil de la barre d'outils).
                                const _media = this.mediaLibrary.find(m => m.id === clip.mediaId);
                                const _audioUrl = (_media && _media.originalUrl) ? _media.originalUrl
                                    : (_media && _media.url) ? _media.url
                                    : (clip.originalUrl || clip.url);
                                const audioClip = {
                                    id: this.clipIdCounter++,
                                    trackId: audioTrack.id,
                                    type: 'audio',
                                    name: clip.name + ' (Audio)',
                                    mediaId: clip.mediaId,
                                    url: _audioUrl,
                                    originalUrl: clip.originalUrl,
                                    startTime: clip.startTime,
                                    duration: clip.duration,
                                    sourceStart: clip.sourceStart,
                                    sourceDuration: clip.sourceDuration
                                };
                                audioTrack.clips.push(audioClip);
                                clip.audioMuted = true;
                                clip.audioUnlinked = true;
                                results.push(`✓ UNLINK_AUDIO: extracted audio from "${clip.name}" → ${audioTrack.name}`);
                                break;
                            }

                            // ── TEXT & GRAPHICS ──

                            case 'ADD_TEXT': {
                                const tId = act.trackId || (this.tracks.length > 0 ? this.tracks[0].id : null);
                                const track = this.tracks.find(t => t.id === tId);
                                if (!track) { results.push(`✗ ADD_TEXT: no valid track`); break; }
                                const clip = {
                                    id: this.clipIdCounter++,
                                    trackId: track.id,
                                    type: 'text',
                                    name: act.content ? `Text: ${act.content.substring(0, 20)}` : 'Text Layer',
                                    content: act.content || 'TEXT',
                                    startTime: act.startTime || 0,
                                    duration: act.duration || 5,
                                    sourceStart: 0,
                                    sourceDuration: Infinity,
                                    style: {
                                        color: (act.style && act.style.color) || '#ffffff',
                                        fontSize: (act.style && act.style.fontSize) || '48px',
                                        fontFamily: (act.style && act.style.fontFamily) || 'Arial'
                                    }
                                };
                                track.clips.push(clip);
                                results.push(`✓ ADD_TEXT: "${act.content}" → ${track.name} at ${clip.startTime}s (${clip.duration}s)`);
                                break;
                            }

                            case 'ADD_BLOCK': {
                                const tId = act.trackId || (this.tracks.length > 0 ? this.tracks[0].id : null);
                                const track = this.tracks.find(t => t.id === tId);
                                if (!track) { results.push(`✗ ADD_BLOCK: no valid track`); break; }
                                const clip = {
                                    id: this.clipIdCounter++,
                                    trackId: track.id,
                                    type: 'block',
                                    name: 'Color Block',
                                    color: act.color || '#000000',
                                    startTime: act.startTime || 0,
                                    duration: act.duration || 5,
                                    sourceStart: 0,
                                    sourceDuration: Infinity,
                                    opacity: act.opacity !== undefined ? act.opacity : 1.0,
                                    width: act.width !== undefined ? act.width : 100,
                                    height: act.height !== undefined ? act.height : 100,
                                    posX: act.posX !== undefined ? act.posX : 0,
                                    posY: act.posY !== undefined ? act.posY : 0
                                };
                                track.clips.push(clip);
                                results.push(`✓ ADD_BLOCK: ${act.color} ${clip.width}x${clip.height} at ${clip.startTime}s (${clip.duration}s)`);
                                break;
                            }

                            // ── TRACK OPERATIONS ──

                            case 'ADD_TRACK': {
                                const newTrack = this.addTrack(act.name || 'NEW TRACK');
                                results.push(`✓ ADD_TRACK: "${newTrack.name}" (id ${newTrack.id})`);
                                break;
                            }

                            case 'DELETE_TRACK': {
                                const track = this.tracks.find(t => t.id === act.trackId);
                                if (!track) { results.push(`✗ DELETE_TRACK: track ${act.trackId} not found`); break; }
                                const clipCount = track.clips.length;
                                this.tracks = this.tracks.filter(t => t.id !== act.trackId);
                                results.push(`✓ DELETE_TRACK: "${track.name}" (${clipCount} clips removed)`);
                                break;
                            }

                            case 'MUTE_TRACK': {
                                const track = this.tracks.find(t => t.id === act.trackId);
                                if (!track) { results.push(`✗ MUTE_TRACK: track ${act.trackId} not found`); break; }
                                track.muted = act.muted !== undefined ? act.muted : !track.muted;
                                results.push(`✓ MUTE_TRACK: ${track.name} → ${track.muted ? 'muted' : 'unmuted'}`);
                                break;
                            }

                            case 'SOLO_TRACK': {
                                const track = this.tracks.find(t => t.id === act.trackId);
                                if (!track) { results.push(`✗ SOLO_TRACK: track ${act.trackId} not found`); break; }
                                track.solo = act.solo !== undefined ? act.solo : !track.solo;
                                results.push(`✓ SOLO_TRACK: ${track.name} → ${track.solo ? 'solo ON' : 'solo OFF'}`);
                                break;
                            }

                            case 'SET_VOLUME': {
                                const track = this.tracks.find(t => t.id === act.trackId);
                                if (!track) { results.push(`✗ SET_VOLUME: track ${act.trackId} not found`); break; }
                                track.volume = Math.max(0, Math.min(100, act.volume));
                                results.push(`✓ SET_VOLUME: ${track.name} → ${track.volume}%`);
                                break;
                            }

                            case 'RENAME_TRACK': {
                                const track = this.tracks.find(t => t.id === act.trackId);
                                if (!track) { results.push(`✗ RENAME_TRACK: track ${act.trackId} not found`); break; }
                                const oldName = track.name;
                                track.name = act.name;
                                results.push(`✓ RENAME_TRACK: "${oldName}" → "${act.name}"`);
                                break;
                            }

                            // ── COLOR GRADING ──

                            case 'SET_COLOR_GRADING': {
                                if (act.lift !== undefined) this.colorGrading.lift = act.lift;
                                if (act.gamma !== undefined) this.colorGrading.gamma = act.gamma;
                                if (act.gain !== undefined) this.colorGrading.gain = act.gain;
                                if (act.saturation !== undefined) this.colorGrading.saturation = act.saturation;
                                if (act.contrast !== undefined) this.colorGrading.contrast = act.contrast;
                                if (act.temp !== undefined) this.colorGrading.temp = act.temp;
                                this.applyColorGrading();
                                results.push(`✓ SET_COLOR_GRADING: lift=${this.colorGrading.lift} gamma=${this.colorGrading.gamma} gain=${this.colorGrading.gain} sat=${this.colorGrading.saturation}% con=${this.colorGrading.contrast}% temp=${this.colorGrading.temp}`);
                                break;
                            }

                            case 'APPLY_FILTER_PRESET': {
                                const preset = act.preset || 'none';
                                if (typeof this.applyFilterPreset === 'function') {
                                    this.applyFilterPreset(preset);
                                    results.push(`✓ APPLY_FILTER_PRESET: "${preset}"`);
                                } else {
                                    results.push(`✗ APPLY_FILTER_PRESET: method not available`);
                                }
                                break;
                            }

                            // ── NAVIGATION ──

                            case 'SEEK': {
                                this.currentTime = Math.max(0, act.time || 0);
                                this.updatePlayhead();
                                results.push(`✓ SEEK: → ${this.formatTime(this.currentTime)}`);
                                break;
                            }

                            case 'MARK_IN': {
                                this.markIn = act.time !== undefined ? act.time : this.currentTime;
                                results.push(`✓ MARK_IN: ${this.markIn}s`);
                                break;
                            }

                            case 'MARK_OUT': {
                                this.markOut = act.time !== undefined ? act.time : this.currentTime;
                                results.push(`✓ MARK_OUT: ${this.markOut}s`);
                                break;
                            }

                            case 'SET_ZOOM': {
                                const z = this.clampZoomLevel(act.zoom || 50);
                                this.zoomLevel = z;
                                this.renderTracks();
                                results.push(`✓ SET_ZOOM: ${z} px/s`);
                                break;
                            }

                            default:
                                results.push(`✗ Unknown action: ${act.action}`);
                        }
                    } catch (e) {
                        results.push(`✗ ${act.action}: ${e.message}`);
                    }
                }

                // After all actions: recalculate solo logic & refresh full UI
                const anySolo = this.tracks.some(t => t.solo);
                this.tracks.forEach(t => { t._effectiveMute = anySolo && !t.solo; });
                
                this.saveState();
                this.fullRefresh();

                return results;
            }

            addTextLayer() {
                // K1 fix: find first non-audio track so text lands on a visible layer
                const AUDIO_KEYWORDS = /^audio|^snd|^son/i;
                let track = this.tracks.find(t => !AUDIO_KEYWORDS.test(t.name));
                if (!track) {
                    const newId = this.addTrack('TEXT');
                    track = this.tracks.find(t => t.id === newId);
                }
                
                const clip = {
                    id: this.clipIdCounter++,
                    trackId: track.id,
                    type: 'text',
                    name: 'Text Layer',
                    content: 'NEW TEXT',
                    startTime: this.quantizeTime(this.currentTime),
                    duration: 5,
                    sourceStart: 0,
                    sourceDuration: Infinity,
                    posX: 50, // % from left (center by default)
                    posY: 50, // % from top (center by default)
                    style: {
                        color: '#ffffff',
                        fontSize: '48px',
                        fontFamily: 'Arial',
                        // 🅣 Ombre OFF par défaut sur les nouveaux textes (demande utilisateur).
                        // Les projets antérieurs n'ayant pas ce champ gardent l'ancien rendu.
                        shadowEnabled: false,
                        shadowColor: 'rgba(0,0,0,0.8)',
                        shadowBlur: 4,
                        shadowOffsetX: 2,
                        shadowOffsetY: 2
                    }
                };
                
                track.clips.push(clip);
                this.selectedClip = clip;  // Sélectionner le nouveau clip texte
                this._lastPreviewKey = null; // Forcer le rebuild des overlays
                this.saveState();
                this.renderTracks();
                this.renderProperties();
                this.updatePreview();
                this.showStatus('Text layer added');
            }

            addBlockLayer() {
                // K1 fix: find first non-audio track so block lands on a visible layer
                const AUDIO_KEYWORDS = /^audio|^snd|^son/i;
                let track = this.tracks.find(t => !AUDIO_KEYWORDS.test(t.name));
                if (!track) {
                    const newId = this.addTrack('BLOCK');
                    track = this.tracks.find(t => t.id === newId);
                }
                
                const clip = {
                    id: this.clipIdCounter++,
                    trackId: track.id,
                    type: 'block',
                    name: 'Color Block',
                    color: '#ff0000',
                    startTime: this.quantizeTime(this.currentTime),
                    duration: 5,
                    sourceStart: 0,
                    sourceDuration: Infinity,
                    opacity: 1.0,
                    width: 50, // Percentage of screen width
                    height: 50, // Percentage of screen height
                    posX: 25, // Percentage from left
                    posY: 25 // Percentage from top
                };
                
                track.clips.push(clip);
                this.selectedClip = clip;  // Sélectionner le nouveau bloc
                this._lastPreviewKey = null; // Forcer le rebuild des overlays
                this.saveState();
                this.renderTracks();
                this.renderProperties();
                this.updatePreview();
                this.showStatus('Block layer added');
            }

            toggleColorPanel() {
                const panel = document.getElementById('colorPanel');
                if (panel.style.display === 'none') {
                    panel.style.display = 'block';
                } else {
                    panel.style.display = 'none';
                }
                // Mobile backdrop
                if (window.innerWidth <= 768) {
                    const backdrop = document.getElementById('mobileBackdrop');
                    if (backdrop) backdrop.classList.toggle('show', panel.style.display !== 'none');
                }
            }

            updateColor(type, value) {
                this.colorGrading[type] = parseFloat(value);
                this.applyColorGrading();
                // 🆕 Color wheels & sliders : un Ctrl+Z doit revenir avant le drag.
                // Debouncé pour qu'un drag continu = 1 seule entrée d'historique.
                this._scheduleSaveState();
            }

            applyColorGrading() {
                // Double tampon : l'étalonnage doit être appliqué aux DEUX lecteurs
                // (sinon il disparaît dès que la lecture bascule sur #previewVideoB).
                const video = document.getElementById('previewVideo');
                const videoB = document.getElementById('previewVideoB');
                const image = document.getElementById('previewImage');
                
                // N1 fix: gamma is the midpoint wheel — add it to lift+gain average
                const brightness = 100 + (this.colorGrading.lift / 2) + (this.colorGrading.gamma / 2) + (this.colorGrading.gain / 2);
                const contrast = this.colorGrading.contrast;
                const saturation = this.colorGrading.saturation;
                const hueRotate = this.colorGrading.temp;
                
                let filterString = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hueRotate}deg)`;
                
                // Combine with active FX filter (avoids overwriting one or the other)
                if (this._fxFilter) filterString += ' ' + this._fxFilter;
                
                // Skip DOM write if filter string is identical (avoids forced style recalc at 60fps)
                if (filterString === this._lastColorGradingFilter) return;
                this._lastColorGradingFilter = filterString;
                
                if (video) video.style.filter = filterString;
                if (videoB) videoB.style.filter = filterString;
                if (image) image.style.filter = filterString;
            }

            applyColorGradingToContext(ctx) {
                // Apply color grading to canvas context (mirrors the CSS filter path).
                const brightness = 100 + (this.colorGrading.lift / 2) + (this.colorGrading.gamma / 2) + (this.colorGrading.gain / 2);
                const contrast = this.colorGrading.contrast;
                const saturation = this.colorGrading.saturation;
                const hueRotate = this.colorGrading.temp;

                const filterString = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hueRotate}deg)`;
                // Skip the assignment when nothing changed: setting ctx.filter forces the
                // browser to re-parse and re-bind the GPU filter chain even when the
                // string is identical — measurable cost at 30/60fps export.
                if (ctx._lastFilter !== filterString) {
                    ctx.filter = filterString;
                    ctx._lastFilter = filterString;
                }
            }

            applyFilterPreset(preset, clickedEl) {
                // Remove active class from all presets
                document.querySelectorAll('.filter-preset').forEach(el => el.classList.remove('active'));
                
                // Add active class to clicked preset (if triggered from UI)
                if (clickedEl) clickedEl.classList.add('active');
                
                // Define filter presets (Instagram-style)
                const presets = {
                    none: { lift: 0, gamma: 0, gain: 0, saturation: 100, contrast: 100, temp: 0 },
                    warm: { lift: 5, gamma: 0, gain: 10, saturation: 110, contrast: 105, temp: 10 },
                    cool: { lift: -5, gamma: 0, gain: 5, saturation: 105, contrast: 100, temp: -15 },
                    vivid: { lift: 0, gamma: 10, gain: 15, saturation: 130, contrast: 115, temp: 0 },
                    fade: { lift: 15, gamma: 5, gain: 0, saturation: 80, contrast: 90, temp: 0 },
                    vintage: { lift: 10, gamma: -5, gain: 5, saturation: 85, contrast: 110, temp: 15 },
                    cinema: { lift: -10, gamma: -5, gain: 0, saturation: 95, contrast: 120, temp: -5 },
                    noir: { lift: 0, gamma: 0, gain: 0, saturation: 0, contrast: 130, temp: 0 },
                    sepia: { lift: 20, gamma: 10, gain: 15, saturation: 50, contrast: 105, temp: 25 }
                };
                
                const filter = presets[preset];
                if (!filter) return;
                
                // Apply preset values
                this.colorGrading = { ...filter };
                
                // Update sliders
                document.querySelector('input[oninput*="lift"]').value = filter.lift;
                document.querySelector('input[oninput*="gamma"]').value = filter.gamma;
                document.querySelector('input[oninput*="gain"]').value = filter.gain;
                document.querySelector('input[oninput*="saturation"]').value = filter.saturation;
                document.querySelector('input[oninput*="contrast"]').value = filter.contrast;
                document.querySelector('input[oninput*="temp"]').value = filter.temp;
                
                // Update preview
                this.applyColorGrading();
                this.saveState();
                this.showStatus(`Filter "${preset}" applied`);
            }

            stepBackward() {
                if (this.isPlaying) this.pause();
                
                // Ensure video is in good state before stepping
                this._pausePreviewVideos();
                
                this.currentTime = Math.max(0, this.currentTime - 1 / (this.selectedFps || 30));
                this.forceVideoUpdate = true; // Force video update even for small changes
                this.updatePlayhead();
            }

            stepForward() {
                if (this.isPlaying) this.pause();
                
                // Ensure video is in good state before stepping
                this._pausePreviewVideos();
                
                this.currentTime = Math.min(this.MAX_TIMELINE, this.currentTime + 1 / (this.selectedFps || 30));
                this.forceVideoUpdate = true; // Force video update even for small changes
                this.updatePlayhead();
            }

            goToStart() {
                const wasPlaying = this.isPlaying;
                if (wasPlaying) {
                    this.pause();
                }
                
                const previewVideo = document.getElementById('previewVideo');
                if (previewVideo) {
                    if (!previewVideo.paused) {
                        previewVideo.pause();
                    }
                    // Clean up any pending load listeners / poll intervals
                    if (previewVideo._loadListener) {
                        if (typeof previewVideo._loadListener === 'number') {
                            clearInterval(previewVideo._loadListener);
                        } else {
                            previewVideo.removeEventListener('canplay', previewVideo._loadListener);
                        }
                        previewVideo._loadListener = null;
                    }
                    try {
                        previewVideo.currentTime = 0;
                    } catch (e) {
                        console.warn('Could not reset video time:', e);
                    }
                }
                
                this.currentTime = 0;
                this._currentPreviewClip = null;
                this.forceVideoUpdate = true;
                this.updatePlayhead();
            }

            goToEnd() {
                // CRITICAL FIX: Pause first to prevent video state conflicts
                if (this.isPlaying) this.pause();
                
                // Ensure video is in good state
                this._pausePreviewVideos();
                
                // Go to end of last clip
                const maxClipEnd = this.getTimelineEndTime();
                
                this.currentTime = maxClipEnd || 0;
                this._currentPreviewClip = null; // Force clip change detection
                this.forceVideoUpdate = true;
                this.updatePlayhead();
            }

            copyClip() {
                if (!this.selectedClip) {
                    this.showStatus('No clip selected');
                    return;
                }

                // Shallow copy — captures ALL own properties (FX, fade, style, etc.)
                this.clipboardClip = { ...this.selectedClip };
                this.showStatus('Clip copied');
            }

            pasteClip() {
                if (!this.clipboardClip) {
                    this.showStatus('No clip in clipboard');
                    return;
                }

                if (!this.selectedClip) {
                    // E2 fix: paste at playhead on first track when nothing is selected
                    const fallbackTrack = this.tracks.find(t => t.id === this.clipboardClip.trackId)
                                       || this.tracks[0];
                    if (!fallbackTrack) { this.showStatus('No track to paste onto'); return; }
                    const newClip = {
                        ...this.clipboardClip,
                        id: this.clipIdCounter++,
                        name: this.clipboardClip.name + ' (copy)',
                        startTime: this.quantizeTime(this.currentTime),
                        trackId: fallbackTrack.id
                    };
                    fallbackTrack.clips.push(newClip);
                    this.selectedClip = newClip;
                    this.saveState();
                    this.renderTracks();
                    this.renderProperties();
                    this.showStatus('Clip pasted at playhead');
                    return;
                }

                const track = this.tracks.find(t => t.id === this.selectedClip.trackId);
                if (!track) return;

                // Paste right after the selected clip
                const pasteTime = this.quantizeTime(this.selectedClip.startTime + this.selectedClip.duration);

                // Spread copies ALL own properties (FX, style, fade, etc.)
                const newClip = {
                    ...this.clipboardClip,
                    id: this.clipIdCounter++,
                    name: this.clipboardClip.name + ' (copy)',
                    startTime: pasteTime,
                    trackId: track.id
                };

                // Add new clip
                track.clips.push(newClip);

                // Select the new clip
                this.selectedClip = newClip;

                this.saveState();
                this.renderTracks();
                this.renderProperties();
                this.showStatus('Clip pasted after selection');
            }

            cutAtPlayhead() {
                if (!this.selectedClip) {
                    this.showStatus('No clip selected');
                    return;
                }

                const clip = this.selectedClip;
                const cutTime = this.quantizeTime(this.currentTime);

                // Check if playhead is within the clip
                if (cutTime <= clip.startTime || cutTime >= clip.startTime + clip.duration) {
                    this.showStatus('Playhead not on selected clip');
                    return;
                }

                // Create new clip for the second part
                const track = this.tracks.find(t => t.id === clip.trackId);
                if (!track) return;

                const secondPartDuration = this.quantizeTime((clip.startTime + clip.duration) - cutTime);
                const firstPartDuration = this.quantizeTime(cutTime - clip.startTime);
                const originalSourceStart = clip.sourceStart || 0;

                // Create new clip for the second part — inherit ALL properties via spread,
                // then override only the time/id fields so FX, style, fade, etc. are preserved.
                const newClip = {
                    ...clip,
                    id: this.clipIdCounter++,
                    name: clip.name + ' (2)',
                    startTime: cutTime,
                    duration: secondPartDuration,
                    sourceStart: this.quantizeTime(originalSourceStart + firstPartDuration),
                };

                // Shorten original clip
                clip.duration = firstPartDuration;

                // Add new clip BEFORE the original in the array so the scan finds it first
                // (foreground-first iteration). Insert right after the original clip's index.
                const clipIndex = track.clips.indexOf(clip);
                if (clipIndex >= 0) {
                    track.clips.splice(clipIndex + 1, 0, newClip);
                } else {
                    track.clips.push(newClip);
                }

                // Select second half
                this.selectedClip = newClip;

                this._invalidateTimelineEndCache();
                this._cachedActiveClip = null;
                this._currentPreviewClip = null;
                this._lastPreviewKey = null;
                this._lastXfKey = null;
                this.forceVideoUpdate = true;
                this.currentTime = cutTime;
                this.updatePlayhead();
                this.saveState();
                this.renderTracks();
                this.renderProperties();
                this.updatePreview();
                this.showStatus('Clip cut at playhead');
            }

            unlinkAudio() {
                if (!this.selectedClip) {
                    this.showStatus('No clip selected');
                    return;
                }

                const clip = this.selectedClip;

                // Only works with video clips
                if (clip.type !== 'video') {
                    this.showStatus('Select a video clip to unlink its audio');
                    return;
                }

                // Already unlinked? Otherwise a second click would create a SECOND audio
                // clip on top of the first: the track would play twice and the export
                // would be +6 dB louder (audible clipping). See the audio test 2026-09-10.
                if (clip.audioUnlinked) {
                    this.showStatus('⚠️ Audio already separated for this clip');
                    return;
                }

                // Find first available audio track that has space at this position, or create one
                let audioTrack = this.tracks.find(t => {
                    if (!t.name.includes('AUDIO')) return false;
                    const start = clip.startTime;
                    const end = clip.startTime + clip.duration;
                    return !t.clips.some(c => c.startTime < end && (c.startTime + c.duration) > start);
                });
                if (!audioTrack) {
                    audioTrack = {
                        id: this.trackIdCounter++,
                        name: 'AUDIO ' + (this.tracks.filter(t => t.name.includes('AUDIO')).length + 1),
                        clips: [],
                        muted: false,
                        solo: false,
                        volume: 100,
                        _effectiveMute: false
                    };
                    this.tracks.push(audioTrack);
                }

                // Create audio clip with same timing — always use ORIGINAL media URL (not proxy)
                const media = this.mediaLibrary.find(m => m.id === clip.mediaId);
                // Use originalUrl (pre-proxy) for the audio clip so it reads full-quality audio
                const audioUrl = (media && media.originalUrl) ? media.originalUrl
                    : (media && media.url) ? media.url
                    : (clip.originalUrl || clip.url);

                const audioClipId = this.clipIdCounter++;
                const audioClip = {
                    id: audioClipId,
                    mediaId: clip.mediaId,
                    name: clip.name + ' [AUDIO]',
                    url: audioUrl,
                    type: 'audio',
                    startTime: clip.startTime,
                    duration: clip.duration,
                    sourceDuration: clip.sourceDuration,
                    sourceStart: clip.sourceStart || 0,
                    trackId: audioTrack.id
                };

                audioTrack.clips.push(audioClip);

                // Mute video's built-in audio (permanent, no re-link)
                clip.audioUnlinked = true;
                clip.audioMuted = true;

                this.saveState();
                this.renderTracks();
                this.updatePreview();
                this.showStatus('🔓 Audio unlinked → ' + audioTrack.name);
            }

            // ============================================
            // MEDIA MANAGEMENT
            // ============================================

            /**
             * Open the file browser for media import.
             * Uses the modern showOpenFilePicker API (Chrome/Edge 86+) which displays
             * a native multi-file dialog. Falls back to the hidden <input> on Firefox/Safari.
             */
            async openFileBrowser() {
                if ('showOpenFilePicker' in window) {
                    try {
                        const handles = await window.showOpenFilePicker({
                            multiple: true,
                            types: [
                                {
                                    description: 'Video, Audio & Images',
                                    accept: {
                                        'video/*': ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'],
                                        'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'],
                                        'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
                                    }
                                }
                            ]
                        });
                        if (handles.length === 0) return;
                        const files = await Promise.all(handles.map(h => h.getFile()));
                        this.handleFiles(files);
                    } catch (e) {
                        // AbortError = user cancelled — silent
                        if (e.name !== 'AbortError') console.warn('openFileBrowser error:', e);
                    }
                } else {
                    // Fallback: traditional hidden <input type="file">
                    document.getElementById('fileInput').click();
                }
            }

            async handleFiles(files) {
                if (!files || files.length === 0) {
                    return;
                }
                
                // Prevent duplicate imports - check if already processing
                if (this.isProcessingFiles) {
                    return;
                }
                
                this.isProcessingFiles = true;
                this.showLoading();
                let importedCount = 0;
                
                for (const file of files) {
                    // Check if file already exists in library - reuse existing entry
                    const existingMedia = this.mediaLibrary.find(m => 
                        m.name === file.name && m.file && m.file.size === file.size
                    );
                    
                    if (existingMedia) {
                        // Update file reference but keep the same URL to avoid re-creating blob
                        existingMedia.file = file;
                        importedCount++;
                        continue;
                    }

                    let blobUrl;
                    try {
                        blobUrl = URL.createObjectURL(file);
                    } catch (err) {
                        console.error('URL.createObjectURL failed for', file.name, err);
                        this.showStatus(`❌ Cannot import ${file.name} (browser quota exceeded)`, 'error');
                        continue;
                    }

                    const mediaType = this.detectMediaType(file);
                    if (mediaType === 'unknown') {
                        try { URL.revokeObjectURL(blobUrl); } catch (_) {}
                        this.showStatus(`❌ ${file.name} : format non supporté`, 'error');
                        continue;
                    }

                    const media = {
                        id: this.mediaIdCounter++,
                        name: file.name,
                        file: file,
                        url: blobUrl, // Only create blob URL once
                        type: mediaType,
                        duration: 0,
                        fps: null,
                        width: 0,
                        height: 0,
                        thumbnails: [], // Timeline thumbnail strip
                        proxyUrl: null,
                        proxyWidth: 0,
                        proxyHeight: 0,
                        useProxy: false, // Flag to use proxy during editing
                        proxyGenerating: false
                    };

                    // Get duration and FPS for video/audio
                    if (media.type === 'video' || media.type === 'audio') {
                        const metadata = await this.getMediaMetadata(media.url, media.type);
                        media.duration = metadata.duration;
                        media.fps = metadata.fps;
                        media.width = metadata.width || 0;
                        media.height = metadata.height || 0;

                        // 🎞️ AUDIT EXPORT 2026-09-10 — mesure du VRAI frame rate source.
                        // `getMediaMetadata` ne peut pas le connaître (le décodeur ne
                        // rapporte aucune frame avant lecture) ; sans cette étape une
                        // source 24/25/50/60 fps était étiquetée 30 fps et l'export ne
                        // faisait aucune conversion de cadence.
                        if (media.type === 'video' && media.duration > 0) {
                            try {
                                const detected = await this.detectVideoFps(media.url, media.fps || 30);
                                if (detected && isFinite(detected) && detected > 0) {
                                    media.fps = detected;
                                }
                            } catch (e) {
                                console.warn(`⚠️ ${media.name}: détection FPS ignorée (${e && e.message})`);
                            }
                        }

                        // 🛡️ FIX 2026-05-08 — défense ultime contre Infinity / NaN.
                        //   Si le scan WebM a échoué (timeout, fichier corrompu), on refuse
                        //   l'import plutôt que de planter la timeline plus tard.
                        if (!isFinite(media.duration) || media.duration <= 0) {
                            console.error(`❌ Import refusé: ${media.name} — durée invalide (${media.duration}). Le fichier WebM est peut-être corrompu ou sans index.`);
                            this.showStatus(`❌ ${media.name} : durée invalide. Réencodez le fichier (ex : ffmpeg -i input.webm -c copy output.webm) puis réimportez.`, 'error');
                            try { URL.revokeObjectURL(media.url); } catch (_) {}
                            continue;
                        }
                        
                        // 🛡️ GARDE-FOU: Détection automatique des vidéos haute résolution
                        if (media.type === 'video' && media.width > 0) {
                            const pixelCount = media.width * media.height;
                            const is4K = pixelCount >= (3840 * 2160 * 0.9); // ~4K or higher
                            const is2K = pixelCount >= (2560 * 1440 * 0.9); // ~2K or higher
                            
                            // 🚫 BLOCAGE STRICT pour petites machines
                            if (window.exportSafeguards) {
                                const sysInfo = window.exportSafeguards.systemInfo;
                                
                                if (is4K && sysInfo.performanceLevel === 'low') {
                                    console.error(`🚫 IMPORT BLOQUÉ: ${media.name} (${media.width}x${media.height})`);
                                    console.error(`❌ Vidéos 4K interdites sur machines LOW performance (${sysInfo.memory}GB RAM, ${sysInfo.cores} cores)`);
                                    this.showStatus(`🚫 IMPORT REFUSÉ: ${media.name} est en 4K. Votre machine ne peut pas gérer cette résolution (${sysInfo.memory}GB RAM). Utilisez max 1080p.`, 'error');
                                    alert(`🚫 IMPORT BLOQUÉ\n\nLa vidéo "${media.name}" est en résolution 4K (${media.width}x${media.height}).\n\nVotre machine (${sysInfo.memory}GB RAM, ${sysInfo.cores} cores) ne peut PAS gérer cette résolution en toute sécurité.\n\n✅ SOLUTION: Réduisez d'abord la résolution à 1080p maximum avant de l'importer.`);
                                    try { URL.revokeObjectURL(media.url); } catch (_) {}
                                    continue; // Skip this file
                                }
                                
                                if (is2K && sysInfo.performanceLevel === 'low') {
                                    console.warn(`⚠️ IMPORT LIMITÉ: ${media.name} (${media.width}x${media.height})`);
                                    this.showStatus(`⚠️ Vidéo 2K détectée: ${media.name}. Attendez-vous à des ralentissements sur cette machine.`, 'warning');
                                    if (!confirm(`⚠️ ATTENTION\n\nLa vidéo "${media.name}" est en résolution 2K (${media.width}x${media.height}).\n\nVotre machine (${sysInfo.memory}GB RAM) risque des ralentissements importants.\n\n✅ Recommandation: Utilisez des vidéos 1080p ou moins.\n\nContinuer quand même l'import?`)) {
                                        try { URL.revokeObjectURL(media.url); } catch (_) {}
                                        continue; // Skip if user refuses
                                    }
                                }
                            }
                            
                            if (is4K) {
                                console.warn(`⚠️ 4K+ VIDEO DETECTED: ${media.name} (${media.width}x${media.height})`);
                                this.showStatus(`⚠️ 4K video detected: ${media.name}. Generating proxy for smooth editing...`);
                                
                                media.proxyGenerating = true;
                                this.generateSmartProxy(media).then(proxyUrl => {
                                    if (proxyUrl) {
                                        media.useProxy = true;
                                        console.log(`✅ Proxy ready for ${media.name}`);
                                        this.showStatus(`✅ Proxy ready for ${media.name}`);
                                        this.renderMediaLibrary();
                                    }
                                }).catch(e => {
                                    console.error('Proxy generation failed:', e);
                                    this.showStatus(`⚠️ Proxy generation failed for ${media.name}. Will use original quality.`);
                                }).finally(() => {
                                    media.proxyGenerating = false;
                                });
                            } else if (is2K) {
                                console.warn(`⚠️ 2K VIDEO DETECTED: ${media.name} (${media.width}x${media.height})`);
                                this.showStatus(`ℹ️ 2K video: ${media.name}. May impact performance on older machines.`);
                            }
                            
                            // Auto-proxy pour toutes les videos sur machines lentes (Mac Intel, etc.)
                            if (!is4K && !is2K && window.exportSafeguards) {
                                const sysInfo = window.exportSafeguards.systemInfo;
                                if (sysInfo.performanceLevel === 'low' && media.type === 'video' && media.width > 0) {
                                    console.log(`🛡️ LOW perf: auto-proxy for ${media.name} (${media.width}x${media.height})`);
                                    media.proxyGenerating = true;
                                    this.generateSmartProxy(media).then(proxyUrl => {
                                        if (proxyUrl) {
                                            media.useProxy = true;
                                            console.log(`✅ Proxy ready for ${media.name}`);
                                            this.renderMediaLibrary();
                                        }
                                    }).catch(e => { console.warn('Proxy failed:', e); })
                                      .finally(() => { media.proxyGenerating = false; });
                                }
                            }
                        }
                    } else {
                        media.duration = 3; // Default for images
                    }

                    this.mediaLibrary.push(media);
                    importedCount++;
                }

                this.isProcessingFiles = false;
                this.hideLoading();
                this.renderMediaLibrary();
                this.showStatus(`${importedCount}/${files.length} file(s) imported`);
                
                // Generate thumbnails in background AFTER all files imported
                // Single batch to avoid multiple renderTracks calls
                const thumbPromises = [];
                for (const file of files) {
                    const media = this.mediaLibrary.find(m => m.name === file.name && m.file && m.file.size === file.size);
                    if (media && (!media.thumbnails || media.thumbnails.length === 0)) {
                        thumbPromises.push(this.generateThumbnails(media));
                    }
                }
                if (thumbPromises.length > 0) {
                    Promise.all(thumbPromises).then(() => {
                        this.renderTracks(); // Single refresh after ALL thumbnails ready
                        this.renderMediaLibrary(); // Media bar shows the single first thumbnail
                    });
                }
            }

            /**
             * Import files AND immediately place them as clips on a specific track.
             * Used when dragging files from desktop directly onto timeline tracks.
             */
            async handleFilesAndAddToTrack(files, trackId, startTime = 0) {
                // First import files into the media library
                await this.handleFiles(files);
                
                // Now find the newly added media entries and place them on the track
                let currentTime = startTime;
                let placedCount = 0;
                for (const file of files) {
                    const media = this.mediaLibrary.find(m => m.name === file.name && m.file && m.file.size === file.size);
                    if (media) {
                        const clip = this.addClipToTrack(media, trackId, currentTime);
                        if (clip) {
                            currentTime = this.quantizeTime(currentTime + clip.duration);
                            placedCount++;
                        }
                    }
                }
                this.showStatus(`✓ ${placedCount}/${files.length} clip(s) added to timeline`);
            }

            /**
             * Generate thumbnail strip for a media item (video or image).
             * Extracts small frames at regular intervals for timeline display.
             */
            async generateThumbnails(media) {
                const THUMB_HEIGHT = 62;
                // 🖼️ Vignette AU BON RAPPORT (2026-09-17) : on impose la HAUTEUR (celle du clip)
                //    et la largeur suit le rapport de l'image. Avant, un cadre fixe de 60×62
                //    recevait l'image centrée sur fond noir : une vidéo 16:9 n'occupait que
                //    60×34 de ce cadre, donc la vignette affichée gardait des bandes noires
                //    en haut et en bas. Avec la largeur déduite, l'image remplit exactement
                //    la hauteur du clip — aucune bande, aucune déformation.
                const THUMB_MIN_WIDTH = 32;   // portrait très étroit (9:16 ⇒ ~35 px)
                const THUMB_MAX_WIDTH = 240;  // panoramique extrême (2.39:1 ⇒ ~148 px)
                // 🖼️ Vignettes de timeline — « super light » (2026-09-17)
                //    Une image toutes les 2,5 s, plafonnée à 8 : on n'en AFFICHE qu'une seule
                //    (celle du début du clip, voir `createClipElement`), mais en garder quelques-unes
                //    permet de montrer la bonne image quand le début du clip a été rogné
                //    (`clip.sourceStart`) au lieu de toujours montrer l'image de 0 s.
                //    Coût réel : ≈ 1,5 Ko par vignette en JPEG 60×62 qualité 0,28, soit au pire
                //    8 × 1,5 Ko ≈ 12 Ko par média — négligeable, et ce sont des data URL, donc
                //    aucune mémoire vidéo ni décodage.
                const MAX_VIDEO_THUMBS = 8;
                const TARGET_SECONDS_PER_THUMB = 2.5;
                
                if (media.type === 'image') {
                    try {
                        const img = new Image();
                        img.crossOrigin = 'anonymous';
                        await new Promise((resolve, reject) => {
                            img.onload = resolve;
                            img.onerror = reject;
                            img.src = media.url;
                        });
                        const ratio = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : 1;
                        const thumbW = Math.max(THUMB_MIN_WIDTH, Math.min(THUMB_MAX_WIDTH, Math.round(THUMB_HEIGHT * ratio)));
                        const canvas = document.createElement('canvas');
                        canvas.width = thumbW;
                        canvas.height = THUMB_HEIGHT;
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = '#000';
                        ctx.fillRect(0, 0, thumbW, THUMB_HEIGHT);
                        // `thumbW` suit déjà le rapport de l'image : le dessin remplit le cadre
                        // exactement, sans bande noire et sans déformation.
                        ctx.drawImage(img, 0, 0, thumbW, THUMB_HEIGHT);
                        const url = canvas.toDataURL('image/jpeg', 0.35);
                        media.thumbnails = [url];
                        media.thumbnailFrames = [{ time: 0, url }];
                    } catch (e) {
                        console.warn('Thumb gen failed (image):', media.name);
                    }
                    return;
                }
                
                if (media.type !== 'video') return;
                
                try {
                    const video = document.createElement('video');
                    video.crossOrigin = 'anonymous';
                    video.muted = true;
                    video.preload = 'auto';
                    video.src = media.url;
                    
                    await new Promise((resolve, reject) => {
                        video.onloadeddata = resolve;
                        video.onerror = reject;
                        setTimeout(reject, 8000);
                    });
                    
                    const duration = video.duration || media.duration;
                    if (!duration || duration <= 0) return;
                    
                    const canvas = document.createElement('canvas');
                    canvas.height = THUMB_HEIGHT;
                    canvas.width = Math.max(THUMB_MIN_WIDTH, Math.min(THUMB_MAX_WIDTH,
                        Math.round(THUMB_HEIGHT * ((video.videoWidth || 16) / (video.videoHeight || 9)))));
                    const thumbW = canvas.width;
                    const ctx = canvas.getContext('2d');
                    const thumbCount = Math.max(1, Math.min(MAX_VIDEO_THUMBS, Math.ceil(duration / TARGET_SECONDS_PER_THUMB)));
                    const frames = [];

                    for (let i = 0; i < thumbCount; i++) {
                        const ratio = thumbCount === 1 ? 0.08 : i / (thumbCount - 1);
                        const seekTime = Math.min(Math.max(0.05, duration * ratio), Math.max(0.05, duration - 0.05));
                        video.currentTime = seekTime;
                        await new Promise(resolve => {
                            let settled = false;
                            const done = () => {
                                if (settled) return;
                                settled = true;
                                video.removeEventListener('seeked', done);
                                resolve();
                            };
                            video.addEventListener('seeked', done, { once: true });
                            setTimeout(done, 1200);
                        });
                        if (!video.videoWidth || !video.videoHeight) continue;
                        ctx.fillStyle = '#000';
                        ctx.fillRect(0, 0, thumbW, THUMB_HEIGHT);
                        ctx.drawImage(video, 0, 0, thumbW, THUMB_HEIGHT);
                        frames.push({ time: seekTime, url: canvas.toDataURL('image/jpeg', 0.28) });
                    }

                    media.thumbnailFrames = frames;
                    media.thumbnails = frames.map(frame => frame.url);
                    video.src = '';
                    console.log(`🖼 ${media.thumbnails.length} thumbs for ${media.name}`);
                } catch (e) {
                    console.warn('Thumb gen failed (video):', media.name);
                }
            }

            detectMediaType(file) {
                const type = (file.type || '').split('/')[0];
                if (type === 'video') return 'video';
                if (type === 'audio') return 'audio';
                if (type === 'image') return 'image';
                // 🛡️ FIX 2026-05-08 : fallback par extension quand file.type est vide.
                //   Cas typique : .webm sur Windows quand le MIME n'est pas enregistré
                //   dans le registre OS → file.type === '' → import bloqué (type='unknown').
                //   Idem pour certains .mkv / .m4v / .ogv / .opus / .flac selon l'OS.
                const name = (file.name || '').toLowerCase();
                const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
                const VIDEO_EXTS = ['mp4','webm','mov','avi','mkv','m4v','ogv','ogg','3gp','3g2','mpg','mpeg','ts','mts','m2ts'];
                const AUDIO_EXTS = ['mp3','wav','ogg','m4a','aac','flac','opus','wma','aiff','aif'];
                const IMAGE_EXTS = ['jpg','jpeg','png','gif','webp','bmp','svg','tif','tiff','avif','heic','heif'];
                if (VIDEO_EXTS.includes(ext)) return 'video';
                if (AUDIO_EXTS.includes(ext)) return 'audio';
                if (IMAGE_EXTS.includes(ext)) return 'image';
                return 'unknown';
            }

            getMediaMetadata(url, type) {
                return new Promise((resolve) => {
                    // Hard timeout so a corrupted/unreadable file never hangs the import loop.
                    let settled = false;
                    const safeResolve = (data) => {
                        if (settled) return;
                        settled = true;
                        if (timeoutId) clearTimeout(timeoutId);
                        resolve(data);
                    };
                    const timeoutId = setTimeout(() => {
                        console.warn('getMediaMetadata: timeout for', url);
                        safeResolve({ duration: type === 'image' ? 5.0 : 0, fps: null, width: 0, height: 0 });
                    }, 10000);

                    if (type === 'image') {
                        // Images have fixed duration (5 seconds by default)
                        const img = new Image();
                        img.onload = () => {
                            safeResolve({
                                duration: 5.0, // Default 5 seconds for images
                                fps: null,
                                width: img.width,
                                height: img.height
                            });
                        };
                        img.onerror = () => safeResolve({ duration: 5.0, fps: null, width: 0, height: 0 });
                        img.src = url;
                    } else {
                        const element = type === 'video' ? document.createElement('video') : new Audio();
                        // 🛡️ FIX 2026-05-08 : muet pour autoriser le seek silencieux
                        //   utilisé pour résoudre Infinity duration sur les WebM.
                        element.muted = true;
                        element.preload = 'metadata';
                        element.src = url;
                        element.onloadedmetadata = () => {
                            // 🛡️ FIX 2026-05-08 — WebM duration === Infinity workaround.
                            //   Les fichiers WebM (notamment MediaRecorder, OBS, captures
                            //   navigateur) rapportent duration = Infinity tant que le fichier
                            //   n'a pas été entièrement parcouru. Si on accepte cette valeur
                            //   telle quelle, le clip aura duration = Infinity → la timeline,
                            //   les boucles de rendu et les calculs de progression divisent
                            //   ou bouclent sur Infinity et l'app gèle/plante quand l'utilisateur
                            //   pose le clip sur une piste.
                            //   Solution : seek à un temps très grand (1e101) → le navigateur
                            //   parcourt le fichier, émet `durationchange` avec la vraie durée,
                            //   on remet currentTime à 0, puis on extrait les métadonnées.
                            const finalize = () => {
                            const metadata = {
                                duration: element.duration || 0,
                                fps: null,
                                width: type === 'video' ? (element.videoWidth || 0) : 0,
                                height: type === 'video' ? (element.videoHeight || 0) : 0
                            };
                            
                            // Try to get FPS for video (Chrome/modern browsers support this)
                            if (type === 'video' && element.videoWidth) {
                                // Some browsers expose frame rate through getVideoPlaybackQuality
                                if (element.getVideoPlaybackQuality) {
                                    const quality = element.getVideoPlaybackQuality();
                                    if (quality.totalVideoFrames > 0 && element.duration > 0) {
                                        metadata.fps = Math.round(quality.totalVideoFrames / element.duration);
                                    }
                                }
                                
                                // If not available, we cannot know the real rate here:
                                // the decoder reports no frames before playback. Report
                                // null and let `detectVideoFps()` measure it for real
                                // (audit export 2026-09-10 — this used to hardcode 30,
                                // which mislabeled every 24/25/50/60 fps source).
                                if (!metadata.fps) {
                                    metadata.fps = null;
                                }
                            }
                            
                            safeResolve(metadata);
                            };

                            if (element.duration === Infinity || isNaN(element.duration)) {
                                // Force the browser to scan the entire file to discover real duration.
                                let scanResolved = false;
                                const onDurationChange = () => {
                                    if (scanResolved) return;
                                    if (element.duration !== Infinity && !isNaN(element.duration) && element.duration > 0) {
                                        scanResolved = true;
                                        element.removeEventListener('durationchange', onDurationChange);
                                        // Reset playhead so future use starts at 0.
                                        try { element.currentTime = 0; } catch (_) {}
                                        finalize();
                                    }
                                };
                                element.addEventListener('durationchange', onDurationChange);
                                // Safety net: if scan never completes, fall back after 8s.
                                setTimeout(() => {
                                    if (!scanResolved) {
                                        scanResolved = true;
                                        element.removeEventListener('durationchange', onDurationChange);
                                        console.warn('getMediaMetadata: WebM duration scan timed out, using element.duration as-is');
                                        finalize();
                                    }
                                }, 8000);
                                try {
                                    element.currentTime = 1e101; // Triggers the full-file scan.
                                } catch (_) {
                                    // If the seek throws (rare), just finalize with whatever we have.
                                    if (!scanResolved) {
                                        scanResolved = true;
                                        element.removeEventListener('durationchange', onDurationChange);
                                        finalize();
                                    }
                                }
                            } else {
                                finalize();
                            }
                        };
                        element.onerror = () => safeResolve({ duration: 0, fps: null, width: 0, height: 0 });
                    }
                });
            }

            /**
             * 🎞️ DÉTECTION RÉELLE DU FRAME RATE SOURCE
             * ==========================================
             * 🐛 AUDIT EXPORT 2026-09-10 — Avant ce correctif, `getMediaMetadata`
             * écrivait `fps = 30` EN DUR (getVideoPlaybackQuality renvoie 0 tant que
             * la vidéo n'a pas joué). Résultat : une source 24, 25, 50 ou 60 fps était
             * étiquetée « 30 fps » partout dans l'app, et l'export ne faisait aucune
             * conversion de cadence (pas de frame dupliquée/sautée) → saccades et
             * mauvaise durée perçue.
             *
             * Cette méthode mesure le vrai débit de frames en ÉCOUTANT le décodeur :
             * `requestVideoFrameCallback` (Chrome/Edge/Safari) ou
             * `getVideoPlaybackQuality().totalVideoFrames` en secours, puis arrondit
             * vers une cadence standard (23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60).
             * Coût : ~0.6 s par média, une seule fois, à l'import.
             */
            /**
             * Détecte la cadence RÉELLE d'une source vidéo.
             *
             * 🐛 POURQUOI L'ANCIENNE MÉTHODE SE TROMPAIT (mesuré : 27,78 fps pour un
             * fichier 30 fps, soit −7 %, souvent « snappé » à 29,97 à tort) :
             * elle comptait les callbacks `requestVideoFrameCallback` et divisait par le
             * temps média parcouru. Or à l'import le thread principal est occupé
             * (vignettes, formes d'onde, DOM) et **rVFC fusionne les callbacks** : on en
             * reçoit MOINS que de frames réellement présentées. Sur une fenêtre de ~26
             * frames, un compte faux de ±1 frame = ±4 % d'erreur.
             *
             * ✅ MÉTHODE RETENUE : on ne compte plus, on **mesure l'intervalle entre
             * frames** à partir des `mediaTime` reçus, et on prend la **médiane** des
             * écarts. Un callback manqué crée un écart double, que la médiane ignore ;
             * le résultat est donc exact même sous charge. Bonus : 6 échantillons
             * suffisent (~200 ms) au lieu de 600-1200 ms.
             */
            async detectVideoFps(url, fallback = 30) {
                const STANDARD_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
                const video = document.createElement('video');
                video.src = url;
                video.muted = true;
                video.playsInline = true;
                video.preload = 'auto';
                video.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';

                try {
                    document.body.appendChild(video);
                    await new Promise(resolve => {
                        if (video.readyState >= 1) return resolve();
                        const done = () => { video.removeEventListener('loadedmetadata', done); resolve(); };
                        video.addEventListener('loadedmetadata', done, { once: true });
                        setTimeout(resolve, 5000);
                        video.load();
                    });

                    if (!video.videoWidth) return fallback;

                    // Fenêtre d'observation courte : on veut 6 intervalles mesurés.
                    const OBSERVE_MS = Math.min(900, Math.max(500, (video.duration || 2) * 200));
                    const mediaTimes = [];

                    await new Promise(resolve => {
                        let settled = false;
                        const startedAt = Date.now();
                        const finish = () => {
                            if (settled) return;
                            settled = true;
                            try { video.pause(); } catch (_) {}
                            resolve();
                        };

                        if (typeof video.requestVideoFrameCallback === 'function') {
                            const onFrame = (_now, metadata) => {
                                mediaTimes.push(metadata.mediaTime);
                                if (mediaTimes.length < 24 && Date.now() - startedAt < OBSERVE_MS) {
                                    video.requestVideoFrameCallback(onFrame);
                                } else {
                                    finish();
                                }
                            };
                            video.requestVideoFrameCallback(onFrame);
                            video.play().catch(finish);
                            setTimeout(finish, OBSERVE_MS + 400);
                        } else {
                            // Repli : qualité de lecture cumulée (moins précis, Safari anciens)
                            video.play().catch(finish);
                            const poll = setInterval(() => {
                                if (video.getVideoPlaybackQuality) {
                                    mediaTimes.push(video.currentTime);
                                    const q = video.getVideoPlaybackQuality();
                                    if (q.totalVideoFrames > 24) { clearInterval(poll); finish(); }
                                }
                                if (Date.now() - startedAt >= OBSERVE_MS) { clearInterval(poll); finish(); }
                            }, 100);
                            setTimeout(finish, OBSERVE_MS + 400);
                        }
                    });

                    // 1) Médiane des écarts entre frames (robuste aux callbacks manqués)
                    const deltas = [];
                    for (let i = 1; i < mediaTimes.length; i++) {
                        const d = mediaTimes[i] - mediaTimes[i - 1];
                        if (d > 1e-5 && d < 0.5) deltas.push(d);
                    }

                    if (deltas.length >= 3) {
                        const sorted = [...deltas].sort((a, b) => a - b);
                        const median = sorted[Math.floor(sorted.length / 2)];
                        const measured = 1 / median;
                        if (isFinite(measured) && measured > 1 && measured < 240) {
                            // Snap sur une cadence standard si on en est proche à 2 % près
                            // (une cadence « presque standard » est presque toujours un
                            // standard : 29,97 et 30 se mesurent à la même chose).
                            const snapped = STANDARD_FPS.reduce(
                                (best, c) => Math.abs(c - measured) < Math.abs(best - measured) ? c : best,
                                STANDARD_FPS[0]
                            );
                            const result = Math.abs(snapped - measured) / snapped <= 0.02
                                ? snapped
                                : Math.round(measured * 100) / 100;
                            console.log(`🎞️ FPS source détecté: ${result} (médiane des écarts ${(median * 1000).toFixed(2)} ms sur ${deltas.length} intervalles)`);
                            return result;
                        }
                    }

                    // 2) Repli : ancienne méthode (compte des callbacks / temps parcouru)
                    if (mediaTimes.length >= 4) {
                        const span = mediaTimes[mediaTimes.length - 1] - mediaTimes[0];
                        if (span > 0) {
                            const measured = (mediaTimes.length - 1) / span;
                            if (isFinite(measured) && measured > 1 && measured < 240) {
                                const snapped = STANDARD_FPS.reduce(
                                    (best, c) => Math.abs(c - measured) < Math.abs(best - measured) ? c : best,
                                    STANDARD_FPS[0]
                                );
                                const result = Math.abs(snapped - measured) / snapped <= 0.12
                                    ? snapped : Math.round(measured * 100) / 100;
                                console.log(`🎞️ FPS source (repli): ${result} (mesuré ${measured.toFixed(2)})`);
                                return result;
                            }
                        }
                    }
                } catch (e) {
                    console.warn('⚠️ FPS detection failed:', e && e.message);
                } finally {
                    try { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); } catch (_) {}
                }
                return fallback;
            }

            // ============================================
            // TRACK MANAGEMENT
            // ============================================
            
            addTrack(name) {
                const track = {
                    id: this.trackIdCounter++,
                    name: name || `TRACK ${this.trackIdCounter}`,
                    muted: false,
                    solo: false,
                    volume: 100,
                    clips: [],
                    _effectiveMute: false
                };
                this.tracks.push(track);
                this.saveState();
                this.renderTracks();
                return track;
            }

            deleteTrack(trackId) {
                // 🛡️ ERGONOMIE (2026-09-10) — le bouton × de l'en-tête de piste est
                // collé aux boutons M/S et supprime la piste AVEC TOUS ses clips, sans
                // confirmation ni possibilité d'annuler autrement que par Ctrl+Z.
                // On demande confirmation dès que la piste contient des clips.
                const trackToDelete = this.tracks.find(t => t.id === trackId);
                if (trackToDelete && trackToDelete.clips && trackToDelete.clips.length > 0) {
                    const n = trackToDelete.clips.length;
                    const msg = (window.I18N && window.I18N.lang === 'fr')
                        ? `Supprimer la piste « ${trackToDelete.name} » et ses ${n} clip(s) ?\n\n(Ctrl+Z permet d'annuler.)`
                        : `Delete track "${trackToDelete.name}" and its ${n} clip(s)?\n\n(Ctrl+Z can undo this.)`;
                    if (!window.confirm(msg)) return;
                }
                // Clear selection if it belonged to this track
                if (this.selectedClip && this.selectedClip.trackId === trackId) {
                    this.selectedClip = null;
                }
                this.tracks = this.tracks.filter(t => t.id !== trackId);
                this.saveState();
                this.fullRefresh();
            }

            toggleMute(trackId) {
                const track = this.tracks.find(t => t.id === trackId);
                if (track) {
                    track.muted = !track.muted;
                    this.saveState();
                    if (this.isPlaying) {
                        // Lightweight DOM update during play
                        const btn = document.querySelector(`.track-btn-m[onclick="app.toggleMute(${trackId})"]`);
                        if (btn) { btn.classList.toggle('muted', track.muted); btn.title = track.muted ? 'Désactiver mute' : 'Muter la piste'; }
                    } else {
                        this.renderTracks();
                    }
                    this.updatePreview();
                    this.updateAudioTracks();
                    this.updateAudioVolumes();
                    this.showStatus(`Track ${track.name}: ${track.muted ? 'Muted' : 'Unmuted'}`);
                }
            }

            toggleSolo(trackId) {
                const track = this.tracks.find(t => t.id === trackId);
                if (track) {
                    track.solo = !track.solo;
                    
                    // If solo is enabled, check if any track has solo
                    const anySolo = this.tracks.some(t => t.solo);
                    
                    // Apply solo logic: if any track has solo, effectively mute others
                    this.tracks.forEach(t => {
                        t._effectiveMute = anySolo && !t.solo;
                    });
                    
                    this.saveState();
                    if (this.isPlaying) {
                        this.tracks.forEach(t => {
                            const btn = document.querySelector(`.track-btn-s[onclick="app.toggleSolo(${t.id})"]`);
                            if (btn) { btn.classList.toggle('solo', t.solo); btn.title = t.solo ? 'Désactiver solo' : 'Isoler la piste'; }
                        });
                    } else {
                        this.renderTracks();
                    }
                    this.updatePreview(); // Update video/image preview
                    this.updateAudioTracks(); // Update audio tracks
                    this.updateAudioVolumes(); // Apply _effectiveMute to audio elements
                    this.showStatus(`Track ${track.name}: ${track.solo ? 'Solo' : 'Solo Off'}`);
                }
            }

            handleVolumeInput(trackId, slider) {
                const val = parseFloat(slider.value);
                // Update visual fill via CSS variable
                slider.style.setProperty('--vol', val + '%');
                slider.title = 'Volume: ' + val + '%';
                // Update sibling display value
                const valEl = slider.closest('.track-vol-row') && slider.closest('.track-vol-row').querySelector('.track-vol-val');
                if (valEl) valEl.textContent = val;
                // Update track data + audio
                this.setTrackVolume(trackId, val);
            }

            setTrackVolume(trackId, volume) {
                const track = this.tracks.find(t => t.id === trackId);
                if (track) {
                    track.volume = parseFloat(volume);
                    this.updateAudioVolumes();
                    this._scheduleSaveState(); // F3 fix: volume changes must be undoable (debounced for slider drag)
                }
            }

            updateAudioVolumes() {
                // Update preview video volume
                const previewVideo = document.getElementById('previewVideo');
                // Iterate top-down (i=0 first) — same order as updatePreview so the
                // volume matches the track whose clip is actually being displayed. (G1 fix)
                if (previewVideo && previewVideo.src) {
                    for (let i = 0; i < this.tracks.length; i++) {
                        const track = this.tracks[i];
                        let found = false;
                        for (const clip of track.clips) {
                            if ((clip.type === 'video' || clip.type === 'image') && this.isTimeInClip(this.currentTime, clip)) {
                                const vol = (track.volume !== undefined ? track.volume : 100) / 100;
                                previewVideo.volume = (track.muted || track._effectiveMute) ? 0 : vol;
                                found = true;
                                break;
                            }
                        }
                        if (found) break;
                    }
                }

                // Update audio elements volumes
                Object.keys(this.audioElements).forEach(audioId => {
                    const audioEl = this.audioElements[audioId];
                    if (audioEl && audioEl._trackId) {
                        const track = this.tracks.find(t => t.id === audioEl._trackId);
                        if (track) {
                            const volume = (track.volume !== undefined ? track.volume : 100) / 100;
                            audioEl.volume = (track.muted || track._effectiveMute) ? 0 : volume;
                        }
                    }
                });
            }

            releaseAudioElements() {
                Object.keys(this.audioElements || {}).forEach(audioId => {
                    const audioEl = this.audioElements[audioId];
                    if (!audioEl) return;
                    try { audioEl.pause(); } catch (_) {}
                    try { audioEl.removeAttribute('src'); } catch (_) {}
                    try { audioEl.src = ''; } catch (_) {}
                    try { audioEl.load(); } catch (_) {}
                    try { audioEl.remove(); } catch (_) {}
                });
                this.audioElements = {};
            }

            // ============================================
            // CLIP MANAGEMENT
            // ============================================
            
            addClipToTrack(media, trackId, startTime = 0) {
                const track = this.tracks.find(t => t.id === trackId);
                if (!track) return;

                // 🛡️ FIX 2026-05-08 — refus défensif des médias à durée invalide.
                //   Garde-fou contre les WebM dont la durée n'a jamais pu être résolue
                //   (bug classique : duration === Infinity tant que le fichier n'a pas
                //   été scanné). Sans ce filet, déposer un tel clip gèle la timeline.
                if (media.type !== 'image' && (!isFinite(media.duration) || media.duration <= 0)) {
                    console.error(`❌ addClipToTrack refusé: ${media.name} — durée invalide (${media.duration}).`);
                    this.showStatus(`❌ ${media.name} : durée invalide, impossible de placer sur la timeline.`, 'error');
                    return null;
                }

                // 🛡️ GARDE-FOU: Utiliser le proxy si disponible pour l'édition
                const useProxyUrl = media.useProxy && media.proxyUrl;
                const effectiveUrl = useProxyUrl ? media.proxyUrl : media.url;
                
                if (useProxyUrl) {
                    console.log(`📹 Using PROXY for clip: ${media.name} (${media.proxyWidth}x${media.proxyHeight})`);
                }

            const clip = {
                id: this.clipIdCounter++,
                mediaId: media.id,
                name: media.name,
                url: effectiveUrl, // Use proxy URL if available
                originalUrl: media.url, // Keep original for export
                type: media.type,
                startTime: this.quantizeTime(startTime),
                duration: this.quantizeTime(media.duration),
                sourceDuration: media.type === 'image' ? Infinity : media.duration,
                sourceStart: 0,
                trackId: trackId,
                width: useProxyUrl ? media.proxyWidth : media.width,
                height: useProxyUrl ? media.proxyHeight : media.height,
                isUsingProxy: useProxyUrl
            };

            track.clips.push(clip);
                this._invalidateTimelineEndCache();
                this.saveState();
                this.renderTracks();
                this.updatePreview(); // refresh preview immediately so new clip is visible
                this.showStatus(`Clip added: ${clip.name}${useProxyUrl ? ' (proxy)' : ''}`);
                
                // Preload video in background for smooth playback
                if (media.type === 'video') {
                    this.cacheVideoElement(effectiveUrl);
                }
                
                return clip;
            }

            deleteClip(clip) {
                const track = this.tracks.find(t => t.id === clip.trackId);
                if (track) {
                    track.clips = track.clips.filter(c => c.id !== clip.id);
                    this.selectedClip = null;
                    this._invalidateTimelineEndCache();
                    this.saveState();
                    this.renderTracks();
                    this.renderProperties();
                    this.showStatus('Clip deleted');
                }
            }

            // N4 fix: ripple-delete — removes clip and shifts later clips on the same track left
            rippleDeleteClip(clip) {
                const track = this.tracks.find(t => t.id === clip.trackId);
                if (!track) return;
                const deletedStart = clip.startTime;
                const deletedDuration = clip.duration;
                track.clips = track.clips.filter(c => c.id !== clip.id);
                // Shift every clip that starts strictly after the deleted clip's own start.
                // Using >= gapEnd (old code) left clips that started inside the deleted
                // range unshifted, creating invisible gaps in the timeline.
                track.clips.forEach(c => {
                    if (c.startTime > deletedStart) {
                        c.startTime = this.quantizeTime(Math.max(0, c.startTime - deletedDuration));
                    }
                });
                this.selectedClip = null;
                this._invalidateTimelineEndCache();
                this.saveState();
                this.renderTracks();
                this.renderProperties();
                this.updatePreview();
                this.showStatus('Clip ripple-deleted (Shift+Delete)');
            }

            deleteMedia(mediaId) {
                const media = this.mediaLibrary.find(m => m.id === mediaId);
                if (!media) return;

                // Check if media is used in any clips
                const isUsed = this.tracks.some(track => 
                    track.clips.some(clip => clip.mediaId === mediaId)
                );

                if (isUsed) {
                    const confirm = window.confirm(
                        `"${media.name}" is used in the timeline. Delete it anyway?\n\nThis will also remove all clips using this media.`
                    );
                    if (!confirm) return;

                    // Remove all clips using this media
                    this.tracks.forEach(track => {
                        track.clips = track.clips.filter(clip => clip.mediaId !== mediaId);
                    });

                    // Deselect if selected clip was using this media
                    if (this.selectedClip && this.selectedClip.mediaId === mediaId) {
                        this.selectedClip = null;
                    }

                    this.renderTracks();
                    this.renderProperties();
                }

                // Remove from library
                this.mediaLibrary = this.mediaLibrary.filter(m => m.id !== mediaId);

                // Remove all history entries that reference this media's blob URLs.
                // Revoking a blob while it's still reachable from the undo stack would
                // make Ctrl+Z restore a project with broken (silent/blank) media.
                const urlsToRevoke = [
                    media.url && media.url.startsWith('blob:') ? media.url : null,
                    media.proxyUrl && media.proxyUrl.startsWith('blob:') ? media.proxyUrl : null
                ].filter(Boolean);

                if (urlsToRevoke.length > 0) {
                    // Drop history snapshots that reference any of these blob URLs so
                    // Ctrl+Z cannot restore a project with broken (revoked) media.
                    const stackBefore = this.historyIndex;
                    this.history = this.history.filter((snap) => {
                        const s = JSON.stringify(snap);
                        return urlsToRevoke.every(u => !s.includes(u));
                    });
                    this.historyIndex = Math.min(stackBefore, this.history.length - 1);
                }

                urlsToRevoke.forEach(u => this.releaseCachedVideoUrl(u));

                this.saveState();

                // Safe to revoke now: no remaining history entry references these URLs
                urlsToRevoke.forEach(u => URL.revokeObjectURL(u));

                this.renderMediaLibrary();
                this.showStatus(`✓ "${media.name}" removed from library`);
            }

            getMediaForClip(clip) {
                return this.mediaLibrary.find(m => m.id === clip.mediaId);
            }

            // ============================================
            // TIMELINE
            // ============================================
            
            getTimelineEnd() {
                let maxTime = 0;
                this.tracks.forEach(track => {
                    track.clips.forEach(clip => {
                        const end = clip.startTime + clip.duration;
                        if (end > maxTime) maxTime = end;
                    });
                });
                // Tight padding: 5 seconds after last clip, or 10 seconds if empty
                return maxTime > 0 ? maxTime + 5 : 10;
            }

            getTimelineViewportWidth() {
                const timelineScroll = document.getElementById('timelineScroll');
                if (!timelineScroll) {
                    return Math.max(240, window.innerWidth - this.TRACK_HEADER_WIDTH - 40);
                }

                return Math.max(240, timelineScroll.clientWidth - this.TRACK_HEADER_WIDTH);
            }

            getMinZoomLevel() {
                const timelineEnd = this.getTimelineEnd();
                if (timelineEnd <= 0) return 5;

                const fitZoom = this.getTimelineViewportWidth() / timelineEnd;

                // 🐛 CORRECTIF (2026-09-17) — « en dézoomant je perds les numéros ».
                //    L'ancien calcul était `Math.min(5, Math.max(0.05, fitZoom))`, qui
                //    PLAFONNAIT le zoom minimum à 5 px/s : sur un montage de 14 s on pouvait
                //    donc dézoomer jusqu'à 70 px de large (mesuré : 109 px avec la marge).
                //    Le montage s'écrasait dans un coin et la règle du temps ne montrait plus
                //    qu'un seul repère « 00:00 ».
                //    Désormais : on peut dézoomer jusqu'à ce que le montage occupe environ un
                //    TIERS de la largeur visible (assez pour préparer la suite du montage),
                //    jamais jusqu'à l'illisible. Les très longues timelines gardent un plancher
                //    absolu de 0,05 px/s pour rester entièrement visibles.
                const fitWithMargin = fitZoom / 3;
                return Math.max(0.05, Math.min(fitWithMargin, 60));
            }

            clampZoomLevel(zoom) {
                return Math.min(500, Math.max(this.getMinZoomLevel(), zoom));
            }

            handleTimelineClick(e) {
                const rect = e.target.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const time = x / this.zoomLevel;
                this.currentTime = time;
                this.updatePlayhead();
            }

            handleRulerClick(e) {
                const rulerContent = document.getElementById('rulerContent');
                const rect = rulerContent.getBoundingClientRect();
                // `_rulerScrollLeft` est tenu à jour par _syncRulerScroll (le ruler lui-même
                // ne défile plus : voir le correctif de désynchronisation).
                const scrollLeft = this._rulerScrollLeft !== undefined ? this._rulerScrollLeft : rulerContent.scrollLeft;
                const x = e.clientX - rect.left + scrollLeft;
                const time = Math.max(0, x / this.zoomLevel);
                
                this.currentTime = Math.min(time, this.getTimelineEnd());
                this._lastPreviewKey = null;   // force overlay rebuild
                this.forceVideoUpdate = true;  // force seek even if same clip
                this.updatePlayhead();
                
                if (this.isPlaying) {
                    this.pause();
                }
            }

            startPlayheadDrag(e) {
                e.preventDefault();
                
                const wasPlaying = this.isPlaying;
                if (wasPlaying) {
                    this.pause();
                }

                const timelineScroll = document.getElementById('timelineScroll');
                const rulerContent = document.getElementById('rulerContent');

                const onMove = (e) => {
                    // Utiliser rulerContent qui est aligné avec la zone de temps (sans headers)
                    const rect = rulerContent.getBoundingClientRect();
                    const scrollLeft = timelineScroll ? timelineScroll.scrollLeft : 0;
                    const x = e.clientX - rect.left + scrollLeft;
                    const time = Math.max(0, Math.min(this.MAX_TIMELINE, x / this.zoomLevel));
                    
                    this.currentTime = time;
                    this.forceVideoUpdate = true; // ensure seek on every scrub position
                    this.updatePlayhead();
                };

                const onUp = () => {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    document.removeEventListener('pointercancel', onUp);
                    window.removeEventListener('blur', onUp); // N8 fix
                    this._lastPreviewKey = null; // Force overlay rebuild after scrub
                    this.forceVideoUpdate = true;
                };

                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
                document.addEventListener('pointercancel', onUp);
                window.addEventListener('blur', onUp); // N8 fix: release on focus loss
            }

            zoomIn() {
                this.zoomLevel = this.clampZoomLevel(this.zoomLevel * 1.2);
                this.renderTracks();
            }

            zoomOut() {
                this.zoomLevel = this.clampZoomLevel(this.zoomLevel / 1.2);
                this.renderTracks();
            }

            toggleVideoFocus() {
                const btn = document.getElementById('viewFocusBtn');
                const tl = document.querySelector('.timeline-area');
                this._videoFocus = !this._videoFocus;
                if (btn) btn.classList.toggle('active', this._videoFocus);
                if (tl) tl.style.height = this._videoFocus ? '44px' : '300px';
                document.body.classList.toggle('video-focus-active', this._videoFocus);
            }

            // ============================================
            // PLAYBACK
            // ============================================
            
            getTimelineEndTime() {
                // Return cached value if still valid (invalidated on clip add/delete/move)
                if (this._cachedTimelineEnd !== undefined) return this._cachedTimelineEnd;
                // Calculate the end time of the last element on the timeline
                let maxEndTime = 0;
                
                this.tracks.forEach(track => {
                    track.clips.forEach(clip => {
                        const clipEndTime = clip.startTime + clip.duration;
                        if (clipEndTime > maxEndTime) {
                            maxEndTime = clipEndTime;
                        }
                    });
                });
                
                this._cachedTimelineEnd = maxEndTime;
                return maxEndTime;
            }
            
            _invalidateTimelineEndCache() {
                this._cachedTimelineEnd = undefined;
                this._cachedActiveClip = null;       // Force track re-scan
                this._lastXfKey = null;              // Force transform re-apply
            }

            togglePlay() {
                console.log('togglePlay - current state:', this.isPlaying);
                
                if (this.isPlaying) {
                    this.pause();
                } else {
                    // Ensure playback timer is cleared before starting
                    if (this.playbackTimer) {
                        cancelAnimationFrame(this.playbackTimer);
                        this.playbackTimer = null;
                    }

                    // Prime the preview at the exact playhead before the clock starts.
                    this.forceVideoUpdate = true;
                    this.updatePreview();
                    
                    // Preload audio clips at current position BEFORE starting playback
                    this.preloadAudioAtCurrentTime();
                    
                    // Pre-buffer the preview video at the current position so the decoder
                    // is warm before the first RAF frame fires. Without this, weak machines
                    // (Intel Macs, old PCs) enter the 100ms polling fallback in updatePreview()
                    // on the first few frames, causing visible stutter/jitter.
                    // After pause/resume the video element is already primed, so this is a no-op.
                    const _preBuf = () => {
                        const pv = this._previewVideo;
                        if (!pv || pv.readyState >= 3) return;
                        // updatePreview() will have set the src and called .load() if needed;
                        // we just need to give the decoder a short window to reach HAVE_ENOUGH_DATA.
                        // If the video is still loading after 300ms, we proceed anyway —
                        // the polling fallback in updatePreview() will handle the rest.
                        if (pv.readyState < 2) {
                            pv.addEventListener('canplay', function onReady() {
                                pv.removeEventListener('canplay', onReady);
                                // Let the decoder finish buffering
                            }, { once: true });
                        }
                    };
                    _preBuf();
                    
                    this.isPlaying = true;
                    this.updateAudioTracks();
                    
                    // Update playhead controller icons
                    const playIcon = document.getElementById('playIcon');
                    const pauseIcon = document.getElementById('pauseIcon');
                    if (playIcon) playIcon.style.display = 'none';
                    if (pauseIcon) pauseIcon.style.display = 'block';
                    
                    // Update timeline header controller icons
                    const timelinePlayIcon = document.getElementById('timelinePlayIcon');
                    const timelinePauseIcon = document.getElementById('timelinePauseIcon');
                    if (timelinePlayIcon) timelinePlayIcon.style.display = 'none';
                    if (timelinePauseIcon) timelinePauseIcon.style.display = 'block';
                    
                    this.play();
                }
                
                console.log('togglePlay - new state:', this.isPlaying);
            }

            preloadAudioAtCurrentTime() {
                // Preload audio clips that will be active at current time
                // This prevents audio lag on first play
                const activeAudioClips = [];
                
                this.tracks.forEach(track => {
                    if (track.muted || track._effectiveMute) return;
                    
                    track.clips.forEach(clip => {
                        if (clip.type === 'audio') {
                            if (this.isTimeInClip(this.currentTime, clip)) {
                                activeAudioClips.push({ clip, track });
                            }
                        }
                    });
                });
                
                // Create and preload audio elements
                activeAudioClips.forEach(({ clip, track }) => {
                    const audioId = `audio_${clip.id}`;
                    
                    if (!this.audioElements[audioId]) {
                        const audioEl = document.createElement('audio');
                        audioEl.id = audioId;
                        audioEl.src = clip.url;
                        audioEl.preload = 'auto'; // Force preload
                        audioEl.volume = (track.volume !== undefined ? track.volume : 100) / 100;
                        audioEl.playbackRate = 1.0;
                        audioEl.defaultPlaybackRate = 1.0;
                        audioEl.preservesPitch = true;
                        audioEl.mozPreservesPitch = true;
                        audioEl.webkitPreservesPitch = true;
                        audioEl._trackId = track.id;
                        audioEl.style.display = 'none';
                        document.body.appendChild(audioEl);
                        this.audioElements[audioId] = audioEl;
                        
                        // Set initial time position
                        const clipTime = this.currentTime - clip.startTime;
                        const sourceTime = (clip.sourceStart || 0) + clipTime;
                        
                        // Wait for audio to be ready
                        if (audioEl.readyState >= 2) {
                            audioEl.currentTime = sourceTime;
                        } else {
                            audioEl.addEventListener('loadeddata', () => {
                                try {
                                    audioEl.currentTime = sourceTime;
                                } catch (e) {
                                    console.warn('Could not set audio time:', e);
                                }
                            }, { once: true });
                        }
                    }
                });
            }

            play() {
                if (this.playbackTimer) return; // Already playing
                
                // G6 fix: monotonic clock — use `let` so VIDEO-DRIVEN correction can re-anchor
                let startTime = performance.now();
                let initialTime = this.currentTime;
                this._playbackClockLastTime = this.currentTime;

                const update = () => {
                    if (!this.isPlaying) {
                        this.playbackTimer = null;
                        return;
                    }

                    const elapsed = (performance.now() - startTime) / 1000;
                    // Quantize to 0.0001s for perfect clip boundaries
                    const clockTime = Math.round((initialTime + elapsed) * this.TIME_PRECISION) / this.TIME_PRECISION;
                    this.currentTime = Math.max(this._playbackClockLastTime || 0, clockTime);

                    // VIDEO-DRIVEN CLOCK: only let the decoder pull the playhead forward.
                    // If the video decoder is late and we re-anchor backwards, the timeline
                    // visibly does an unpleasant back-and-forth during playback.
                    if (!this._isLowPerfMachine && !this.prefs.previewForcePerformance && !this.forceVideoUpdate) {
                        const _pv = this._previewVideo;
                        const _pc = this._currentPreviewClip;
                        if (_pv && _pc && _pc.type === 'video' && !_pv.paused && _pv.readyState >= 3) {
                            const videoAppTime = _pc.startTime + _pv.currentTime - (_pc.sourceStart || 0);
                            const drift = videoAppTime - this.currentTime;
                            if (drift > 0.033 && drift < 0.25) {
                                startTime = performance.now();
                                initialTime = videoAppTime;
                                this.currentTime = videoAppTime;
                            }
                        }
                    }

                    this._playbackClockLastTime = this.currentTime;

                    // Get the end time of the last element on timeline
                    const timelineEndTime = this.getTimelineEndTime();
                    
                    // Stop at the end of the last element (if there are elements)
                    if (timelineEndTime > 0 && this.currentTime >= timelineEndTime) {
                        if (this.prefs.loopPlayback) {
                            startTime = performance.now();
                            initialTime = 0;
                            this.currentTime = 0;
                            this._playbackClockLastTime = 0;
                            this.updatePlayhead();
                            this.playbackTimer = requestAnimationFrame(update);
                            return;
                        }
                        this.currentTime = timelineEndTime;
                        this.pause();
                        this.showStatus('End of timeline reached');
                        return;
                    }

                    // Safety limit - timeline extends infinitely
                    if (this.currentTime >= this.MAX_TIMELINE) {
                        this.currentTime = this.MAX_TIMELINE;
                        this.pause();
                        this.showStatus('Maximum timeline duration reached (3 hours)');
                        return;
                    }

                    this.updatePlayhead();

                    this.playbackTimer = requestAnimationFrame(update);
                };

                update();
            }

            pause() {
                this.isPlaying = false;
                this._lastPreviewKey = null;         // Force overlay rebuild on next updatePreview after pause
                this._lastFxKey = null;              // Force FX re-apply after pause
                this._lastColorGradingFilter = null; // Force color grading re-apply after pause
                this._lastXfKey = null;              // Force _applyVideoTransform on next frame
                this._lastOverlayAnimKey = null;     // Force overlay animation on next frame
                this._cachedActiveClip = null;       // Force track scan on next frame
                // Reset adaptive preview state on pause
                this._adaptiveFpsWindow = null;
                this._adaptiveLowPerf = false;
                this._adaptivePreviewActive = false;
                this._previewUseProxy = false;
                this._playbackClockLastTime = null;

                // CRITICAL: Cancel playback timer to allow replay
                if (this.playbackTimer) {
                    cancelAnimationFrame(this.playbackTimer);
                    this.playbackTimer = null;
                }
                
                // Update playhead controller icons
                const playIcon = document.getElementById('playIcon');
                const pauseIcon = document.getElementById('pauseIcon');
                if (playIcon) playIcon.style.display = 'block';
                if (pauseIcon) pauseIcon.style.display = 'none';
                
                // Update timeline header controller icons
                const timelinePlayIcon = document.getElementById('timelinePlayIcon');
                const timelinePauseIcon = document.getElementById('timelinePauseIcon');
                if (timelinePlayIcon) timelinePlayIcon.style.display = 'block';
                if (timelinePauseIcon) timelinePauseIcon.style.display = 'none';
                
                // Stop BOTH preview elements — avec le double tampon, l'élément actif
                // n'est pas forcément #previewVideo : n'en oublier un laisserait un
                // lecteur caché continuer à jouer (audio fantôme + décodage inutile).
                for (const previewVideo of [this._previewVideo, this._previewVideoB, document.getElementById('previewVideo'), document.getElementById('previewVideoB')]) {
                    if (!previewVideo) continue;
                    try {
                        if (!previewVideo.paused) previewVideo.pause();
                    } catch (e) {
                        console.warn('Pause error (non-critical):', e);
                    }
                    
                    // Clean up any pending load listeners / poll intervals
                    if (previewVideo._loadListener) {
                        if (typeof previewVideo._loadListener === 'number') {
                            clearInterval(previewVideo._loadListener);
                        } else {
                            previewVideo.removeEventListener('canplay', previewVideo._loadListener);
                        }
                        previewVideo._loadListener = null;
                    }
                }
                
                // Stop all audio tracks
                this.updateAudioTracks();

                // Hide any stale transition canvas
                if (this._transitionCanvas) this._transitionCanvas.style.display = 'none';
            }

            updateAudioTracks() {
                // Find all active audio clips (only pure audio clips, not video clips)
                const activeAudioClips = [];
                
                this.tracks.forEach(track => {
                    // Skip if track is muted or solo logic says it should be muted
                    if (track.muted || track._effectiveMute) return;
                    
                    track.clips.forEach(clip => {
                        // Only handle pure audio clips (audio type only)
                        // Video clips handle their own audio through previewVideo element
                        if (clip.type === 'audio') {
                            if (this.isTimeInClip(this.currentTime, clip)) {
                                activeAudioClips.push({ clip, track });
                            }
                        }
                    });
                });

                // Manage audio elements for each active clip
                const currentAudioIds = new Set();
                
                activeAudioClips.forEach(({ clip, track }) => {
                    const audioId = `audio_${clip.id}`;
                    currentAudioIds.add(audioId);
                    
                    let audioEl = this.audioElements[audioId];
                    
                    if (!audioEl) {
                        // Create new audio element with preload
                        audioEl = document.createElement('audio');
                        audioEl.id = audioId;
                        audioEl.src = clip.url;
                        audioEl.preload = 'auto'; // Force preload for smooth playback
                        audioEl.volume = 1.0;
                        audioEl._trackId = track.id; // Store trackId for updateAudioVolumes()
                        audioEl.style.display = 'none';
                        document.body.appendChild(audioEl);
                        this.audioElements[audioId] = audioEl;
                    }
                    
                    // Apply track volume (mute/solo already filtered above)
                    const trackVolume = (track.volume !== undefined ? track.volume : 100) / 100;
                    audioEl.volume = trackVolume;
                    // Guarantee no time-stretch from any earlier playbackRate experiment
                    if (audioEl.playbackRate !== 1.0) audioEl.playbackRate = 1.0;
                    audioEl.defaultPlaybackRate = 1.0;
                    audioEl.preservesPitch = true;
                    audioEl.mozPreservesPitch = true;
                    audioEl.webkitPreservesPitch = true;

                    const clipTime = this.currentTime - clip.startTime;
                    const sourceTime = (clip.sourceStart || 0) + clipTime;
                    
                    // Check if we've exceeded the source duration
                    const sourceDuration = clip.sourceDuration || Infinity;
                    if (sourceTime >= sourceDuration) {
                        // Past the end of the source audio, pause it
                        if (!audioEl.paused) {
                            audioEl.pause();
                        }
                        return;
                    }
                    
                    // Sync audio time. Every currentTime write triggers a decoder seek which
                    // is audible as a click/pop on MP3 and AAC. While playing, we let the
                    // element clock run free and only correct when drift becomes large
                    // enough that the user can perceive desync (>250 ms). While scrubbing
                    // (isPlaying=false) we still snap immediately so the preview feels
                    // responsive.
                    if (audioEl.readyState >= 2) {
                        const driftThreshold = this.isPlaying ? 0.25 : 0.05;
                        if (Math.abs(audioEl.currentTime - sourceTime) > driftThreshold) {
                            try {
                                audioEl.currentTime = sourceTime;
                            } catch (e) {
                                console.warn('Could not sync audio time:', e);
                            }
                        }
                    } else {
                        // Audio not ready yet, wait for it to load
                        if (!audioEl._syncListener) {
                            audioEl._syncListener = () => {
                                try {
                                    audioEl.currentTime = sourceTime;
                                    audioEl._syncListener = null;
                                } catch (e) {
                                    console.warn('Could not set initial audio time:', e);
                                }
                            };
                            audioEl.addEventListener('loadeddata', audioEl._syncListener, { once: true });
                        }
                    }
                    
                    // Play/pause based on timeline state
                    if (this.isPlaying) {
                        if (audioEl.paused) {
                            if (audioEl.readyState >= 2) {
                                audioEl.play().catch(e => console.log('Audio play blocked:', e));
                            } else {
                                // Not ready yet — start play as soon as loaded.
                                // Guard against duplicate listeners (updateAudioTracks is called
                                // from toggleMute/toggleSolo and can re-enter while isPlaying).
                                if (!audioEl._canplayPending) {
                                    audioEl._canplayPending = true;
                                    audioEl.addEventListener('canplay', () => {
                                        audioEl._canplayPending = false;
                                        if (this.isPlaying) {
                                            audioEl.play().catch(e => console.log('Audio play blocked:', e));
                                        }
                                    }, { once: true });
                                }
                            }
                        }
                    } else {
                        if (!audioEl.paused) {
                            audioEl.pause();
                        }
                    }
                });
                
                // Stop and remove audio elements that are no longer active
                Object.keys(this.audioElements).forEach(audioId => {
                    if (!currentAudioIds.has(audioId)) {
                        const audioEl = this.audioElements[audioId];
                        if (audioEl) {
                            audioEl.pause();
                            audioEl.remove();
                            delete this.audioElements[audioId];
                        }
                    }
                });
            }

            updatePlayhead() {
                // Cache DOM elements queried on every rAF frame
                if (!this._domPlayhead)      this._domPlayhead      = document.getElementById('playhead');
                if (!this._domRulerPH)       this._domRulerPH       = document.getElementById('rulerPlayhead');
                if (!this._domTimelineScroll) this._domTimelineScroll = document.getElementById('timelineScroll');
                if (!this._domRulerContent)  this._domRulerContent  = document.getElementById('rulerContent');
                if (!this._domTimeDisplay)   this._domTimeDisplay   = document.getElementById('timeDisplay');

                const playhead = this._domPlayhead;
                if (!playhead) return;
                // FIX: Add track header width offset so playhead aligns with clips.
                // Round to integer pixels to kill sub-pixel jitter during playback.
                playhead.style.left = Math.round(this.TRACK_HEADER_WIDTH + this.currentTime * this.zoomLevel) + 'px';

                // Sync ruler playhead indicator
                const rulerPlayhead = this._domRulerPH;
                if (rulerPlayhead) {
                    rulerPlayhead.style.left = Math.round(this.currentTime * this.zoomLevel) + 'px';
                }

                // Auto-scroll timeline to follow playhead during playback
                if (this.isPlaying) {
                    const timelineScroll = this._domTimelineScroll;
                    if (timelineScroll) {
                        const playheadX = this.currentTime * this.zoomLevel;
                        const scrollLeft = timelineScroll.scrollLeft;
                        const viewportWidth = timelineScroll.clientWidth;
                        
                        // Keep playhead in center 40% of viewport during playback
                        const targetPosition = playheadX - (viewportWidth * 0.4);
                        
                        // Only scroll if playhead is approaching edges or out of view
                        if (playheadX < scrollLeft + (viewportWidth * 0.2) || 
                            playheadX > scrollLeft + (viewportWidth * 0.8)) {
                            const targetScrollLeft = Math.max(0, targetPosition);
                            const delta = targetScrollLeft - scrollLeft;
                            timelineScroll.scrollLeft = scrollLeft + delta * 0.22;
                        }
                    }
                    
                    // Also scroll ruler
                    const rulerContent = this._domRulerContent;
                    if (rulerContent && timelineScroll) {
                        rulerContent.scrollLeft = timelineScroll.scrollLeft;
                    }
                }

                // Update time display — show actual content end, not padded timeline end
                const contentEnd = this.getTimelineEndTime();
                const currentStr = this.formatTime(this.currentTime);
                const totalStr = this.formatTime(contentEnd || 0);
                const timeDisplay = this._domTimeDisplay;
                if (timeDisplay) {
                    timeDisplay.textContent = `${currentStr} / ${totalStr}`;
                }

                // Update video preview
                // 🛡️ Frame dropping for slow machines: skip preview update every other frame.
                // The playhead and time display still update at full rate, but the heavy
                // video decode + canvas draw is halved → much smoother on Mac Intel.
                // The manual "performance" preference forces this behaviour on demand.
                if (!(this._isLowPerfMachine || this.prefs.previewForcePerformance) || !this.isPlaying || (this._frameSkipCounter = (this._frameSkipCounter || 0) + 1) % 2 === 0) {
                    this.updatePreview();
                }
                
                // ── Adaptive preview quality detection ──────────────────────────
                const now = performance.now();
                if (this.prefs.adaptivePreview && this.isPlaying) {
                    if (!this._adaptiveFpsWindow) {
                        this._adaptiveFpsWindow = [];
                        this._adaptiveLastCheck = now;
                    }
                    this._adaptiveFpsWindow.push(now);
                    // Keep last 3 seconds of timestamps (max ~180 entries at 60fps)
                    const cutoff = now - 3000;
                    while (this._adaptiveFpsWindow.length && this._adaptiveFpsWindow[0] < cutoff) {
                        this._adaptiveFpsWindow.shift();
                    }
                    // Check every 2 seconds
                    if (now - this._adaptiveLastCheck > 2000) {
                        this._adaptiveLastCheck = now;
                        const windowFps = this._adaptiveFpsWindow.length / 3; // frames over 3s
                        if (windowFps < 20 && !this._adaptiveLowPerf) {
                            console.warn(`🐌 Preview FPS bas détecté (${windowFps.toFixed(1)} fps) — activation mode adaptatif`);
                            this._adaptiveLowPerf = true;
                            this._adaptivePreviewActive = true;
                            // Check proxy availability ONCE (not every check)
                            const hasAnyProxy = this.mediaLibrary.some(m => m.proxyUrl);
                            if (!hasAnyProxy) {
                                console.warn('⚠️ Aucun proxy disponible — la preview adaptative ne peut pas réduire la qualité. Générez des proxys via le clic droit sur un média.');
                            }
                            // Force proxy usage for preview (will fallback to original if no proxy)
                            this._previewUseProxy = true;
                        } else if (windowFps >= 25 && this._adaptiveLowPerf) {
                            console.log(`✅ Preview FPS rétabli (${windowFps.toFixed(1)} fps) — désactivation mode adaptatif`);
                            this._adaptiveLowPerf = false;
                            this._adaptivePreviewActive = false;
                            this._previewUseProxy = false;
                        }
                    }
                } else if (!this.isPlaying) {
                    // Clean up adaptive state when not playing (belt-and-suspenders with pause())
                    this._adaptiveFpsWindow = null;
                }
                
                // Update audio tracks (throttled to ~30fps for performance)
                if (!this._lastAudioUpdate || (now - this._lastAudioUpdate) > 33) {
                    this.updateAudioTracks();
                    this._lastAudioUpdate = now;
                }
            }

            formatTime(seconds) {
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }

            updatePreview() {
                // Cache static DOM references (getElementById on every rAF frame is wasteful)
                if (!this._previewVideo) {
                    this._previewVideo  = document.getElementById('previewVideo');
                    this._previewVideoB = document.getElementById('previewVideoB');
                }
                if (!this._previewImage)    this._previewImage    = document.getElementById('previewImage');
                if (!this._noVideoIcon)     this._noVideoIcon     = document.getElementById('noVideoIcon');
                if (!this._previewOverlays) this._previewOverlays = document.getElementById('previewOverlays');
                if (!this._transitionCanvas) this._transitionCanvas = document.getElementById('transitionCanvas');
                
                // 🛡️ Preview resolution limit for slow machines (Mac Intel, etc.)
                // Instead of shrinking the displayed size (which makes the preview tiny),
                // we keep the CSS size at 100% but let the video element decode at a lower
                // internal resolution. The browser's compositor scales it up smoothly.
                if (!this._lowPerfPreviewChecked) {
                    this._lowPerfPreviewChecked = true;
                    // Detect slow machines only when adaptive preview is explicitly enabled.
                    // Default stays full-quality/full-cadence so timeline and preview remain exact.
                    const _detectStart = performance.now();
                    this._isLowPerfMachine = false; // default
                    this._perfDetectionStart = _detectStart;
                    this._perfDetectionFrames = 0;
                }
                // After 30 frames (~0.5s), check if we're on a slow machine
                if (this._perfDetectionFrames !== undefined && this._perfDetectionFrames < 30) {
                    this._perfDetectionFrames++;
                } else if (this._perfDetectionFrames === 30) {
                    const elapsed = performance.now() - this._perfDetectionStart;
                    const avgFrame = elapsed / 30;
                    // If average frame time > 22ms (< 45fps), consider it a slow machine
                    // only in adaptive preview mode.
                    if (this.prefs.adaptivePreview && avgFrame > 22) {
                        this._isLowPerfMachine = true;
                        console.warn(`🐌 Machine lente détectée (${(1000/avgFrame).toFixed(0)} fps estimés) — mode performance activé`);
                    }
                    this._perfDetectionFrames = -1; // done
                }
                if ((this._isLowPerfMachine || this.prefs.previewForcePerformance) && this._previewVideo) {
                    // Reset any max-width/height that would shrink the preview
                    this._previewVideo.style.maxWidth = '';
                    this._previewVideo.style.maxHeight = '';
                    // Use a smaller internal resolution via the video element's
                    // intrinsic size hints. The CSS will scale it to fill the container.
                    this._previewVideo.style.width = '100%';
                    this._previewVideo.style.height = '100%';
                    this._previewVideo.style.objectFit = 'contain';
                }

                // ⚠️ `let` et non `const` : le double tampon ci-dessous peut faire
                //    basculer l'élément ACTIF (previewVideo ⇄ previewVideoB) au milieu
                //    de cette fonction. Tout le code qui suit doit alors travailler sur
                //    le nouvel élément.
                let previewVideo     = this._previewVideo;
                const previewImage   = this._previewImage;
                const noVideoIcon    = this._noVideoIcon;
                const previewOverlays = this._previewOverlays;

                if (!previewVideo || !previewImage) return;

                let activeVideoClip = null;
                let activeVideoTrackIndex = -1;
                let activeOverlays = [];

                // Fast path: if the cached clip is still active at currentTime, reuse it.
                // Do not reuse it at its end boundary: after a cut, the next clip that starts
                // exactly here must win, otherwise the preview can briefly paint the previous half.
                if (this._cachedActiveClip &&
                    this.isTimeInClip(this.currentTime, this._cachedActiveClip.clip) &&
                    !this._isAtClipEndBoundary(this.currentTime, this._cachedActiveClip.clip)) {
                    activeVideoClip = this._cachedActiveClip.clip;
                    activeVideoTrackIndex = this._cachedActiveClip.trackIndex;
                    // ── Même en fast path, il faut collecter les overlays (text/blocks) ──
                    for (let i = 0; i < this.tracks.length; i++) {
                        const track = this.tracks[i];
                        if (!track || track.muted || track._effectiveMute) continue;
                        if (!track.clips || !Array.isArray(track.clips)) continue;
                        for (const clip of track.clips) {
                            if ((clip.type === 'text' || clip.type === 'block') && this.isTimeInClip(this.currentTime, clip)) {
                                activeOverlays.push({ clip, trackIndex: i });
                            }
                        }
                    }
                } else {
                    // Iterate from TOP (index 0 = foreground) to BOTTOM (highest index = background)
                    // The FIRST video/image clip found = the topmost visible layer = displayed
                    for (let i = 0; i < this.tracks.length; i++) {
                        const track = this.tracks[i];
                        if (!track || track.muted || track._effectiveMute) continue;
                        if (!track.clips || !Array.isArray(track.clips)) continue;

                        for (const clip of track.clips) {
                            if (this.isTimeInClip(this.currentTime, clip)) {
                                if (clip.type === 'video' || clip.type === 'image') {
                                    if (!activeVideoClip ||
                                        (activeVideoTrackIndex === i && this._isAtClipStartBoundary(this.currentTime, clip))) {
                                        activeVideoClip = clip;
                                        activeVideoTrackIndex = i;
                                        this._cachedActiveClip = { clip, trackIndex: i };
                                    }
                                } else if (clip.type === 'text' || clip.type === 'block') {
                                    activeOverlays.push({ clip, trackIndex: i });
                                }
                            }
                        }
                    }
                }

                // 🔁 DOUBLE TAMPON D'APERÇU — voir _swapPreviewVideoIfReady() :
                //    si le clip qui commence est DÉJÀ chargé et pré-positionné sur
                //    l'autre lecteur, on permute l'affichage au lieu de cacher la vidéo
                //    et d'attendre un décodage (c'était la cause des images noires et des
                //    micro-blocages à chaque changement de séquence).
                if (this._swapPreviewVideoIfReady(activeVideoClip, activeVideoTrackIndex)) {
                    previewVideo = this._previewVideo;
                }

                // ── Overlay rebuild optimisation ────────────────────────────────────────
                // During playback, rebuilding previewOverlays innerHTML on every rAF frame
                // (60×/sec) causes heavy reflows.  Skip the rebuild entirely when the set
                // of active overlay clips and the selected clip haven't changed.
                activeOverlays.sort((a, b) => b.trackIndex - a.trackIndex);
                const _newOverlayKey = (activeVideoClip ? activeVideoClip.id : 'null') + '|' +
                    activeOverlays.map(o => o.clip.id).join(',') + '|' +
                    (this.selectedClip ? this.selectedClip.id : 'null');
                const _overlayUnchanged = (this.isPlaying || this._isTransformingPreview) && _newOverlayKey === this._lastPreviewKey;

                if (!_overlayUnchanged) {
                    this._lastPreviewKey = _newOverlayKey;

                    // Abort any running drag signal for overlay elements
                    if (this._overlayAbort) this._overlayAbort.abort();
                    this._overlayAbort = new AbortController();

                    if (previewOverlays) previewOverlays.innerHTML = '';

                    // Render Overlays (Text / Block)
                    const overlaySignal = this._overlayAbort.signal;
                    const _selId = this.selectedClip ? this.selectedClip.id : null;
                    activeOverlays.forEach(({ clip }) => {
                        const el = document.createElement('div');
                        // 🅣/🅢 Vrai cadre de sélection : on marque l'élément sélectionné
                        // pour que le CSS affiche un contour net + des poignées lisibles
                        // (avant, aucun retour visuel de sélection sur texte/bloc).
                        // ⚠️ Le flag est appliqué APRÈS l'affectation de `el.className`
                        // ci-dessous : dans le cas contraire, `className = 'overlay-text'`
                        // écrasait la classe et le contour n'apparaissait jamais.
                        const _isSelected = _selId !== null && clip.id === _selId;
                        if (clip.type === 'text') {
                            el.className = 'overlay-text';
                            el.textContent = clip.content;
                            if (clip.style) {
                                Object.assign(el.style, clip.style);
                            }
                            // 🅣 Ombre de texte optionnelle (OFF par défaut) — on force la
                            // valeur calculée pour que l'aperçu corresponde exactement à
                            // l'export, y compris quand l'ombre est désactivée.
                            el.style.textShadow = this._getTextShadowCss(clip.style);
                            const tx = clip.posX !== undefined ? clip.posX : 50;
                            const ty = clip.posY !== undefined ? clip.posY : 50;
                            el.style.left = tx + '%';
                            el.style.top = ty + '%';
                            el.style.transform = 'translate(-50%, -50%)';
                            el._cthClip = clip;
                            this.addTextDragHandles(el, clip, overlaySignal);
                        } else if (clip.type === 'block') {
                            el.className = 'overlay-block';
                            el.style.backgroundColor = clip.color;
                            el.style.opacity = clip.opacity || 1.0;
                            el.style.width = (clip.width || 50) + '%';
                            el.style.height = (clip.height || 50) + '%';
                            el.style.left = (clip.posX || 25) + '%';
                            el.style.top = (clip.posY || 25) + '%';
                            el.style.transformOrigin = 'center center';
                            el._cthClip = clip;
                            this.addBlockHandles(el, clip, overlaySignal);
                        }
                        // ⚠️ DOIT rester APRÈS les `el.className = ...` ci-dessus : sinon
                        // l'affectation écrase la classe et le contour de sélection
                        // n'apparaît jamais (bug constaté le 2026-09-10).
                        if (_isSelected) el.classList.add('ctf-selected');
                        if (previewOverlays) previewOverlays.appendChild(el);
                    });
                }

                // 🎬 Per-frame animation transform for text / block overlays.
                // Runs even when the overlay set is cached (playback), so animation
                // updates smoothly without rebuilding the DOM.
                if (previewOverlays && previewOverlays.children.length) {
                    for (const el of previewOverlays.children) {
                        const clip = el._cthClip;
                        if (!clip) continue;
                        const anim = this._calcClipAnimation(clip, this.currentTime - clip.startTime);
                        const rotDeg = anim.rot * 180 / Math.PI;
                        if (clip.type === 'text') {
                            const px = clip.posX !== undefined ? clip.posX : 50;
                            const py = clip.posY !== undefined ? clip.posY : 50;
                            el.style.left = (px + anim.tx) + '%';
                            el.style.top  = (py + anim.ty) + '%';
                            el.style.transform = `translate(-50%, -50%) scale(${anim.sx}) rotate(${rotDeg}deg)`;
                            el.style.opacity = (this._calcFadeOpacity(clip, this.currentTime) * anim.alpha);
                        } else if (clip.type === 'block') {
                            const px = clip.posX !== undefined ? clip.posX : 25;
                            const py = clip.posY !== undefined ? clip.posY : 25;
                            el.style.left = (px + anim.tx) + '%';
                            el.style.top  = (py + anim.ty) + '%';
                            el.style.transform = `scale(${anim.sx}) rotate(${rotDeg}deg)`;
                            el.style.opacity = ((clip.opacity != null ? clip.opacity : 1) *
                                this._calcFadeOpacity(clip, this.currentTime) * anim.alpha);
                        }
                    }
                }
                // ────────────────────────────────────────────────────────────────────────

                const overlaySignal = this._overlayAbort ? this._overlayAbort.signal : null;

                // Apply Clip Effect (FX) to preview + Color Grading (combined inside)
                this.applyClipEffectToPreview(activeVideoClip);

                // Préchargement du clip suivant sur le lecteur libre.
                // ⏱️ Intervalle RAMENÉ de 1 s à 250 ms : avec le double tampon il faut
                //    être sûr d'attraper la fenêtre de pré-roulage (0,7 s avant la coupe).
                //    Avec un contrôle toutes les secondes, un clip sur trois environ
                //    n'était jamais préchargé et la coupe restait saccadée.
                //    La fonction est très bon marché quand il n'y a rien à préparer.
                const _nowMs = performance.now();
                if (!this._lastPreloadTime || (_nowMs - this._lastPreloadTime) > 250) {
                    this._lastPreloadTime = _nowMs;
                    this.preloadUpcomingClips();
                }

                // Check if we're still on the same clip
                const clipChanged = !this._currentPreviewClip || 
                                   !activeVideoClip || 
                                   this._currentPreviewClip.id !== activeVideoClip.id;
                
                if (activeVideoClip) {
                    if (activeVideoClip.type === 'image') {
                        // Display image
                        if (clipChanged) {
                            previewImage.src = activeVideoClip.url;
                            previewImage.style.display = 'none';
                            previewVideo.style.display = 'none';
                            if (!previewVideo.paused) previewVideo.pause();
                            if (noVideoIcon) noVideoIcon.style.display = 'none';
                            this._currentPreviewClip = activeVideoClip;
                        }

                        const _xfKey = activeVideoClip.id + '|' +
                            (activeVideoClip.videoScale || 100) + '|' +
                            (activeVideoClip.videoPosX || 50) + '|' +
                            (activeVideoClip.videoPosY || 50) + '|' +
                            (activeVideoClip.animation ? activeVideoClip.animation.preset || 'none' : 'none') + '|' +
                            this.currentTime.toFixed(3);
                        if (this._lastXfKey !== _xfKey) {
                            this._lastXfKey = _xfKey;
                            this._applyVideoTransform(previewImage, activeVideoClip);
                        }

                        previewImage.style.display = 'block';
                        previewVideo.style.display = 'none';
                        if (noVideoIcon) noVideoIcon.style.display = 'none';

                        if (!_overlayUnchanged && previewOverlays && this.selectedClip && this.selectedClip.id === activeVideoClip.id && this._previewHandlesActive) {
                            this._addVideoSelectHandles(previewOverlays, activeVideoClip, overlaySignal);
                        }
                    } else {
                        // Display video
                        const clipTime = this.currentTime - activeVideoClip.startTime;
                        // Clamp so sourceTime never overshoots the clip or the video file duration
                        const frameOffset = 1 / ((this.selectedFps || 30) * 2); // half-frame safety margin
                        const rawSourceTime = (activeVideoClip.sourceStart || 0) + clipTime;
                        const sourceTime = Math.min(rawSourceTime,
                            (activeVideoClip.sourceStart || 0) + activeVideoClip.duration - frameOffset);

                        // Update video source if clip changed
                        if (clipChanged) {
                            // Hide video immediately — prevent phantom frame at old position
                            previewVideo.style.display = 'none';
                            previewImage.style.display = 'none';
                            if (noVideoIcon) noVideoIcon.style.display = 'none';

                            // Always hide transition canvas
                            const tcv = this._transitionCanvas;
                            if (tcv) tcv.style.display = 'none';
                            
                            // Resolve media to prefer proxy for preview
                            const mediaForClip = this.mediaLibrary.find(m => m.id === activeVideoClip.mediaId) || null;
                            const useProxy = this._previewUseProxy || (mediaForClip && mediaForClip.useProxy);
                            const preferredUrl = (useProxy && mediaForClip && mediaForClip.proxyUrl) 
                                ? mediaForClip.proxyUrl 
                                : activeVideoClip.url;

                            // Remove any pending load listener / poll interval
                            if (previewVideo._loadListener) {
                                if (typeof previewVideo._loadListener === 'number') {
                                    clearInterval(previewVideo._loadListener);
                                } else {
                                    previewVideo.removeEventListener('canplay', previewVideo._loadListener);
                                }
                                previewVideo._loadListener = null;
                            }
                            
                            // Pause but do NOT reset currentTime
                            try { if (!previewVideo.paused) previewVideo.pause(); } catch(e) {}
                            
                            // Use cached video or create new one
                            const cachedVideo = this.videoCache[preferredUrl];
                            
                            if (cachedVideo && cachedVideo.readyState >= 3 && cachedVideo.src === preferredUrl) {
                                if (previewVideo.src !== preferredUrl) {
                                    previewVideo.src = preferredUrl;
                                    previewVideo.load();
                                }
                            } else if (previewVideo.src !== preferredUrl) {
                                previewVideo.src = preferredUrl;
                                previewVideo.preload = 'auto';
                                previewVideo.load();
                                this.cacheVideoElement(preferredUrl);
                            }
                            
                            this.forceVideoUpdate = true;

                            // Audio handling for video clips
                            const track = this.tracks[activeVideoTrackIndex];
                            const trackMuted = track && (track.muted || track._effectiveMute);
                            const audioUnlinked = activeVideoClip.audioMuted || activeVideoClip.audioUnlinked;
                            const trackVol = track ? (track.volume !== undefined ? track.volume : 100) / 100 : 1.0;
                            
                            previewVideo.muted = trackMuted || audioUnlinked;
                            previewVideo.volume = (trackMuted || audioUnlinked) ? 0 : trackVol;
                            
                            this._currentPreviewClip = activeVideoClip;
                        }

                        let waitingForVideoFrame = false;

                        // Wait for video to be ready before syncing
                        if (previewVideo.readyState >= 2) {
                            const timeDiff = Math.abs(previewVideo.currentTime - sourceTime);
                            const previewDriftThreshold = (this._isLowPerfMachine || this.prefs.previewForcePerformance) ? 0.5 : 0.24;
                            const needsResync = !this.isPlaying || timeDiff > previewDriftThreshold || this.forceVideoUpdate;
                            const mustSeek = this.forceVideoUpdate;
                            
                            let didRequestSeek = false;
                            if ((needsResync && timeDiff > 0.008) || mustSeek) {
                                try {
                                    const safeSrc = previewVideo.duration > 0
                                        ? Math.min(sourceTime, previewVideo.duration - frameOffset)
                                        : sourceTime;
                                    previewVideo.currentTime = safeSrc;
                                    didRequestSeek = true;
                                } catch (e) {
                                    console.warn('Could not set video time:', e);
                                    this.forceVideoUpdate = false;
                                }
                            }

                            // Do not blank the preview for ordinary live drift correction.
                            // Hiding during every decoder seek creates grey/black holes in playback.
                            waitingForVideoFrame = didRequestSeek && (mustSeek || clipChanged);
                            
                            // Clear forceVideoUpdate when video has stabilized OR after timeout.
                            // On slow machines, the seek may never settle exactly on sourceTime,
                            // so we add a frame counter to force-clear after ~500ms (30 frames).
                            if (this.forceVideoUpdate) {
                                if (!waitingForVideoFrame && timeDiff <= 0.15) {
                                    this.forceVideoUpdate = false;
                                    this._forceUpdateFrames = 0;
                                } else {
                                    this._forceUpdateFrames = (this._forceUpdateFrames || 0) + 1;
                                    if (this._forceUpdateFrames > 30) {
                                        // 500ms timeout — force clear to unblock VIDEO-DRIVEN CLOCK
                                        this.forceVideoUpdate = false;
                                        this._forceUpdateFrames = 0;
                                    }
                                }
                            }

                            if (waitingForVideoFrame) {
                                previewVideo.style.display = 'none';
                                previewVideo._ctfRevealAfterSeekAt = this.isPlaying ? performance.now() + 180 : 0;
                                if (!previewVideo._ctfSeekedRefresh) {
                                    previewVideo._ctfSeekedRefresh = () => {
                                        if (previewVideo._ctfSeekFallbackTimer) {
                                            clearTimeout(previewVideo._ctfSeekFallbackTimer);
                                            previewVideo._ctfSeekFallbackTimer = null;
                                        }
                                        previewVideo._ctfSeekedRefresh = null;
                                        this.forceVideoUpdate = false;
                                        this._forceUpdateFrames = 0;
                                        this._lastXfKey = null;
                                        this.updatePreview();
                                    };
                                    if (typeof previewVideo.requestVideoFrameCallback === 'function') {
                                        previewVideo.requestVideoFrameCallback(previewVideo._ctfSeekedRefresh);
                                    } else if (previewVideo.seeking) {
                                        previewVideo.addEventListener('seeked', previewVideo._ctfSeekedRefresh, { once: true });
                                    } else {
                                        requestAnimationFrame(previewVideo._ctfSeekedRefresh);
                                    }
                                    previewVideo._ctfSeekFallbackTimer = setTimeout(() => {
                                        if (previewVideo._ctfSeekedRefresh) previewVideo._ctfSeekedRefresh();
                                    }, this.isPlaying ? 180 : 120);
                                }
                            }

                            // Playback control - only play when ready
                            if (this.isPlaying) {
                                if (previewVideo.paused && previewVideo.readyState >= 2) {
                                    previewVideo.playbackRate = 1.0;
                                    previewVideo.play().catch(e => {
                                        console.log('Play blocked:', e);
                                        if (previewVideo.readyState < 3) {
                                            setTimeout(() => {
                                                if (this.isPlaying && previewVideo.paused) {
                                                    previewVideo.play().catch(() => {});
                                                }
                                            }, 100);
                                        }
                                    });
                                }
                            } else {
                                if (!previewVideo.paused) {
                                    try { previewVideo.pause(); } catch (e) { console.warn('Could not pause video:', e); }
                                }
                            }
                        } else {
                            // Video not ready yet — poll
                            if (!previewVideo._loadListener) {
                                let retries = 0;
                                const maxRetries = 10;
                                const pollInterval = setInterval(() => {
                                    retries++;
                                    if (previewVideo.readyState >= 2) {
                                        clearInterval(pollInterval);
                                        previewVideo._loadListener = null;
                                        const _clipNow = this._currentPreviewClip;
                                        const _srcNow = _clipNow
                                            ? Math.min(
                                                (_clipNow.sourceStart || 0) + Math.max(0, this.currentTime - _clipNow.startTime),
                                                (_clipNow.sourceStart || 0) + _clipNow.duration - 1 / ((this.selectedFps || 30) * 2)
                                              )
                                            : sourceTime;
                                        try { previewVideo.currentTime = _srcNow; } catch (e) {}
                                        if (this.isPlaying && previewVideo.paused) {
                                            previewVideo.play().catch(() => {});
                                        }
                                    } else if (retries >= maxRetries) {
                                        clearInterval(pollInterval);
                                        previewVideo._loadListener = null;
                                    }
                                }, 100);
                                previewVideo._loadListener = pollInterval;
                            }
                        }

                        // Apply transform FIRST, then show video.
                        // This ensures the video appears at the correct position/size
                        // on the very first painted frame — no phantom at old position.
                        {
                            const _activeEl = activeVideoClip.type === 'image' ? previewImage : previewVideo;
                            const _xfKey = activeVideoClip.id + '|' +
                                (activeVideoClip.videoScale || 100) + '|' +
                                (activeVideoClip.videoPosX || 50) + '|' +
                                (activeVideoClip.videoPosY || 50) + '|' +
                                (activeVideoClip.animation ? activeVideoClip.animation.preset || 'none' : 'none') + '|' +
                                this.currentTime.toFixed(3);
                            if (this._lastXfKey !== _xfKey) {
                                this._lastXfKey = _xfKey;
                                this._applyVideoTransform(_activeEl, activeVideoClip);
                            }
                        }

                        // NOW show the video — transform is already applied and no forced seek is pending
                        const revealAfterSeek = previewVideo._ctfRevealAfterSeekAt && performance.now() >= previewVideo._ctfRevealAfterSeekAt;
                        if (!waitingForVideoFrame && (!previewVideo.seeking || revealAfterSeek)) {
                            previewVideo.style.display = 'block';
                            previewVideo._ctfRevealAfterSeekAt = 0;
                        }
                        previewImage.style.display = (activeVideoClip.type === 'image') ? 'block' : 'none';
                        if (noVideoIcon) noVideoIcon.style.display = 'none';

                        // Selection handles
                        if (!_overlayUnchanged && previewOverlays && this.selectedClip && this.selectedClip.id === activeVideoClip.id && this._previewHandlesActive) {
                            this._addVideoSelectHandles(previewOverlays, activeVideoClip, overlaySignal);
                        }
                    }
                } else {
                    // No active clip at current time — show black/empty (editing gap)
                    // Video off
                    try {
                        if (!previewVideo.paused) previewVideo.pause();
                    } catch (e) {
                        // non-critical
                    }
                    previewVideo.style.display = 'none';
                    previewImage.style.display = 'none';
                    if (noVideoIcon) noVideoIcon.style.display = 'none'; // no icon either — just black
                    // Reset transforms to default
                    previewVideo.style.left = '50%'; previewVideo.style.top = '50%'; previewVideo.style.transform = 'translate(-50%, -50%)';
                    previewImage.style.left = '50%'; previewImage.style.top = '50%'; previewImage.style.transform = 'translate(-50%, -50%)';
                    
                    // Hide any stale transition canvas
                    if (this._transitionCanvas) this._transitionCanvas.style.display = 'none';

                    // Clean up listener reference and remove event listener.
                    // 🐛 BUGFIX (2026-09-10) — `_loadListener` est SOIT un id de
                    // setInterval (number, cf. la branche « video not ready » plus bas)
                    // SOIT un listener d'événement. L'ancien code passait la valeur
                    // directement à removeEventListener : avec un timer id, le navigateur
                    // lève « Failed to execute 'removeEventListener': parameter 2 is not
                    // of type 'Object' ». Cette exception interrompait updatePreview(),
                    // donc restoreState() et donc **Ctrl+Z** (et le rendu de l'aperçu).
                    if (previewVideo._loadListener) {
                        if (typeof previewVideo._loadListener === 'number') {
                            clearInterval(previewVideo._loadListener);
                        } else {
                            previewVideo.removeEventListener('canplay', previewVideo._loadListener);
                        }
                        previewVideo._loadListener = null;
                    }
                    this._currentPreviewClip = null;
                }
            }

            // ────────────────────────────────────────────────────────────────────────
            // 🔁 DOUBLE TAMPON D'APERÇU — supprime les images noires / micro-blocages
            //    à chaque changement de séquence.
            //
            // AVANT : un SEUL élément <video> servait tous les clips. À chaque coupe il
            // fallait changer sa source, attendre le décodage, puis le ré-afficher
            // (`_ctfRevealAfterSeekAt = now + 180 ms`) : l'aperçu restait noir ~180 ms
            // et le décodage à froid provoquait un micro-blocage sur chaque séquence.
            //
            // MAINTENANT : deux lecteurs alternent. Pendant que le clip courant joue,
            // le clip SUIVANT est chargé et pré-positionné sur l'autre lecteur (muet,
            // caché). Quand la tête de lecture atteint la coupe, on ne fait que
            // permuter `display` : la première image est déjà décodée, rien n'est noir,
            // rien n'est en retard.
            // ────────────────────────────────────────────────────────────────────────

            /** L'élément d'aperçu non affiché (cible du préchargement). */
            _getIdlePreviewVideo() {
                const a = this._previewVideo;
                const b = this._previewVideoB;
                if (!a || !b) return null;
                return (a === b) ? null : (this._previewActiveIsB ? a : b);
            }

            /**
             * Permute les deux lecteurs d'aperçu si le clip qui commence est DÉJÀ
             * prêt sur l'autre lecteur. Renvoie true si la permutation a eu lieu.
             * @param {object} clip        clip actif trouvé pour `currentTime`
             * @param {number} trackIndex  index de sa piste
             */
            _swapPreviewVideoIfReady(clip, trackIndex) {
                const a = this._previewVideo;
                const b = this._previewVideoB;
                if (!a || !b || a === b || !clip || clip.type !== 'video') return false;
                if (!this.isPlaying) return false;   // en pause/scrub, l'ancien chemin reste exact
                const idle = this._previewActiveIsB ? a : b;
                // L'autre lecteur n'est prêt QUE s'il porte le même clip et a des images.
                if (idle._ctfClipId !== clip.id || idle.readyState < 2 || !idle.videoWidth) return false;

                try { a.pause(); } catch (_) {}

                // Son : seul le lecteur affiché doit être audible (sinon doublon +6 dB).
                const track = this.tracks[trackIndex];
                const trackMuted = track && (track.muted || track._effectiveMute);
                const unlinked = clip.audioMuted || clip.audioUnlinked;
                const vol = track ? (track.volume !== undefined ? track.volume : 100) / 100 : 1;
                idle.muted = !!(trackMuted || unlinked);
                idle.volume = (trackMuted || unlinked) ? 0 : vol;
                a.muted = true;

                idle.style.display = 'block';
                a.style.display = 'none';

                this._previewVideo = idle;
                this._previewActiveIsB = (idle === b);
                this._currentPreviewClip = clip;
                // Force la ré-application du transform / FX / étalonnage sur le nouveau
                // lecteur (les clés de cache référencent le clip, pas l'élément).
                this._lastXfKey = null;
                this._lastFxKey = null;
                this._lastColorGradingFilter = null;
                this._lastOverlayAnimKey = null;
                // Le lecteur est DÉJÀ à la bonne position : aucun seek à demander, donc
                // aucune raison de masquer quoi que ce soit.
                this.forceVideoUpdate = false;
                this._forceUpdateFrames = 0;
                if (idle._ctfRevealAfterSeekAt) idle._ctfRevealAfterSeekAt = 0;

                // Le lecteur libéré précharge le clip suivant.
                this.preloadUpcomingClips();
                return true;
            }

            /**
             * Prépare le clip vidéo SUIVANT sur le lecteur libre (charge, pré-positionne
             * et met en lecture) afin qu'il soit prêt au moment de la coupe.
             */
            preloadUpcomingClips() {
                const idle = this._getIdlePreviewVideo();
                if (!idle) return;

                // Fenêtre exprimée en TEMPS DE TIMELINE : le lecteur est mis en lecture
                // légèrement AVANT la coupe, donc à 1× il couvre exactement le délai.
                const LEAD = 0.7;
                let next = null;
                let bestDelta = Infinity;
                for (const track of this.tracks) {
                    if (!track || track.muted || track._effectiveMute) continue;
                    if (!track.clips || !Array.isArray(track.clips)) continue;
                    for (const clip of track.clips) {
                        if (clip.type !== 'video') continue;
                        const delta = clip.startTime - this.currentTime;
                        if (delta > 0.0001 && delta <= LEAD && delta < bestDelta) {
                            bestDelta = delta;
                            next = clip;
                        }
                    }
                }
                if (!next) return;
                if (idle._ctfClipId === next.id && idle.readyState >= 2) return; // déjà prêt

                const media = this.mediaLibrary.find(m => m.id === next.mediaId) || null;
                const useProxy = this._previewUseProxy || (media && media.useProxy);
                const url = (useProxy && media && media.proxyUrl) ? media.proxyUrl : next.url;
                if (!url) return;

                idle._ctfClipId = next.id;
                idle.muted = true;                 // muet tant qu'il n'est pas affiché
                idle.playbackRate = 1;
                idle.defaultPlaybackRate = 1;
                if (idle.src !== url) {
                    idle.preload = 'auto';
                    idle.src = url;
                    try { idle.load(); } catch (_) {}
                }
                // On se place `bestDelta` secondes AVANT le début du clip : en lecture à
                // 1×, l'élément sera pile sur la première image à l'instant de la coupe.
                const startAt = Math.max(0, (next.sourceStart || 0) - bestDelta);
                const seekNow = () => { try { idle.currentTime = startAt; } catch (_) {} };
                if (idle.readyState >= 1) seekNow();
                else idle.addEventListener('loadedmetadata', seekNow, { once: true });

                const p = idle.play();
                if (p && p.catch) p.catch(() => { /* autoplay bloqué : le repli prend le relais */ });
            }


            // Cache a video element for reuse (G5 fix: evict oldest if > 10 entries)
            releaseCachedVideoUrl(url) {
                const el = url ? this.videoCache[url] : null;
                if (!el) return;
                try { el.pause(); } catch (_) {}
                try { el.removeAttribute('src'); } catch (_) {}
                try { el.src = ''; } catch (_) {}
                try { el.load(); } catch (_) {}
                delete this.videoCache[url];
            }

            releaseVideoCache() {
                Object.keys(this.videoCache || {}).forEach(url => this.releaseCachedVideoUrl(url));
                this.videoCache = {};
            }

            cacheVideoElement(url, videoElement) {
                if (!this.videoCache[url]) {
                    // LRU eviction: if cache exceeds 10 entries, remove the first added key
                    const keys = Object.keys(this.videoCache);
                    if (keys.length >= 10) {
                        const oldest = keys[0];
                        this.releaseCachedVideoUrl(oldest);
                    }
                    if (videoElement) {
                        this.videoCache[url] = videoElement;
                    } else {
                        const cachedVideo = document.createElement('video');
                        cachedVideo.src = url;
                        cachedVideo.preload = 'auto';
                        cachedVideo.muted = true;
                        cachedVideo.load();
                        this.videoCache[url] = cachedVideo;
                    }
                }
            }

            // Add resize/move handles to block overlay
            addTextDragHandles(textElement, clip, signal) {
                const previewWrapper = document.getElementById('previewWrapper');
                if (!previewWrapper) return;

                let isDragging = false;
                let dragStartX, dragStartY, textStartX, textStartY;

                textElement.addEventListener('pointerdown', (e) => {
                    isDragging = true;
                    this._isTransformingPreview = true; // 🛡️ Empêche le rebuild des overlays pendant le drag
                    dragStartX = e.clientX;
                    dragStartY = e.clientY;
                    textStartX = clip.posX !== undefined ? clip.posX : 50;
                    textStartY = clip.posY !== undefined ? clip.posY : 50;
                    textElement.style.cursor = 'grabbing';
                    e.preventDefault();
                    e.stopPropagation();
                }, { signal });

                const onMove = (e) => {
                    if (!isDragging) return;
                    const rect = previewWrapper.getBoundingClientRect();
                    const dx = ((e.clientX - dragStartX) / rect.width) * 100;
                    const dy = ((e.clientY - dragStartY) / rect.height) * 100;
                    clip.posX = Math.max(0, Math.min(100, textStartX + dx));
                    clip.posY = Math.max(0, Math.min(100, textStartY + dy));
                    textElement.style.left = clip.posX + '%';
                    textElement.style.top = clip.posY + '%';
                    // Lightweight update: sync property panel sliders without full re-render
                    const sliders = document.querySelectorAll('.text-pos-slider');
                    if (sliders[0]) { sliders[0].value = Math.round(clip.posX); sliders[0].nextElementSibling.textContent = Math.round(clip.posX) + '%'; }
                    if (sliders[1]) { sliders[1].value = Math.round(clip.posY); sliders[1].nextElementSibling.textContent = Math.round(clip.posY) + '%'; }
                };

                const onUp = () => {
                    if (isDragging) {
                        isDragging = false;
                        textElement.style.cursor = 'move';
                        this._isTransformingPreview = false; // 🛡️ Réactive le rebuild des overlays
                        this._lastPreviewKey = null;         // Force le rebuild au prochain updatePreview
                        this.saveState();
                        // Ne pas appeler renderProperties() ici — il appelle updatePreview()
                        // qui reconstruirait le DOM. Les sliders sont déjà à jour.
                    }
                };

                document.addEventListener('pointermove', onMove, { signal });
                document.addEventListener('pointerup', onUp, { signal });
                document.addEventListener('pointercancel', onUp, { signal });
            }

            addBlockHandles(blockElement, clip, signal) {
                const previewWrapper = document.getElementById('previewWrapper');
                if (!previewWrapper) return;
                
                // Make block draggable
                let isDragging = false;
                let dragStartX, dragStartY, blockStartX, blockStartY;
                
                blockElement.addEventListener('pointerdown', (e) => {
                    if (e.target.classList.contains('block-handle')) return; // Don't drag when resizing
                    
                    isDragging = true;
                    this._isTransformingPreview = true; // 🛡️ Empêche le rebuild des overlays pendant le drag
                    dragStartX = e.clientX;
                    dragStartY = e.clientY;
                    blockStartX = parseFloat(clip.posX || 25);
                    blockStartY = parseFloat(clip.posY || 25);
                    
                    blockElement.style.cursor = 'grabbing';
                    e.preventDefault();
                    e.stopPropagation();
                }, { signal });
                
                const onMouseMove = (e) => {
                    if (!isDragging) return;
                    
                    const wrapperRect = previewWrapper.getBoundingClientRect();
                    const deltaX = ((e.clientX - dragStartX) / wrapperRect.width) * 100;
                    const deltaY = ((e.clientY - dragStartY) / wrapperRect.height) * 100;
                    
                    clip.posX = Math.max(0, Math.min(100 - (clip.width || 50), blockStartX + deltaX));
                    clip.posY = Math.max(0, Math.min(100 - (clip.height || 50), blockStartY + deltaY));
                    
                    // Mise à jour directe du DOM (pas de rebuild)
                    blockElement.style.left = clip.posX + '%';
                    blockElement.style.top = clip.posY + '%';
                    
                    // Sync property panel sliders sans rebuild
                    const allInputs = document.querySelectorAll('.property-input');
                    allInputs.forEach(inp => {
                        if (inp.type === 'range' && inp.min === '0' && inp.max === '100') {
                            const label = inp.parentElement?.querySelector('.property-label')?.textContent;
                            if (label === 'Position X (%)') { inp.value = Math.round(clip.posX); inp.nextElementSibling.textContent = Math.round(clip.posX) + '%'; }
                            if (label === 'Position Y (%)') { inp.value = Math.round(clip.posY); inp.nextElementSibling.textContent = Math.round(clip.posY) + '%'; }
                        }
                    });
                };
                
                const onMouseUp = () => {
                    if (isDragging) {
                        isDragging = false;
                        blockElement.style.cursor = 'move';
                        this._isTransformingPreview = false; // 🛡️ Réactive le rebuild
                        this._lastPreviewKey = null;         // Force le rebuild au prochain updatePreview
                        this.saveState();
                    }
                };
                
                document.addEventListener('pointermove', onMouseMove, { signal });
                document.addEventListener('pointerup', onMouseUp, { signal });
                document.addEventListener('pointercancel', onMouseUp, { signal });
                
                // Add 8 resize handles (corners and sides)
                const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
                handles.forEach(pos => {
                    const handle = document.createElement('div');
                    handle.className = `block-handle block-handle-${pos}`;
                    
                    let isResizing = false;
                    let resizeStartX, resizeStartY, startWidth, startHeight, startPosX, startPosY;
                    
                    handle.addEventListener('pointerdown', (e) => {
                        isResizing = true;
                        this._isTransformingPreview = true; // 🛡️ Empêche le rebuild pendant le resize
                        resizeStartX = e.clientX;
                        resizeStartY = e.clientY;
                        startWidth = parseFloat(clip.width || 50);
                        startHeight = parseFloat(clip.height || 50);
                        startPosX = parseFloat(clip.posX || 25);
                        startPosY = parseFloat(clip.posY || 25);
                        e.stopPropagation();
                        e.preventDefault();
                    }, { signal });
                    
                    const onHandleMove = (e) => {
                        if (!isResizing) return;
                        
                        const wrapperRect = previewWrapper.getBoundingClientRect();
                        const deltaX = ((e.clientX - resizeStartX) / wrapperRect.width) * 100;
                        const deltaY = ((e.clientY - resizeStartY) / wrapperRect.height) * 100;
                        
                        // Handle resize based on position
                        if (pos.includes('w')) {
                            const newWidth = Math.max(5, startWidth - deltaX);
                            const newPosX = Math.max(0, startPosX + (startWidth - newWidth));
                            clip.width = Math.min(newWidth, startPosX + startWidth);
                            clip.posX = newPosX;
                        }
                        if (pos.includes('e')) {
                            clip.width = Math.max(5, Math.min(100 - startPosX, startWidth + deltaX));
                        }
                        if (pos.includes('n')) {
                            const newHeight = Math.max(5, startHeight - deltaY);
                            const newPosY = Math.max(0, startPosY + (startHeight - newHeight));
                            clip.height = Math.min(newHeight, startPosY + startHeight);
                            clip.posY = newPosY;
                        }
                        if (pos.includes('s')) {
                            clip.height = Math.max(5, Math.min(100 - startPosY, startHeight + deltaY));
                        }
                        
                        // Mise à jour directe du DOM (pas de rebuild)
                        blockElement.style.left = clip.posX + '%';
                        blockElement.style.top = clip.posY + '%';
                        blockElement.style.width = clip.width + '%';
                        blockElement.style.height = clip.height + '%';
                        
                        // Sync property panel sliders sans rebuild
                        const allInputs = document.querySelectorAll('.property-input');
                        allInputs.forEach(inp => {
                            if (inp.type === 'range') {
                                const label = inp.parentElement?.querySelector('.property-label')?.textContent;
                                if (label === 'Position X (%)') { inp.value = Math.round(clip.posX); inp.nextElementSibling.textContent = Math.round(clip.posX) + '%'; }
                                if (label === 'Position Y (%)') { inp.value = Math.round(clip.posY); inp.nextElementSibling.textContent = Math.round(clip.posY) + '%'; }
                                if (label === 'Width (%)') { inp.value = Math.round(clip.width); inp.nextElementSibling.textContent = Math.round(clip.width) + '%'; }
                                if (label === 'Height (%)') { inp.value = Math.round(clip.height); inp.nextElementSibling.textContent = Math.round(clip.height) + '%'; }
                            }
                        });
                    };
                    
                    const onHandleUp = () => {
                        if (isResizing) {
                            isResizing = false;
                            this._isTransformingPreview = false; // 🛡️ Réactive le rebuild
                            this._lastPreviewKey = null;         // Force le rebuild
                            this.saveState();
                        }
                    };
                    
                    document.addEventListener('pointermove', onHandleMove, { signal });
                    document.addEventListener('pointerup', onHandleUp, { signal });
                    document.addEventListener('pointercancel', onHandleUp, { signal });
                    
                    blockElement.appendChild(handle);
                });
            }

            // Apply CSS position+scale+fade transform to a preview media element (video or image)
            _applyVideoTransform(el, clip) {
                const s = (clip.videoScale !== undefined ? clip.videoScale : 100) / 100;
                const px = clip.videoPosX !== undefined ? clip.videoPosX : 50;
                const py = clip.videoPosY !== undefined ? clip.videoPosY : 50;
                // 🎬 Compose with prebuilt animation preset (sx, tx%, ty%, rotRad, alpha)
                const anim = this._calcClipAnimation(clip, this.currentTime - clip.startTime);
                const finalScale = s * anim.sx;
                // Animation translation is expressed in % of the preview size; we add it to the
                // position before the centering translate(-50%, -50%) inside the transform.
                el.style.left = (px + anim.tx) + '%';
                el.style.top  = (py + anim.ty) + '%';
                const rotDeg = anim.rot * 180 / Math.PI;
                el.style.transform = `translate(-50%, -50%) scale(${finalScale}) rotate(${rotDeg}deg)`;
                el.style.opacity = this._calcFadeOpacity(clip, this.currentTime) * anim.alpha;
            }

            // ============================================
            // 🎬 ANIMATION PRESETS — prebuilt motion for images / logos / videos
            // ============================================
            // Each preset is a function (t01_in, t01_out, tAbs, dur) → { sx, tx, ty, rot, alpha }
            //   sx     : scale multiplier (1 = no change)
            //   tx, ty : translation in % of the preview canvas (added to clip.videoPosX/Y)
            //   rot    : rotation in radians
            //   alpha  : opacity multiplier (1 = no change)
            //
            // t01_in   : 0..1 progress through the IN phase (only valid when timeInClip < animDuration; else 1)
            // t01_out  : 1..0 progress through the OUT phase (1 outside, 0 at clip end)
            // tAbs     : absolute time in clip (for continuous loops like pulse / float / shake)
            // dur      : configured animDuration (seconds), used by loops as the base period
            //
            // All evaluators return additive/multiplicative deltas; "no animation" => identity.
            _getAnimPresets() {
                if (CutTheFlow._cachedAnimPresets) return CutTheFlow._cachedAnimPresets;
                CutTheFlow._cachedAnimPresets = {
                    'none': () => ({ sx: 1, tx: 0, ty: 0, rot: 0, alpha: 1 }),

                    'fade-in': (i) => ({ sx: 1, tx: 0, ty: 0, rot: 0, alpha: i }),

                    'fade-out': (i, o) => ({ sx: 1, tx: 0, ty: 0, rot: 0, alpha: o }),

                    'fade': (i, o) => ({ sx: 1, tx: 0, ty: 0, rot: 0, alpha: Math.min(i, o) }),

                    'zoom-in': (i) => {
                        // Cubic ease-out
                        const e = 1 - Math.pow(1 - i, 3);
                        return { sx: 0.4 + 0.6 * e, tx: 0, ty: 0, rot: 0, alpha: e };
                    },

                    'zoom-out': (i, o) => {
                        const e = 1 - Math.pow(1 - o, 3);
                        return { sx: 0.4 + 0.6 * e, tx: 0, ty: 0, rot: 0, alpha: e };
                    },

                    'pop': (i, o) => {
                        // Back-easeOut overshoot then settle
                        const c = 1.70158, c1 = c + 1;
                        const eIn = i >= 1 ? 1 : (1 + c1 * Math.pow(i - 1, 3) + c * Math.pow(i - 1, 2));
                        const eOut = 1 - Math.pow(1 - o, 3);
                        const sx = (0.3 + 0.7 * eIn) * (0.3 + 0.7 * eOut);
                        return { sx, tx: 0, ty: 0, rot: 0, alpha: Math.min(eIn, eOut) };
                    },

                    'slide-left': (i, o) => {
                        const eI = 1 - Math.pow(1 - i, 3);
                        const eO = Math.pow(o, 3);
                        return { sx: 1, tx: -100 * (1 - eI) + 100 * (1 - eO), ty: 0, rot: 0, alpha: Math.min(i * 1.6, 1) };
                    },
                    'slide-right': (i, o) => {
                        const eI = 1 - Math.pow(1 - i, 3);
                        const eO = Math.pow(o, 3);
                        return { sx: 1, tx: 100 * (1 - eI) - 100 * (1 - eO), ty: 0, rot: 0, alpha: Math.min(i * 1.6, 1) };
                    },
                    'slide-up': (i, o) => {
                        const eI = 1 - Math.pow(1 - i, 3);
                        const eO = Math.pow(o, 3);
                        return { sx: 1, tx: 0, ty: 100 * (1 - eI) - 100 * (1 - eO), rot: 0, alpha: Math.min(i * 1.6, 1) };
                    },
                    'slide-down': (i, o) => {
                        const eI = 1 - Math.pow(1 - i, 3);
                        const eO = Math.pow(o, 3);
                        return { sx: 1, tx: 0, ty: -100 * (1 - eI) + 100 * (1 - eO), rot: 0, alpha: Math.min(i * 1.6, 1) };
                    },

                    'spin-in': (i) => {
                        const e = 1 - Math.pow(1 - i, 3);
                        return { sx: 0.3 + 0.7 * e, tx: 0, ty: 0, rot: -2 * Math.PI * (1 - e), alpha: e };
                    },

                    'bounce': (i) => {
                        // ease-out-bounce on Y translate
                        let b = 1; const n1 = 7.5625, d1 = 2.75;
                        const x = i;
                        if (x < 1 / d1)              b = n1 * x * x;
                        else if (x < 2 / d1)         b = n1 * (x - 1.5 / d1) * (x - 1.5 / d1) + 0.75;
                        else if (x < 2.5 / d1)       b = n1 * (x - 2.25 / d1) * (x - 2.25 / d1) + 0.9375;
                        else                         b = n1 * (x - 2.625 / d1) * (x - 2.625 / d1) + 0.984375;
                        return { sx: 1, tx: 0, ty: -40 * (1 - b), rot: 0, alpha: Math.min(i * 2, 1) };
                    },

                    'pulse': (i, o, t, dur) => {
                        const period = Math.max(0.4, dur * 2);
                        const k = Math.sin((t / period) * 2 * Math.PI) * 0.5 + 0.5;
                        return { sx: 1 + 0.06 * k, tx: 0, ty: 0, rot: 0, alpha: Math.min(i, o) };
                    },

                    'shake-loop': (i, o, t) => {
                        const tx = 1.6 * Math.sin(t * 18.7) + 0.8 * Math.sin(t * 31.3);
                        const ty = 1.4 * Math.cos(t * 22.1) + 0.7 * Math.cos(t * 17.6);
                        const rot = 0.012 * Math.sin(t * 14.4);
                        return { sx: 1, tx, ty, rot, alpha: Math.min(i, o) };
                    },

                    'float': (i, o, t, dur) => {
                        const period = Math.max(2, dur * 4);
                        const phase = (t / period) * 2 * Math.PI;
                        return { sx: 1, tx: 0.6 * Math.sin(phase), ty: -1.6 * Math.sin(phase), rot: 0.02 * Math.cos(phase), alpha: Math.min(i, o) };
                    },

                    'kenburns': (i, o, t, dur, total) => {
                        const T = total > 0.01 ? total : 1;
                        const p = Math.max(0, Math.min(1, t / T));
                        return { sx: 1 + 0.18 * p, tx: -3 + 6 * p, ty: 2 - 4 * p, rot: 0, alpha: Math.min(i, o) };
                    },

                    'spin-loop': (i, o, t, dur) => {
                        const period = Math.max(2, dur * 4);
                        return { sx: 1, tx: 0, ty: 0, rot: (t / period) * 2 * Math.PI, alpha: Math.min(i, o) };
                    },

                    'reveal-pop': (i, o) => {
                        const c = 1.70158, c1 = c + 1;
                        const eIn = i >= 1 ? 1 : (1 + c1 * Math.pow(i - 1, 3) + c * Math.pow(i - 1, 2));
                        const eOut = 1 - Math.pow(1 - o, 2);
                        return {
                            sx: (0.2 + 0.8 * eIn) * (0.85 + 0.15 * eOut),
                            tx: 0, ty: 0, rot: 0,
                            alpha: Math.min(eIn, eOut)
                        };
                    },
                };
                return CutTheFlow._cachedAnimPresets;
            }

            /**
             * Compute the live animation contribution for a clip at `timeInClip` (seconds since
             * `clip.startTime`). Returns identity ({sx:1, tx:0, ty:0, rot:0, alpha:1}) when no
             * animation is configured, so callers can multiply/add unconditionally.
             *
             * `clip.animation = { preset, duration, intensity }` where:
             *   - preset    : key in _getAnimPresets()
             *   - duration  : in/out phase length in seconds (default 0.6)
             *   - intensity : 0..200 (%) scaling factor on tx/ty/rot/scale-delta (default 100)
             */
            _calcClipAnimation(clip, timeInClip) {
                const IDENTITY = { sx: 1, tx: 0, ty: 0, rot: 0, alpha: 1 };
                if (!clip || !clip.animation || !clip.animation.preset || clip.animation.preset === 'none') {
                    return IDENTITY;
                }
                const preset = clip.animation.preset;
                const fn = this._getAnimPresets()[preset];
                if (!fn) return IDENTITY;

                const dur   = Math.max(0.05, Number(clip.animation.duration) || 0.6);
                const total = Math.max(0.01, clip.duration || 0);
                const t     = Math.max(0, Math.min(total, Number(timeInClip) || 0));

                // IN progress: 0 at clip start, 1 once `dur` has elapsed.
                const i = total <= 0 ? 1 : Math.max(0, Math.min(1, t / dur));
                // OUT progress: 1 throughout, decreasing to 0 only during the last `dur` seconds.
                const remaining = total - t;
                const o = total <= 0 ? 1 : Math.max(0, Math.min(1, remaining / dur));

                const raw = fn(i, o, t, dur, total) || IDENTITY;

                // Apply intensity scaling — alpha is NEVER scaled (would break fade-out logic).
                const k = Math.max(0, Math.min(2, (Number(clip.animation.intensity) || 100) / 100));
                if (k === 1) return raw;
                return {
                    sx: 1 + (raw.sx - 1) * k,
                    tx: raw.tx * k,
                    ty: raw.ty * k,
                    rot: raw.rot * k,
                    alpha: raw.alpha,
                };
            }

            // Calculate fade-in / fade-out opacity for a clip at time t
            _calcFadeOpacity(clip, t) {
                const fi = clip.fadeIn  || 0;
                const fo = clip.fadeOut || 0;
                if (fi === 0 && fo === 0) return 1;
                const elapsed   = t - clip.startTime;
                const remaining = (clip.startTime + clip.duration) - t;
                let op = 1.0;
                if (fi > 0 && elapsed   < fi) op = Math.min(op, elapsed   / fi);
                if (fo > 0 && remaining < fo) op = Math.min(op, remaining / fo);
                return Math.max(0, Math.min(1, op));
            }

            // Create interactive drag+resize overlay on video/image clips in preview.
            // The overlay matches the media's bounding box. Handles stay fixed-size.
            _addVideoSelectHandles(previewOverlays, clip, signal) {
                const previewWrapper = document.getElementById('previewWrapper');
                const pv = document.getElementById('previewVideo');
                const pvB = document.getElementById('previewVideoB');
                const pi = document.getElementById('previewImage');
                if (!previewWrapper) return;

                // Ratio naturel mesuré sur l'élément RÉELLEMENT affiché
                // (avec le double tampon, #previewVideo peut être caché).
                const activeEl = this._getVisiblePreviewMedia();
                if (!activeEl) return;

                const wr = previewWrapper.getBoundingClientRect();

                // Measure the media's NATURAL aspect ratio
                let natW, natH;
                if (activeEl.tagName === 'VIDEO' && activeEl.videoWidth > 0) {
                    natW = activeEl.videoWidth; natH = activeEl.videoHeight;
                } else if (activeEl.tagName === 'IMG' && activeEl.naturalWidth > 0) {
                    natW = activeEl.naturalWidth; natH = activeEl.naturalHeight;
                } else {
                    natW = 1920; natH = 1080;
                }
                const natAsp = natW / Math.max(natH, 1);

                // Compute the letterboxed base size (scale=100%, centered)
                const wrAsp = wr.width / Math.max(wr.height, 1);
                let baseW, baseH;
                if (natAsp >= wrAsp) {
                    baseW = wr.width;
                    baseH = wr.width / natAsp;
                } else {
                    baseH = wr.height;
                    baseW = wr.height * natAsp;
                }

                // Build the overlay. width/height include scale → no CSS scale() needed.
                // Position matches _applyVideoTransform anchor model: left/top %, translate(-50%,-50%).
                const sc = (clip.videoScale !== undefined ? clip.videoScale : 100) / 100;
                const px = clip.videoPosX !== undefined ? clip.videoPosX : 50;
                const py = clip.videoPosY !== undefined ? clip.videoPosY : 50;

                const sel = document.createElement('div');
                sel.className = 'video-select-overlay';
                sel.style.width  = (baseW * sc) + 'px';
                sel.style.height = (baseH * sc) + 'px';
                sel.style.left = px + '%';
                sel.style.top  = py + '%';
                sel.style.transform = 'translate(-50%, -50%)';

                // --- Sync helpers ---
                const getWRect = () => previewWrapper.getBoundingClientRect();

                const syncAll = () => {
                    const s = (clip.videoScale !== undefined ? clip.videoScale : 100) / 100;
                    const x = clip.videoPosX !== undefined ? clip.videoPosX : 50;
                    const y = clip.videoPosY !== undefined ? clip.videoPosY : 50;
                    // Overlay
                    sel.style.width  = (baseW * s) + 'px';
                    sel.style.height = (baseH * s) + 'px';
                    sel.style.left = x + '%';
                    sel.style.top  = y + '%';
                    sel.style.transform = 'translate(-50%, -50%)';
                    // Media element
                    const el = (pv && pv.style.display !== 'none') ? pv : pi;
                    if (el) {
                        el.style.left = x + '%';
                        el.style.top  = y + '%';
                        el.style.transform = `translate(-50%, -50%) scale(${s})`;
                    }
                    // Sliders
                    const xS = document.getElementById('vidPosXSlider');
                    const yS = document.getElementById('vidPosYSlider');
                    const sS = document.getElementById('vidScaleSlider');
                    const rx = Math.round(x), ry = Math.round(y), rs = Math.round(clip.videoScale || 100);
                    if (xS) { xS.value = rx; if (xS.nextElementSibling) xS.nextElementSibling.textContent = rx + '%'; }
                    if (yS) { yS.value = ry; if (yS.nextElementSibling) yS.nextElementSibling.textContent = ry + '%'; }
                    if (sS) { sS.value = rs; if (sS.nextElementSibling) sS.nextElementSibling.textContent = rs + '%'; }
                };

                // --- DRAG (move position) ---
                let isDragging = false, dragSX, dragSY, startPX, startPY;
                sel.addEventListener('pointerdown', (e) => {
                    if (e.target.classList.contains('video-handle')) return;
                    isDragging = true;
                    this._isTransformingPreview = true;
                    dragSX = e.clientX; dragSY = e.clientY;
                    startPX = clip.videoPosX !== undefined ? clip.videoPosX : 50;
                    startPY = clip.videoPosY !== undefined ? clip.videoPosY : 50;
                    sel.style.cursor = 'grabbing';
                    sel.setPointerCapture(e.pointerId);
                    e.preventDefault();
                });
                const onDragMove = (e) => {
                    if (!isDragging) return;
                    const r = getWRect();
                    clip.videoPosX = startPX + ((e.clientX - dragSX) / r.width) * 100;
                    clip.videoPosY = startPY + ((e.clientY - dragSY) / r.height) * 100;
                    syncAll();
                };
                const onDragUp = () => {
                    if (!isDragging) return;
                    isDragging = false;
                    this._isTransformingPreview = false;
                    sel.style.cursor = 'move';
                    this.saveState();
                    this.renderProperties();
                };
                document.addEventListener('pointermove', onDragMove, { signal });
                document.addEventListener('pointerup', onDragUp, { signal });
                document.addEventListener('pointercancel', onDragUp, { signal });

                // --- RESIZE handles (4 corners + 4 mid-edges) ---
                // 🐛 BUGFIX (2026-09-10) — « impossible d'agrandir une vidéo avec les
                // poignées ». Deux causes :
                //  1) Les 4 poignées de milieu (n/s/e/w) étaient créées en JS mais
                //     AUCUNE règle CSS ne les positionnait : elles s'empilaient sur le
                //     coin haut-gauche → zone de drag fantôme, sensation de bug.
                //  2) Le redimensionnement utilisait un facteur arbitraire (0.7 × (dx+dy))
                //     sans ancre : le cadre « flottait » et le coin opposé bougeait.
                // Désormais : géométrie ancrée sur le coin/le bord OPPOSÉ (comportement
                // NLE standard), ratio d'aspect conservé, et le centre est recalculé pour
                // que le point fixe ne bouge pas.
                const handleDefs = [
                    { pos: 'nw', sx: -1, sy: -1 },
                    { pos: 'ne', sx:  1, sy: -1 },
                    { pos: 'sw', sx: -1, sy:  1 },
                    { pos: 'se', sx:  1, sy:  1 },
                    { pos: 'n',  sx:  0, sy: -1 },
                    { pos: 's',  sx:  0, sy:  1 },
                    { pos: 'w',  sx: -1, sy:  0 },
                    { pos: 'e',  sx:  1, sy:  0 },
                ];
                handleDefs.forEach(hd => {
                    const h = document.createElement('div');
                    h.className = `video-handle video-handle-${hd.pos}`;
                    let resizing = false;
                    h.addEventListener('pointerdown', (e) => {
                        resizing = true;
                        this._isTransformingPreview = true;
                        h.setPointerCapture(e.pointerId);
                        e.stopPropagation(); e.preventDefault();
                    });

                    const onResizeMove = (e) => {
                        if (!resizing) return;
                        const r = getWRect();
                        const W = Math.max(1, r.width), H = Math.max(1, r.height);
                        // Géométrie courante (px dans le wrapper)
                        const s0 = (clip.videoScale !== undefined ? clip.videoScale : 100) / 100;
                        const cx0 = ((clip.videoPosX !== undefined ? clip.videoPosX : 50) / 100) * W;
                        const cy0 = ((clip.videoPosY !== undefined ? clip.videoPosY : 50) / 100) * H;
                        const hw0 = baseW * s0 / 2, hh0 = baseH * s0 / 2;

                        // Point d'ancrage = coin/bord OPPOSÉ à la poignée tirée.
                        const ax = cx0 - hd.sx * hw0;
                        const ay = cy0 - hd.sy * hh0;

                        // Position du pointeur relative à l'ancre, le long des axes actifs.
                        const relX = (e.clientX - r.left) - ax;   // >0 : pointeur à droite
                        const relY = (e.clientY - r.top)  - ay;   // >0 : pointeur en bas

                        // Ratio d'aspect TOUJOURS conservé (vidéo/image).
                        let scale;
                        const sxFromW = hd.sx !== 0 ? (relX * hd.sx) / baseW : null;
                        const syFromH = hd.sy !== 0 ? (relY * hd.sy) / baseH : null;
                        if (sxFromW !== null && syFromH !== null) {
                            // Coin : on suit l'axe le plus sollicité → sensation naturelle.
                            scale = Math.max(sxFromW, syFromH);
                        } else {
                            scale = sxFromW !== null ? sxFromW : syFromH;
                        }
                        scale = Math.max(0.05, Math.min(8, scale));

                        // Nouvelle taille + nouveau centre, ancre immobile.
                        const newW = baseW * scale, newH = baseH * scale;
                        const newCx = hd.sx !== 0 ? ax + hd.sx * newW / 2 : cx0;
                        const newCy = hd.sy !== 0 ? ay + hd.sy * newH / 2 : cy0;

                        clip.videoScale = scale * 100;
                        clip.videoPosX = (newCx / W) * 100;
                        clip.videoPosY = (newCy / H) * 100;
                        syncAll();
                    };
                    const onResizeUp = () => {
                        if (!resizing) return;
                        resizing = false;
                        this._isTransformingPreview = false;
                        this.saveState();
                        this.renderProperties();
                        this.updatePreview();
                    };
                    document.addEventListener('pointermove', onResizeMove, { signal });
                    document.addEventListener('pointerup', onResizeUp, { signal });
                    document.addEventListener('pointercancel', onResizeUp, { signal });
                    sel.appendChild(h);
                });

                previewOverlays.appendChild(sel);
            }

            resetVideoTransform() {
                if (!this.selectedClip) return;
                delete this.selectedClip.videoScale;
                delete this.selectedClip.videoPosX;
                delete this.selectedClip.videoPosY;
                this.saveState();
                this.renderProperties();
                this.updatePreview();
            }

            stopStreamTracks(stream) {
                if (!stream) return;
                try {
                    stream.getTracks().forEach((track) => track.stop());
                } catch (_) {}
            }

            cleanupProxyResources({ video, streams = [], recorder, animationFrameId, timeoutIds = [] }) {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                }

                timeoutIds.forEach((timeoutId) => {
                    if (timeoutId) clearTimeout(timeoutId);
                });

                if (recorder && recorder.state !== 'inactive') {
                    try {
                        recorder.stop();
                    } catch (_) {}
                }

                streams.forEach((stream) => this.stopStreamTracks(stream));

                if (video) {
                    try { video.pause(); } catch (_) {}
                    video.onloadedmetadata = null;
                    video.onerror = null;
                    video.onended = null;
                    try { video.removeAttribute('src'); } catch (_) {}
                    video.src = '';
                    try { video.load(); } catch (_) {}
                }
            }

            // 🚀 SMART PROXY GENERATION - Optimized for 4K videos
            async generateSmartProxy(media) {
                if (!media || media.type !== 'video') return null;
                if (media.proxyUrl) return media.proxyUrl;
                if (this.proxyTasks.has(media.id)) return this.proxyTasks.get(media.id);
                
                console.log(`🎬 Generating smart proxy for ${media.name} (${media.width}x${media.height})`);
                
                // Determine optimal proxy resolution
                let targetWidth, targetHeight;
                const aspect = media.width / media.height;
                
                if (media.width >= 3840) {
                    // 4K+ -> 1080p proxy
                    targetWidth = 1920;
                    targetHeight = Math.round(1920 / aspect);
                } else if (media.width >= 2560) {
                    // 2K+ -> 720p proxy
                    targetWidth = 1280;
                    targetHeight = Math.round(1280 / aspect);
                } else {
                    // Already reasonable size
                    return null;
                }
                
                console.log(`📐 Target proxy size: ${targetWidth}x${targetHeight}`);
                
                const proxyPromise = new Promise(async (resolve, reject) => {
                    let video = null;
                    let recorder = null;
                    let renderRafId = null;
                    let metadataTimeoutId = null;
                    let completionTimeoutId = null;
                    let canvasStream = null;
                    let sourceStream = null;
                    let recordStream = null;
                    try {
                        video = document.createElement('video');
                        video.src = media.url;
                        video.crossOrigin = 'anonymous';
                        video.preload = 'metadata';
                        video.muted = true;
                        
                        await new Promise((res, rej) => {
                            video.onloadedmetadata = res;
                            video.onerror = () => rej(new Error('Failed to load proxy source video'));
                            metadataTimeoutId = setTimeout(() => rej(new Error('Timeout loading video')), 10000);
                        });
                        if (metadataTimeoutId) {
                            clearTimeout(metadataTimeoutId);
                            metadataTimeoutId = null;
                        }
                        
                        const canvas = document.createElement('canvas');
                        canvas.width = targetWidth;
                        canvas.height = targetHeight;
                        const ctx = canvas.getContext('2d', { alpha: false });
                        
                        if (!ctx) {
                            throw new Error('Failed to create canvas context for proxy generation');
                        }
                        
                        // Setup recording with audio
                        canvasStream = canvas.captureStream(25); // 25fps proxy
                        let audioTrack = null;
                        try {
                            if (video.captureStream) {
                                sourceStream = video.captureStream();
                                audioTrack = sourceStream.getAudioTracks()[0];
                            }
                        } catch (e) {
                            console.warn('No audio track:', e.message);
                        }
                        
                        const tracks = [canvasStream.getVideoTracks()[0]];
                        if (audioTrack) tracks.push(audioTrack);
                        recordStream = new MediaStream(tracks);
                        
                        const mimeTypes = [
                            'video/webm;codecs=vp9,opus',
                            'video/webm;codecs=vp8,opus',
                            'video/webm;codecs=vp9',
                            'video/webm'
                        ];
                        const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
                        
                        recorder = new MediaRecorder(recordStream, {
                            mimeType: mimeType,
                            videoBitsPerSecond: 2000000 // 2 Mbps
                        });
                        
                        const chunks = [];
                        recorder.ondataavailable = e => {
                            if (e.data?.size > 0) chunks.push(e.data);
                        };
                        const recorderDone = new Promise((res, rej) => {
                            recorder.onstop = res;
                            recorder.onerror = () => rej(new Error('Proxy recorder failed'));
                        });
                        
                        recorder.start(100);
                        video.currentTime = 0;
                        await video.play();
                        
                        // 🎯 Calculer scaling pour préserver ratio
                        const sourceRatio = video.videoWidth / video.videoHeight;
                        const targetRatio = targetWidth / targetHeight;
                        let drawW, drawH, drawX, drawY;
                        
                        if (sourceRatio > targetRatio) {
                            drawW = targetWidth;
                            drawH = targetWidth / sourceRatio;
                            drawX = 0;
                            drawY = (targetHeight - drawH) / 2;
                        } else {
                            drawW = targetHeight * sourceRatio;
                            drawH = targetHeight;
                            drawX = (targetWidth - drawW) / 2;
                            drawY = 0;
                        }
                        
                        console.log(`   Proxy scaling: ${video.videoWidth}x${video.videoHeight} → ${drawW.toFixed(0)}x${drawH.toFixed(0)} at (${drawX}, ${drawY})`);
                        
                        // Render loop avec scaling correct
                        const renderProxy = () => {
                            if (video.currentTime >= video.duration || video.ended) return;
                            // Fond noir pour les barres
                            ctx.fillStyle = '#000000';
                            ctx.fillRect(0, 0, targetWidth, targetHeight);
                            // Dessiner vidéo avec ratio préservé
                            ctx.drawImage(video, drawX, drawY, drawW, drawH);
                            renderRafId = requestAnimationFrame(renderProxy);
                        };
                        renderProxy();
                        
                        // Wait for completion
                        await new Promise((res) => {
                            video.onended = res;
                            completionTimeoutId = setTimeout(res, (media.duration + 2) * 1000);
                        });
                        
                        video.pause();
                        if (recorder.state === 'recording') recorder.stop();
                        await recorderDone;
                        
                        const proxyBlob = new Blob(chunks, { type: mimeType });
                        const proxyUrl = URL.createObjectURL(proxyBlob);
                        
                        media.proxyUrl = proxyUrl;
                        media.proxyWidth = targetWidth;
                        media.proxyHeight = targetHeight;
                        
                        console.log(`✅ Proxy: ${(proxyBlob.size / 1024 / 1024).toFixed(2)} MB`);
                        resolve(proxyUrl);
                        
                    } catch (error) {
                        console.error('Proxy error:', error);
                        reject(error);
                    } finally {
                        this.cleanupProxyResources({
                            video,
                            streams: [canvasStream, sourceStream, recordStream],
                            recorder,
                            animationFrameId: renderRafId,
                            timeoutIds: [metadataTimeoutId, completionTimeoutId]
                        });
                    }
                });
                
                this.proxyTasks.set(media.id, proxyPromise);
                try {
                    const result = await proxyPromise;
                    this.proxyTasks.delete(media.id);
                    return result;
                } catch (error) {
                    this.proxyTasks.delete(media.id);
                    throw error;
                }
            }

            // Preload all timeline videos in background
            preloadAllTimelineVideos() {
                const allVideoUrls = new Set();
                
                for (const track of this.tracks) {
                    if (!track || !track.clips) continue;
                    for (const clip of track.clips) {
                        if (clip.type === 'video') {
                            allVideoUrls.add(clip.url);
                        }
                    }
                }
                
                let loaded = 0;
                const total = allVideoUrls.size;
                
                if (total === 0) return Promise.resolve();
                
                this.showStatus(`Preloading ${total} video(s)...`);
                
                const preloadPromises = Array.from(allVideoUrls).map(url => {
                    return new Promise((resolve) => {
                        if (this.videoCache[url] && this.videoCache[url].readyState >= 3) {
                            loaded++;
                            this.showStatus(`Preloaded ${loaded}/${total} videos`);
                            resolve();
                            return;
                        }
                        
                        const video = document.createElement('video');
                        video.src = url;
                        video.preload = 'auto';
                        video.muted = true;
                        
                        const onReady = () => {
                            this.videoCache[url] = video;
                            loaded++;
                            this.showStatus(`Preloaded ${loaded}/${total} videos`);
                            cleanup();
                            resolve();
                        };
                        
                        const onError = () => {
                            console.warn('Failed to preload:', url);
                            loaded++;
                            cleanup();
                            resolve();
                        };
                        
                        const cleanup = () => {
                            video.removeEventListener('canplaythrough', onReady);
                            video.removeEventListener('error', onError);
                        };
                        
                        video.addEventListener('canplaythrough', onReady, { once: true });
                        video.addEventListener('error', onError, { once: true });
                        
                        video.load();
                    });
                });
                
                return Promise.all(preloadPromises).then(() => {
                    this.showStatus(`All ${total} video(s) preloaded and ready!`);
                });
            }

            // ============================================
            // RENDER
            // ============================================
            
            escapeHtml(str) {
                const div = document.createElement('div');
                div.textContent = str;
                return div.innerHTML;
            }

            render() {
                this.renderMediaLibrary();
                this.renderTracks(); // renderTracks also calls renderRuler
                this.renderProperties();
            }

            /**
             * Full UI refresh — call after any state mutation to guarantee
             * the timeline, preview, playhead, media library & properties
             * are all in sync. This is the "nuclear" refresh.
             */
            /**
             * Quantize a time value to TIME_PRECISION grid (0.0001s)
             * Prevents floating-point micro-gaps between adjacent clips
             */
            quantizeTime(t) {
                return Math.round(t * this.TIME_PRECISION) / this.TIME_PRECISION;
            }

            /**
             * Collect all snap points from all tracks (excluding the given clip id)
             * Returns array of { time, type: 'start'|'end' }
             */
            getSnapPoints(excludeClipId) {
                const points = [];
                for (const track of this.tracks) {
                    for (const c of track.clips) {
                        if (c.id === excludeClipId) continue;
                        points.push({ time: c.startTime, type: 'start' });
                        points.push({ time: this.quantizeTime(c.startTime + c.duration), type: 'end' });
                    }
                }
                // Also snap to playhead
                points.push({ time: this.currentTime, type: 'playhead' });
                // Snap to t=0
                points.push({ time: 0, type: 'start' });
                return points;
            }

            /**
             * Try to snap a clip (startTime, duration) to nearby snap points.
             * Returns { snappedTime, snapX } or null. snapX is in pixels for the indicator.
             */
            trySnap(newStartTime, clipDuration, excludeClipId) {
                if (!this.prefs.snapEnabled) return null;
                const points = this.getSnapPoints(excludeClipId);
                const clipEnd = newStartTime + clipDuration;

                let best = null;
                let bestDelta = this.SNAP_THRESHOLD;

                for (const p of points) {
                    // Snap head to point
                    const d1 = Math.abs(newStartTime - p.time);
                    if (d1 < bestDelta) { bestDelta = d1; best = { snappedTime: p.time, snapAt: p.time }; }
                    // Snap tail to point
                    const d2 = Math.abs(clipEnd - p.time);
                    if (d2 < bestDelta) { bestDelta = d2; best = { snappedTime: p.time - clipDuration, snapAt: p.time }; }
                }

                if (best) {
                    best.snapX = best.snapAt * this.zoomLevel;
                    return best;
                }
                return null;
            }

            /** Show the snap indicator line at a given pixel offset in the timeline content area */
            showSnapIndicator(snapX) {
                let el = document.getElementById('snapIndicator');
                if (!el) {
                    el = document.createElement('div');
                    el.id = 'snapIndicator';
                    el.className = 'snap-indicator';
                    const container = document.getElementById('timelineContainer');
                    if (container) container.appendChild(el);
                    else return;
                }
                el.style.display = 'block';
                // snapX = time * zoomLevel (clip-area pixels); add header offset
                el.style.left = (this.TRACK_HEADER_WIDTH + snapX) + 'px';
            }

            hideSnapIndicator() {
                const el = document.getElementById('snapIndicator');
                if (el) el.style.display = 'none';
            }

            /**
             * Check if a given time falls within a clip's range [startTime, startTime+duration)
             * Uses half-open interval with epsilon tolerance to prevent black frames at boundaries
             */
            isTimeInClip(time, clip) {
                // Half-open interval with symmetric epsilon at both ends so playhead
                // never falls into a 1-frame gap at a clip boundary (black flash).
                return time >= clip.startTime - this.TIME_EPSILON &&
                       time <  clip.startTime + clip.duration + this.TIME_EPSILON;
            }

            _isAtClipStartBoundary(time, clip) {
                return Math.abs(time - clip.startTime) <= this.TIME_EPSILON;
            }

            _isAtClipEndBoundary(time, clip) {
                return Math.abs(time - (clip.startTime + clip.duration)) <= this.TIME_EPSILON;
            }

            // Find the topmost video/image clip at a given time (foreground first).
            // Returns the clip object or null.
            _findClipAtTime(time) {
                for (let i = 0; i < this.tracks.length; i++) {
                    const track = this.tracks[i];
                    if (!track || track.muted || track._effectiveMute) continue;
                    if (!track.clips || !Array.isArray(track.clips)) continue;
                    let activeClip = null;
                    for (const clip of track.clips) {
                        if ((clip.type === 'video' || clip.type === 'image') && this.isTimeInClip(time, clip)) {
                            if (this._isAtClipStartBoundary(time, clip)) return clip;
                            if (!activeClip) activeClip = clip;
                        }
                    }
                    if (activeClip) return activeClip;
                }
                return null;
            }

            fullRefresh() {
                // Invalidate cached DOM references
                this._previewVideo = null;
                this._previewImage = null;
                this._noVideoIcon = null;
                this._previewOverlays = null;
                this._lastPreviewKey = null;
                this._lastFxKey = null;              // Force FX re-apply after full refresh
                this._lastColorGradingFilter = null; // Force color grading re-apply
                this._lastXfKey = null;              // Force transform re-apply
                this._lastOverlayAnimKey = null;     // Force overlay animation
                this._cachedActiveClip = null;       // Force track re-scan
                this._lastPreloadTime = null;         // Allow immediate preload check
                this._currentPreviewClip = null;     // Force clip re-detection
                this.forceVideoUpdate = true;        // Force seek after any structural edit
                this._domPlayhead = null;
                this._domRulerPH = null;
                this._domTimelineScroll = null;
                this._domRulerContent = null;
                this._domTimeDisplay = null;
                this.renderTracks();
                this.renderMediaLibrary();
                this.renderProperties();
                this.updatePlayhead();
                this.updatePreview();
            }

            renderMediaLibrary() {
                const grid = document.getElementById('mediaGrid');
                const hint = document.querySelector('.drop-zone-hint');
                
                // Hide hint if there are media files
                if (hint) {
                    hint.style.display = this.mediaLibrary.length > 0 ? 'none' : 'block';
                }
                
                grid.innerHTML = '';

                this.mediaLibrary.forEach(media => {
                    const item = document.createElement('div');
                    item.className = 'media-item';
                    item.draggable = true;

                    item.addEventListener('dragstart', (e) => {
                        this.draggedMedia = media;
                    });

                    item.addEventListener('dragend', () => {
                        this.draggedMedia = null;
                    });

                    // Create media-bar thumbnail: one first frame only, never a sequence strip.
                    let thumbnailEl;
                    const firstThumb = (media.thumbnailFrames && media.thumbnailFrames[0] && media.thumbnailFrames[0].url) ||
                        (media.thumbnails && media.thumbnails[0]);
                    if (firstThumb && (media.type === 'video' || media.type === 'image')) {
                        thumbnailEl = document.createElement('img');
                        thumbnailEl.className = 'media-thumbnail';
                        thumbnailEl.src = firstThumb;
                        thumbnailEl.alt = media.name;
                    } else if (media.type === 'video') {
                        // For videos, create a video element to capture first frame
                        thumbnailEl = document.createElement('video');
                        thumbnailEl.className = 'media-thumbnail';
                        thumbnailEl.src = media.url;
                        thumbnailEl.muted = true;
                        thumbnailEl.preload = 'metadata';
                        // Seek to first frame
                        thumbnailEl.addEventListener('loadeddata', () => {
                            thumbnailEl.currentTime = 0;
                        });
                    } else if (media.type === 'image') {
                        thumbnailEl = document.createElement('img');
                        thumbnailEl.className = 'media-thumbnail';
                        thumbnailEl.src = media.url;
                        thumbnailEl.alt = media.name;
                    } else {
                        thumbnailEl = document.createElement('div');
                        thumbnailEl.className = 'media-thumbnail';
                        thumbnailEl.style.cssText = 'display: flex; align-items: center; justify-content: center; font-size: 11px; color: #666666; font-weight: 600;';
                        thumbnailEl.textContent = 'AUDIO';
                    }

                    const infoDiv = document.createElement('div');
                    infoDiv.className = 'media-info';
                    
                    // Build duration string with FPS if available
                    let durationText = `${media.type.toUpperCase()} • ${this.formatTime(media.duration)}`;
                    if (media.fps && media.type === 'video') {
                        durationText += ` • ${media.fps}fps`;
                    }
                    
                    const nameEl = document.createElement('div');
                    nameEl.className = 'media-name';
                    nameEl.textContent = media.name;
                    const durEl = document.createElement('div');
                    durEl.className = 'media-duration';
                    durEl.textContent = durationText;
                    infoDiv.appendChild(nameEl);
                    infoDiv.appendChild(durEl);

                    // Add delete button
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'media-delete-btn';
                    deleteBtn.innerHTML = '×';
                    deleteBtn.title = 'Remove from library';
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        this.deleteMedia(media.id);
                    };

                    item.appendChild(thumbnailEl);
                    item.appendChild(infoDiv);
                    item.appendChild(deleteBtn);
                    grid.appendChild(item);
                });
            }

            renderRuler() {
                const marksContainer = document.getElementById('rulerMarks');
                const rulerContent = document.getElementById('rulerContent');
                const timelineScroll = document.getElementById('timelineScroll');
                const timelineEnd = this.getTimelineEnd();

                // 🐛 CORRECTIF (2026-09-17) — « en dézoomant, je perds les numéros de temps ».
                //
                // La règle n'était dessinée QUE jusqu'à la fin du dernier clip
                // (`timelineEnd * zoomLevel` pixels). Dès que le dézoom rendait le montage
                // plus étroit que la fenêtre — mesuré : 14 s à 7,8 px/s = **109 px de large** —
                // il ne restait qu'UNE seule étiquette « 00:00 » collée en haut à gauche, et
                // tout le reste du bandeau était vide : les numéros disparaissaient.
                //
                // Deux corrections :
                //  1. la règle couvre désormais TOUJOURS au moins la largeur visible
                //     (`max(fin du montage, temps visible + marge)`) → il y a toujours des
                //     repères, même sur une timeline courte ou vide ;
                //  2. l'intervalle entre repères est calculé pour viser ~120 px d'écartement
                //     (échelle « ronde » : 1, 2, 5, 10, 15, 30 s…), au lieu des paliers fixes
                //     précédents qui donnaient un repère toutes les 334 px à 33 px/s, voire
                //     un seul repère quand le zoom baissait.
                const viewport = Math.max(240, (rulerContent && rulerContent.clientWidth)
                    || this.getTimelineViewportWidth());
                const scrollLeft = timelineScroll ? timelineScroll.scrollLeft : 0;
                const span = Math.max(timelineEnd, (scrollLeft + viewport * 1.3) / this.zoomLevel);
                const width = span * this.zoomLevel;

                marksContainer.style.width = width + 'px';
                marksContainer.innerHTML = '';

                // Espacement visé entre deux repères MAJEURS (px) : assez serré pour se repérer,
                // assez large pour que les étiquettes ne se chevauchent pas.
                const TARGET_LABEL_PX = 120;
                const NICE_INTERVALS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
                const pixelsPerSec = this.zoomLevel;
                let interval = NICE_INTERVALS.find((v) => v * pixelsPerSec >= TARGET_LABEL_PX);
                if (!interval) interval = NICE_INTERVALS[NICE_INTERVALS.length - 1];

                // Sous-graduations (une entre deux repères majeurs). On les abandonne si elles
                // devenaient trop nombreuses (très fort zoom sur une longue plage) : des milliers
                // de <div> ralentiraient le rendu sans rien apporter à la lecture.
                const subInterval = interval / 2;
                const totalSubTicks = Math.ceil(span / subInterval);
                const drawSubTicks = totalSubTicks <= 600;

                const totalTicks = drawSubTicks ? totalSubTicks : Math.ceil(span / interval);
                const step = drawSubTicks ? subInterval : interval;

                // K3 fix: compteur entier × pas fixe (évite la dérive d'accumulation flottante)
                for (let n = 0; n <= totalTicks; n++) {
                    const t = n * step;
                    if (t > span + step) break;
                    const isMajor = drawSubTicks ? (n % 2 === 0) : true;
                    const xPos = t * this.zoomLevel;

                    const mark = document.createElement('div');
                    mark.className = 'ruler-mark' + (isMajor ? '' : ' ruler-mark-minor');
                    mark.style.left = xPos + 'px';
                    marksContainer.appendChild(mark);

                    if (isMajor) {
                        const label = document.createElement('div');
                        label.className = 'ruler-time';
                        // Format mm:ss (h:mm:ss au-delà d'une heure)
                        const hours = Math.floor(t / 3600);
                        const mins = Math.floor((t % 3600) / 60);
                        const secs = Math.floor(t % 60);
                        label.textContent = hours > 0
                            ? `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
                            : `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                        label.style.left = xPos + 'px';
                        marksContainer.appendChild(label);
                    }
                }

                // Add STOP marker at the end of the last clip
                let lastClipEnd = 0;
                this.tracks.forEach(track => {
                    track.clips.forEach(clip => {
                        const clipEnd = clip.startTime + clip.duration;
                        if (clipEnd > lastClipEnd) {
                            lastClipEnd = clipEnd;
                        }
                    });
                });

                if (lastClipEnd > 0) {
                    const stopMarker = document.createElement('div');
                    stopMarker.className = 'clip-end-marker';
                    stopMarker.style.left = (lastClipEnd * this.zoomLevel) + 'px';
                    marksContainer.appendChild(stopMarker);
                }
                
                // Add ruler playhead indicator (syncs with playhead in updatePlayhead)
                const rulerPlayhead = document.createElement('div');
                rulerPlayhead.className = 'ruler-playhead';
                rulerPlayhead.id = 'rulerPlayhead';
                rulerPlayhead.style.left = (this.currentTime * this.zoomLevel) + 'px';
                marksContainer.appendChild(rulerPlayhead);

                // Le bandeau vient d'être reconstruit : on réaligne tout de suite la
                // translation sur la position de défilement des pistes.
                if (this._syncRulerScroll) this._syncRulerScroll();
            }

            /**
             * 🧹 Retire l'état « zone de dépôt survolée » de toutes les pistes.
             *
             * Historique : `dragover` écrivait `content.style.background = 'rgba(102,126,234,0.2)'`
             * (bleu) et seuls `dragleave` / `drop` l'effaçaient. Or `dragleave` n'arrive pas
             * toujours (drop en dehors de la piste, glisser annulé, onglet qui perd le focus,
             * éléments recréés pendant le glisser) : la piste gardait alors un **fond bleu
             * opaque permanent**, visible au milieu d'une timeline noire. On ne touche
             * désormais plus au style inline — c'est la classe `.drop-target` qui porte l'état,
             * et cette méthode la retire partout (dragend, drop, blur, Échap, rendu des pistes).
             */
            _clearDropTargets() {
                document.querySelectorAll('.track-content.drop-target, .timeline-area.drop-target')
                    .forEach((el) => el.classList.remove('drop-target'));
            }

            renderTracks() {
                // Un rendu recrée les pistes : tout état de survol hérité doit disparaître.
                this._clearDropTargets();

                // Ensure clips are ordered by startTime before rendering (prevents z-order issues)
                this.tracks.forEach(t => t.clips.sort((a, b) => a.startTime - b.startTime));

                // Build media lookup map for O(1) thumbnail access in createClipElement
                this._mediaMap = new Map();
                for (const m of this.mediaLibrary) {
                    this._mediaMap.set(m.id, m);
                }
                
                const container = document.getElementById('timelineTracks');
                const timelineEnd = this.getTimelineEnd();
                const width = timelineEnd * this.zoomLevel;

                // Set inner container width to match tracks exactly
                const inner = document.getElementById('timelineContainer');
                if (inner) {
                    inner.style.width = (this.TRACK_HEADER_WIDTH + width) + 'px';
                }
                
                // Preserve min-height during rebuild to prevent visual collapse
                const currentHeight = container.offsetHeight;
                if (currentHeight > 0) {
                    container.style.minHeight = currentHeight + 'px';
                }
                container.innerHTML = '';

                this.tracks.forEach(track => {
                    const trackEl = document.createElement('div');
                    trackEl.className = 'timeline-track';

                    const header = document.createElement('div');
                    header.className = 'track-controls-left';
                    const vol = track.volume !== undefined ? track.volume : 100;
                    const safeName = this.escapeHtml(track.name);
                    header.innerHTML = `
                        <div class="track-header-top">
                            <div class="track-name" title="${safeName}">${safeName}</div>
                            <button class="track-del-btn" onclick="app.deleteTrack(${track.id})" title="${window.tr('Delete track', 'Supprimer la piste')}" aria-label="${window.tr('Delete track', 'Supprimer la piste')}">×</button>
                        </div>
                        <div class="track-ms-row">
                            <button class="track-btn-m ${track.muted ? 'muted' : ''}" onclick="app.toggleMute(${track.id})" title="${track.muted ? window.tr('Unmute track', 'Réactiver la piste') : window.tr('Mute track', 'Rendre la piste muette')}" aria-pressed="${track.muted ? 'true' : 'false'}">M</button>
                            <button class="track-btn-s ${track.solo ? 'solo' : ''}" onclick="app.toggleSolo(${track.id})" title="${track.solo ? window.tr('Disable solo', 'Désactiver solo') : window.tr('Solo track', 'Isoler la piste')}" aria-pressed="${track.solo ? 'true' : 'false'}">S</button>
                        </div>
                        <div class="track-vol-row">
                            <input type="range" class="track-volume" min="0" max="100" value="${vol}"
                                style="--vol: ${vol}%"
                                oninput="app.handleVolumeInput(${track.id}, this)"
                                aria-label="${window.tr('Track volume', 'Volume de la piste')}"
                                title="${window.tr('Volume', 'Volume')}: ${vol}%" />
                            <span class="track-vol-val">${vol}</span>
                        </div>
                    `;

                    const content = document.createElement('div');
                    content.className = 'track-content';
                    content.style.width = width + 'px';
                    content.dataset.trackId = track.id;

                    // Drop zone — accept internal media drags AND external file drops
                    // ⚠️ L'état « survolé » passe par la CLASSE `.drop-target` et JAMAIS par
                    //    `content.style.background` : un style inline restait collé si le
                    //    glisser se terminait ailleurs (drop hors piste, `dragend` manqué,
                    //    onglet qui perd le focus) → la piste gardait un fond bleu opaque
                    //    permanent. La classe, elle, se nettoie (voir _clearDropTargets).
                    content.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        content.classList.add('drop-target');
                    });

                    content.addEventListener('dragleave', () => {
                        content.classList.remove('drop-target');
                    });

                    content.addEventListener('drop', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        content.classList.remove('drop-target');
                        this._clearDropTargets();
                        
                        // External file drop from desktop → import + add to this track
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && !this.draggedMedia) {
                            const rect = content.getBoundingClientRect();
                            const timelineScroll = document.getElementById('timelineScroll');
                            const x = e.clientX - rect.left + (timelineScroll ? timelineScroll.scrollLeft : 0);
                            const dropTime = this.quantizeTime(Math.max(0, x / this.zoomLevel));
                            
                            this.handleFilesAndAddToTrack(e.dataTransfer.files, track.id, dropTime);
                            return;
                        }
                        
                        if (this.draggedMedia) {
                            const rect = content.getBoundingClientRect();
                            const timelineScroll = document.getElementById('timelineScroll');
                            // Account for horizontal scroll
                            const x = e.clientX - rect.left + (timelineScroll ? timelineScroll.scrollLeft : 0);
                            let startTime = this.quantizeTime(Math.max(0, x / this.zoomLevel));
                            
                            // MAGNETIC SNAP on drop — snap to adjacent clips on this track
                            const mediaDuration = this.draggedMedia.duration || 5;
                            const dropEnd = startTime + mediaDuration;
                            for (const otherClip of track.clips) {
                                const otherEnd = this.quantizeTime(otherClip.startTime + otherClip.duration);
                                // Snap start to other clip's end
                                if (Math.abs(startTime - otherEnd) < this.SNAP_THRESHOLD) {
                                    startTime = otherEnd;
                                    break;
                                }
                                // Snap end to other clip's start
                                if (Math.abs(dropEnd - otherClip.startTime) < this.SNAP_THRESHOLD) {
                                    startTime = this.quantizeTime(otherClip.startTime - mediaDuration);
                                    break;
                                }
                            }
                            
                            this.addClipToTrack(this.draggedMedia, track.id, startTime);
                        }
                    });

                    // Render clips
                    track.clips.forEach(clip => {
                        const clipEl = this.createClipElement(clip);
                        content.appendChild(clipEl);
                    });

                    trackEl.appendChild(header);
                    trackEl.appendChild(content);
                    container.appendChild(trackEl);
                });

                // Release min-height after rebuild
                requestAnimationFrame(() => {
                    container.style.minHeight = '';
                    // Limit playhead height to actual tracks area
                    const playhead = document.getElementById('playhead');
                    if (playhead && container.offsetHeight > 0) {
                        playhead.style.height = container.offsetHeight + 'px';
                    }
                });

                // Keep ruler in sync with tracks
                this.renderRuler();
            }

            createClipElement(clip) {
                const clipEl = document.createElement('div');
                clipEl.className = 'timeline-clip';
                clipEl.dataset.clipId = clip.id;
                
                // Add class based on clip type for styling
                if (clip.type === 'video') {
                    clipEl.classList.add('clip-video');
                } else if (clip.type === 'audio') {
                    clipEl.classList.add('clip-audio');
                } else if (clip.type === 'image') {
                    clipEl.classList.add('clip-image');
                } else if (clip.type === 'text') {
                    clipEl.classList.add('clip-text');
                    clipEl.style.backgroundColor = '#9b59b6';
                } else if (clip.type === 'block') {
                    clipEl.classList.add('clip-block');
                    clipEl.style.backgroundColor = clip.color;
                }
                
                if (this.selectedClip && (this.selectedClip.id === clip.id || this.selectedClipIds.has(clip.id))) {
                    clipEl.classList.add('selected');
                } else if (this.selectedClipIds.has(clip.id)) {
                    clipEl.classList.add('selected');
                }

                const left = clip.startTime * this.zoomLevel;
                const width = clip.duration * this.zoomLevel;

                clipEl.style.left = left + 'px';
                clipEl.style.width = width + 'px';

                // Build label with audio state indicator
                let label = clip.name;
                let badge = '';
                if (clip.type === 'video' && clip.audioUnlinked) {
                    badge = '<span class="clip-link-badge unlinked" title="Audio unlinked">🔇</span>';
                }

                // Resolve media for lightweight timeline thumbnail surface
                const media = this._mediaMap ? this._mediaMap.get(clip.mediaId) : this.mediaLibrary.find(m => m.id === clip.mediaId);
                const hasThumbsMedia = media && media.thumbnails && media.thumbnails.length > 0 && (clip.type === 'video' || clip.type === 'image');
                if (hasThumbsMedia) {
                    clipEl.classList.add('has-thumbs');
                }

                // Mark clips with effects
                if (clip.effect && clip.effect !== 'none') {
                    clipEl.classList.add('has-fx');
                }

                clipEl.innerHTML = `
                    <div class="clip-label">${badge}</div>
                    <div class="clip-handle left"></div>
                    <div class="clip-handle right"></div>
                `;
                // Set label text safely (avoids XSS from file names)
                clipEl.querySelector('.clip-label').appendChild(document.createTextNode(label));

                // 🖼️ VIGNETTE D'APERÇU — UNE SEULE IMAGE, POSÉE AU DÉBUT DU CLIP, JAMAIS ÉTIRÉE
                //    (choix de l'utilisateur, 2026-09-17)
                //    Historique des trois essais, pour ne pas refaire les erreurs :
                //      1) images réparties sur toute la largeur → une vignette étirée horizontalement,
                //         méconnaissable (60 px de large dessinés sur 500) ;
                //      2) la même image répétée en mosaïque (`repeat-x`) → effet « pellicule »
                //         bruyant et chargé sur la timeline ;
                //      3) → **retenu** : une seule image, à sa TAILLE NATURELLE (`auto 100%`, la
                //         hauteur du clip impose l'échelle, la largeur suit le rapport de l'image),
                //         alignée à GAUCHE, sans répétition. Aucune déformation, aucune répétition,
                //         et le fond du clip reste visible pour lire son nom et sa durée.
                //    Le repère visuel est donc « ce clip commence par cette image », ce qui suffit
                //    pour se repérer dans la timeline.
                if (hasThumbsMedia) {
                    const sourceStart = clip.sourceStart || 0;
                    const framesSource = media.thumbnailFrames || media.thumbnails.map((url, index) => ({
                        time: media.duration && media.thumbnails.length > 1 ? (index / (media.thumbnails.length - 1)) * media.duration : 0,
                        url
                    }));
                    // La vignette la plus proche du DÉBUT du clip : si l'utilisateur a rogné le début
                    // du clip (`sourceStart`), on montre l'image correspondante, pas celle de 0 s.
                    const frame = framesSource.find(f => f.time >= sourceStart - this.TIME_EPSILON) || framesSource[0];
                    if (frame) {
                        const thumb = document.createElement('div');
                        thumb.className = 'clip-thumb-surface';
                        thumb.style.backgroundImage = `url("${frame.url}")`;
                        thumb.style.backgroundSize = 'auto 100%';
                        thumb.style.backgroundPosition = 'left center';
                        thumb.style.backgroundRepeat = 'no-repeat';
                        clipEl.insertBefore(thumb, clipEl.firstChild);
                    }

                    const meta = document.createElement('div');
                    meta.className = 'clip-thumb-meta';
                    const durationBadge = document.createElement('span');
                    durationBadge.textContent = this.formatTime(clip.duration);
                    meta.appendChild(durationBadge);
                    if ((clip.sourceStart || 0) > this.TIME_EPSILON) {
                        const sourceBadge = document.createElement('span');
                        sourceBadge.textContent = '+' + this.formatTime(clip.sourceStart || 0);
                        meta.appendChild(sourceBadge);
                    }
                    if (clip.videoScale !== undefined && Math.round(clip.videoScale) !== 100) {
                        const scaleBadge = document.createElement('span');
                        scaleBadge.textContent = Math.round(clip.videoScale) + '%';
                        meta.appendChild(scaleBadge);
                    }
                    clipEl.appendChild(meta);
                }

                // Selection is handled in startDragClip (mousedown) so it fires even when
                // renderTracks() rebuilds the DOM before the 'click' event would fire.
                // Keep dblclick for text editing only.
                if (clip.type === 'text') {
                    clipEl.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        this.editTextClip(clip);
                    });
                }

                // Handle trimming
                const leftHandle = clipEl.querySelector('.clip-handle.left');
                const rightHandle = clipEl.querySelector('.clip-handle.right');

                if (leftHandle) {
                    leftHandle.addEventListener('pointerdown', (e) => {
                        e.stopPropagation();
                        this.startTrimClip(clip, 'left', e);
                    });
                }

                if (rightHandle) {
                    rightHandle.addEventListener('pointerdown', (e) => {
                        e.stopPropagation();
                        this.startTrimClip(clip, 'right', e);
                    });
                }

                // Drag to move — selection handled here on pointerdown
                clipEl.addEventListener('pointerdown', (e) => {
                    if (e.target === clipEl || e.target.classList.contains('clip-label')) {
                        this.startDragClip(clip, e);
                    }
                });

                return clipEl;
            }

            selectClip(clip, { keepPreviewHandles = false } = {}) {
                if (!keepPreviewHandles) {
                    this._previewHandlesActive = false; // hide preview handles when selecting from timeline
                }
                this.selectedClip = clip;
                // Replace multi-selection with this single clip
                this.selectedClipIds.clear();
                if (clip) this.selectedClipIds.add(clip.id);
                if (this.isPlaying) {
                    // During playback, lightweight CSS-only update to avoid DOM rebuild/collapse
                    document.querySelectorAll('.timeline-clip.selected').forEach(el => el.classList.remove('selected'));
                    if (clip) {
                        const target = document.querySelector(`.timeline-clip[data-clip-id="${clip.id}"]`);
                        if (target) target.classList.add('selected');
                    }
                } else {
                    this.renderTracks();
                }
                this.renderProperties();

                // 🐛 BUGFIX (2026-09-10) — « je ne vois pas les poignées ».
                // Auparavant, les poignées de transformation n'apparaissaient QUE si
                // l'utilisateur cliquait dans l'aperçu (_previewHandlesActive). Sélectionner
                // un clip dans la timeline (le geste le plus courant) ne montrait donc
                // AUCUN cadre ni poignée : impossible de redimensionner à la souris.
                // On active désormais le cadre/poignées pour tout clip visuel sélectionné,
                // tout en gardant le masquage explicite via un clic hors aperçu.
                this._previewHandlesActive = !!(clip && (clip.type === 'video' || clip.type === 'image' || clip.type === 'text' || clip.type === 'block'));
            }

            // Resolve a clip by id across all tracks. Returns { clip, track } or null.
            _findClipById(id) {
                for (const t of this.tracks) {
                    if (!t || !Array.isArray(t.clips)) continue;
                    for (const c of t.clips) {
                        if (c.id === id) return { clip: c, track: t };
                    }
                }
                return null;
            }

            // Refresh just the .selected class on every timeline clip from selectedClipIds.
            // Cheap CSS-only sync used by shift+click so we don't rebuild the timeline DOM.
            _refreshSelectionDom() {
                document.querySelectorAll('.timeline-clip').forEach(el => {
                    const id = parseInt(el.dataset.clipId, 10);
                    el.classList.toggle('selected', this.selectedClipIds.has(id));
                });
            }

            startDragClip(clip, e) {
                e.preventDefault();

                // ── Shift+click = toggle this clip in multi-selection (NO drag) ──────
                // Standard NLE behaviour: shift extends/reduces the selection set, then
                // a plain mousedown on any selected clip drags the whole group.
                if (e.shiftKey) {
                    if (this.selectedClipIds.has(clip.id)) {
                        this.selectedClipIds.delete(clip.id);
                        if (this.selectedClip && this.selectedClip.id === clip.id) {
                            // Pick another remaining clip as the property-panel anchor
                            const nextId = this.selectedClipIds.values().next().value;
                            const found = nextId != null ? this._findClipById(nextId) : null;
                            this.selectedClip = found ? found.clip : null;
                        }
                    } else {
                        this.selectedClipIds.add(clip.id);
                        this.selectedClip = clip; // anchor on the latest added
                    }
                    this._refreshSelectionDom();
                    this.renderProperties();
                    return;
                }

                // ── Lightweight selection on mousedown ─────────────────────────────────
                // The 'click' event would fire AFTER mouseup, but onUp calls renderTracks()
                // which destroys the DOM element before click can dispatch → selectClip
                // was never called. Fix: select immediately on mousedown instead.
                // Preserve existing multi-selection ONLY if the clip is already part of it
                // (so the user can drag the whole group with a plain click).
                const isGroupDrag = this.selectedClipIds.size > 1 && this.selectedClipIds.has(clip.id);
                if (!isGroupDrag) {
                    this.selectedClipIds.clear();
                    this.selectedClipIds.add(clip.id);
                }
                this.selectedClip = clip;
                this._refreshSelectionDom();
                this.renderProperties();
                // ───────────────────────────────────────────────────────────────────────

                // Build the list of clips that will move together. Snapshot their original
                // startTime so deltas stay coherent across the whole drag.
                const groupClips = isGroupDrag
                    ? [...this.selectedClipIds].map(id => {
                        const f = this._findClipById(id);
                        return f ? f.clip : null;
                    }).filter(Boolean)
                    : [clip];
                const groupOrig = new Map(groupClips.map(c => [c.id, c.startTime]));
                const groupMinStart = Math.min(...groupClips.map(c => c.startTime));

                const startX = e.clientX;
                const startY = e.clientY;
                const startTime = clip.startTime;
                const originalTrack = this.tracks.find(t => t.id === clip.trackId);
                let currentTargetTrack = originalTrack;
                let hasMoved = false;
                const DRAG_THRESHOLD = 4; // px — less than this = click, not drag

                const onMove = (e) => {
                    const deltaX = e.clientX - startX;
                    const deltaY = e.clientY - startY;

                    // Don't start drag logic until user moves past threshold
                    if (!hasMoved) {
                        if (Math.abs(deltaX) < DRAG_THRESHOLD && Math.abs(deltaY) < DRAG_THRESHOLD) return;
                        hasMoved = true;
                    }

                    const deltaTime = deltaX / this.zoomLevel;

                    if (isGroupDrag) {
                        // Group horizontal drag: clamp so the earliest clip stays >= 0.
                        // Track changes are disabled for group drags to keep it simple.
                        let groupDelta = Math.max(deltaTime, -groupMinStart);
                        // Snap the anchor clip; offset the rest by the same delta.
                        const anchorNew = startTime + groupDelta;
                        const snapResult = this.trySnap(anchorNew, clip.duration, clip.id);
                        if (snapResult) {
                            groupDelta = snapResult.snappedTime - startTime;
                            // Re-clamp after snap
                            groupDelta = Math.max(groupDelta, -groupMinStart);
                            this.showSnapIndicator(snapResult.snapX);
                        } else {
                            this.hideSnapIndicator();
                        }
                        for (const gc of groupClips) {
                            gc.startTime = this.quantizeTime(Math.max(0, groupOrig.get(gc.id) + groupDelta));
                            const dragEl = document.querySelector(`.timeline-clip[data-clip-id="${gc.id}"]`);
                            if (dragEl) dragEl.style.left = (gc.startTime * this.zoomLevel) + 'px';
                        }
                        return;
                    }

                    let newStartTime = Math.max(0, startTime + deltaTime);
                    
                    // Detect track change based on vertical movement
                    // C1 fix: read actual track height from DOM instead of hardcoded 76px
                    const trackHeight = document.querySelector('.timeline-track')?.getBoundingClientRect().height || 76;
                    const trackDelta = Math.round(deltaY / trackHeight);
                    const originalTrackIndex = this.tracks.findIndex(t => t.id === originalTrack.id);
                    const newTrackIndex = Math.max(0, Math.min(this.tracks.length - 1, originalTrackIndex + trackDelta));
                    const targetTrack = this.tracks[newTrackIndex];
                    
                    // Move clip to new track if changed
                    let trackChanged = false;
                    if (targetTrack && targetTrack.id !== clip.trackId) {
                        // Remove from old track
                        const oldTrack = this.tracks.find(t => t.id === clip.trackId);
                        if (oldTrack) {
                            const index = oldTrack.clips.indexOf(clip);
                            if (index > -1) {
                                oldTrack.clips.splice(index, 1);
                            }
                        }
                        
                        // Add to new track
                        clip.trackId = targetTrack.id;
                        targetTrack.clips.push(clip);
                        currentTargetTrack = targetTrack;
                        trackChanged = true;
                    }
                    
                    // MAGNETIC SNAP - snap to clips on all tracks + playhead
                    const snapResult = this.trySnap(newStartTime, clip.duration, clip.id);
                    if (snapResult) {
                        newStartTime = snapResult.snappedTime;
                        this.showSnapIndicator(snapResult.snapX);
                    } else {
                        this.hideSnapIndicator();
                    }

                    clip.startTime = this.quantizeTime(Math.max(0, newStartTime));

                    // Lightweight update during drag: only reposition the DOM element.
                    // Full renderTracks() is called on mouseup via onUp.
                    // Exception: track cross is needed for track-change moves.
                    if (trackChanged) {
                        this.renderTracks();
                    } else {
                        const dragEl = document.querySelector(`.timeline-clip[data-clip-id="${clip.id}"]`);
                        if (dragEl) dragEl.style.left = (clip.startTime * this.zoomLevel) + 'px';
                    }
                };

                const onUp = () => {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    document.removeEventListener('pointercancel', onUp);
                    window.removeEventListener('blur', onUp); // N8 fix
                    this.hideSnapIndicator();
                    this._invalidateTimelineEndCache(); // Clip may have moved beyond previous end

                    if (hasMoved) {
                        if (isGroupDrag) {
                            // Resolve overlaps: push the WHOLE group right by the largest
                            // overlap with any non-selected clip on the same tracks. This
                            // preserves relative spacing between selected clips.
                            const selectedIds = new Set(groupClips.map(c => c.id));
                            let pushRight = 0;
                            for (const gc of groupClips) {
                                const tr = this.tracks.find(t => t.id === gc.trackId);
                                if (!tr) continue;
                                for (const o of tr.clips) {
                                    if (selectedIds.has(o.id)) continue;
                                    if (gc.startTime < o.startTime + o.duration && gc.startTime + gc.duration > o.startTime) {
                                        pushRight = Math.max(pushRight, (o.startTime + o.duration) - gc.startTime);
                                    }
                                }
                            }
                            if (pushRight > 0) {
                                for (const gc of groupClips) {
                                    gc.startTime = this.quantizeTime(gc.startTime + pushRight);
                                }
                            }
                            // Re-sort each affected track
                            const affectedTracks = new Set(groupClips.map(c => c.trackId));
                            for (const tid of affectedTracks) {
                                const tr = this.tracks.find(t => t.id === tid);
                                if (tr) tr.clips.sort((a, b) => a.startTime - b.startTime);
                            }
                        } else {
                            // Single-clip drag: prevent overlap → push clip out of any collision
                            const dropTrack = this.tracks.find(t => t.id === clip.trackId);
                            if (dropTrack) {
                                const others = dropTrack.clips
                                    .filter(c => c.id !== clip.id)
                                    .sort((a, b) => a.startTime - b.startTime);
                                let s = clip.startTime;
                                let changed = true;
                                // Iterate until no more overlaps (max 10 passes)
                                for (let _p = 0; _p < 10 && changed; _p++) {
                                    changed = false;
                                    for (const o of others) {
                                        if (s < o.startTime + o.duration && s + clip.duration > o.startTime) {
                                            // Overlap — choose direction with least movement
                                            const toRight = o.startTime + o.duration;
                                            const toLeft  = Math.max(0, o.startTime - clip.duration);
                                            s = (Math.abs(s - toLeft) < Math.abs(s - toRight) && toLeft >= 0)
                                                ? toLeft : toRight;
                                            changed = true;
                                        }
                                    }
                                }
                                clip.startTime = this.quantizeTime(s);
                                dropTrack.clips.sort((a, b) => a.startTime - b.startTime);
                            }
                        }
                        this.saveState();
                        this.renderTracks();
                        this.renderProperties();
                        this.forceVideoUpdate = true; // ensure seek after clip moved
                        this.updatePreview();
                    }
                    // Pure click: selection already set in mousedown (no rebuild needed)
                };

                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
                document.addEventListener('pointercancel', onUp);
                window.addEventListener('blur', onUp); // N8 fix
            }

            startTrimClip(clip, side, e) {
                e.preventDefault();
                const startX = e.clientX;
                const originalStart = clip.startTime;
                const originalDuration = clip.duration;
                const originalSourceStart = clip.sourceStart || 0;
                const track = this.tracks.find(t => t.id === clip.trackId);

                const onMove = (e) => {
                    const deltaX = e.clientX - startX;
                    const deltaTime = deltaX / this.zoomLevel;

                    if (side === 'left') {
                        // Trim from the start (IN point)
                        let newStart = Math.max(0, originalStart + deltaTime);
                        const maxTrim = originalDuration - 0.1; // Keep at least 0.1s
                        
                        // MAGNETIC SNAP - snap to all-track points
                        const points = this.getSnapPoints(clip.id);
                        let bestDelta = this.SNAP_THRESHOLD;
                        let snapAt = null;
                        for (const p of points) {
                            const d = Math.abs(newStart - p.time);
                            if (d < bestDelta) { bestDelta = d; newStart = p.time; snapAt = p.time; }
                        }
                        if (snapAt !== null) { this.showSnapIndicator(snapAt * this.zoomLevel); }
                        else { this.hideSnapIndicator(); }

                        // B1 fix: clamp delta so sourceStart never goes below 0 (floor = -originalSourceStart)
                        // and clip never gets shorter than 0.1s (ceil = maxTrim)
                        const rawDelta = newStart - originalStart;
                        const clampedDelta = Math.max(-originalSourceStart, Math.min(rawDelta, maxTrim));
                        clip.startTime = this.quantizeTime(originalStart + clampedDelta);
                        clip.duration = this.quantizeTime(originalDuration - clampedDelta);
                        clip.sourceStart = this.quantizeTime(originalSourceStart + clampedDelta);
                    } else {
                        // Trim from the end (OUT point)
                        let newDuration = Math.max(0.1, originalDuration + deltaTime);
                        const maxDuration = isFinite(clip.sourceDuration)
                            ? clip.sourceDuration - originalSourceStart
                            : newDuration; // images have Infinity sourceDuration — no cap needed
                        newDuration = Math.min(newDuration, maxDuration);
                        
                        // MAGNETIC SNAP - snap to all-track points
                        const newEnd = originalStart + newDuration;
                        const points2 = this.getSnapPoints(clip.id);
                        let bestDelta2 = this.SNAP_THRESHOLD;
                        let snapAt2 = null;
                        for (const p of points2) {
                            const d = Math.abs(newEnd - p.time);
                            if (d < bestDelta2) { bestDelta2 = d; newDuration = p.time - originalStart; snapAt2 = p.time; }
                        }
                        if (snapAt2 !== null) { this.showSnapIndicator(snapAt2 * this.zoomLevel); }
                        else { this.hideSnapIndicator(); }

                        // B2 fix: re-apply cap after snap to prevent snap overshooting sourceDuration
                        newDuration = Math.min(newDuration, maxDuration);
                        clip.duration = this.quantizeTime(Math.max(0.1, newDuration));
                    }

                    // Lightweight real-time update: only resize/reposition the clip element
                    // instead of a full renderTracks() DOM wipe on every mousemove
                    const trimEl = document.querySelector(`.timeline-clip[data-clip-id="${clip.id}"]`);
                    if (trimEl) {
                        trimEl.style.left = (clip.startTime * this.zoomLevel) + 'px';
                        trimEl.style.width = (clip.duration * this.zoomLevel) + 'px';
                    }
                };

                const onUp = () => {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    document.removeEventListener('pointercancel', onUp);
                    window.removeEventListener('blur', onUp); // N8 fix
                    this.hideSnapIndicator();
                    this._invalidateTimelineEndCache(); // Clip may have moved beyond previous end
                    this.saveState();
                    this.renderTracks(); // full rebuild on release to sync all state
                    this.renderProperties();
                    this.forceVideoUpdate = true; // ensure seek after trim change
                    this.updatePreview();
                };

                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
                document.addEventListener('pointercancel', onUp);
                window.addEventListener('blur', onUp); // N8 fix: release on window focus loss
            }

            toggleProperties() {
                const panel = document.getElementById('propertiesPanel');
                panel.classList.toggle('open');
                // Mobile backdrop
                if (window.innerWidth <= 768) {
                    const backdrop = document.getElementById('mobileBackdrop');
                    if (backdrop) backdrop.classList.toggle('show', panel.classList.contains('open'));
                }
            }

            // ============================================
            // UNDO/REDO SYSTEM
            // ============================================
            
            // 🆕 Debounce des saveState() déclenchés par des sliders : coalesce
            // les nombreux `oninput` d'un drag continu en UNE seule entrée
            // d'historique (sinon Ctrl+Z avance pixel par pixel).
            //   - Annulé par tout appel direct à saveState()
            //   - Flushé immédiatement dans undo()/redo() pour ne pas perdre
            //     l'état en cours.
            _scheduleSaveState(delay = 500) {
                if (this._pendingSaveStateTimer) {
                    clearTimeout(this._pendingSaveStateTimer);
                }
                this._pendingSaveStateTimer = setTimeout(() => {
                    this._pendingSaveStateTimer = null;
                    this.saveState();
                }, delay);
            }

            saveState() {
                // 🆕 Une saveState() explicite annule le timer de debounce :
                // l'appel courant écrira l'état complet, inutile d'en pousser un second.
                if (this._pendingSaveStateTimer) {
                    clearTimeout(this._pendingSaveStateTimer);
                    this._pendingSaveStateTimer = null;
                }
                // Replacer/reviver to survive JSON round-trip: Infinity → sentinel string
                // Also drop non-serialisable File objects (blob URL in .url is enough for undo).
                const _rep = (k, v) => {
                    if (v === Infinity) return '__INF__';
                    if (k === 'file' && v instanceof File) return undefined; // never store File in history
                    return v;
                };
                const _rev = (k, v) => (v === '__INF__' ? Infinity : v);

                // Create a snapshot of current state
                const state = {
                    tracks: JSON.parse(JSON.stringify(this.tracks, _rep), _rev),
                    mediaLibrary: JSON.parse(JSON.stringify(this.mediaLibrary, _rep), _rev),
                    clipIdCounter: this.clipIdCounter,
                    trackIdCounter: this.trackIdCounter,
                    mediaIdCounter: this.mediaIdCounter,
                    colorGrading: { ...this.colorGrading }
                };

                // Remove any states after current index (when doing action after undo)
                this.history = this.history.slice(0, this.historyIndex + 1);
                
                // Add new state
                this.history.push(state);
                
                // Limit history size
                if (this.history.length > this.maxHistorySize) {
                    this.history.shift();
                } else {
                    this.historyIndex++;
                }
                
                // Mark dirty for auto-save
                this.markDirty();
                
                this.updateUndoRedoButtons();
            }

            restoreState(state) {
                // Replacer + reviver to round-trip Infinity through JSON without corruption.
                // JSON.stringify converts Infinity → null by spec; we must use the replacer
                // to encode it as '__INF__' BEFORE stringify, then decode it back with the reviver.
                const _rep = (k, v) => (v === Infinity ? '__INF__' : v);
                const _rev = (k, v) => (v === '__INF__' ? Infinity : v);
                this.tracks = JSON.parse(JSON.stringify(state.tracks, _rep), _rev);
                this.mediaLibrary = JSON.parse(JSON.stringify(state.mediaLibrary, _rep), _rev);
                this.clipIdCounter = state.clipIdCounter;
                this.trackIdCounter = state.trackIdCounter;
                this.mediaIdCounter = state.mediaIdCounter;
                // Restore color grading (A1 fix)
                if (state.colorGrading) {
                    this.colorGrading = { ...state.colorGrading };
                    this.applyColorGrading();
                }
                // Clear stale video cache so clips are re-loaded from fresh URLs (M4 fix)
                this.releaseVideoCache();
                this.releaseAudioElements();
                // Force preview to re-detect the clip after undo (F5 fix)
                this._currentPreviewClip = null;
                this.forceVideoUpdate = true;
                
                // Recalculate solo logic (_effectiveMute)
                const anySolo = this.tracks.some(t => t.solo);
                this.tracks.forEach(t => {
                    t._effectiveMute = anySolo && !t.solo;
                });
                
                this.selectedClip = null;
                if (this.selectedClipIds) this.selectedClipIds.clear();
                this.fullRefresh();
                this.updateUndoRedoButtons();
            }

            undo() {
                // 🆕 Flush tout état debouncé en attente AVANT de défaire, sinon
                // un drag de slider en cours serait perdu sans entrée d'historique.
                if (this._pendingSaveStateTimer) {
                    clearTimeout(this._pendingSaveStateTimer);
                    this._pendingSaveStateTimer = null;
                    this.saveState();
                }
                if (this.historyIndex > 0) {
                    this.historyIndex--;
                    this.restoreState(this.history[this.historyIndex]);
                    this.showStatus('↶ Undo');
                } else {
                    this.showStatus('Nothing to undo');
                }
                this.updateUndoRedoButtons();
            }

            redo() {
                // 🆕 Idem qu'undo : flush l'état en attente avant tout déplacement
                // dans l'historique pour rester cohérent.
                if (this._pendingSaveStateTimer) {
                    clearTimeout(this._pendingSaveStateTimer);
                    this._pendingSaveStateTimer = null;
                    this.saveState();
                }
                if (this.historyIndex < this.history.length - 1) {
                    this.historyIndex++;
                    this.restoreState(this.history[this.historyIndex]);
                    this.showStatus('↷ Redo');
                } else {
                    this.showStatus('Nothing to redo');
                }
                this.updateUndoRedoButtons();
            }

            updateUndoRedoButtons() {
                const undoBtn = document.getElementById('undoBtn');
                const redoBtn = document.getElementById('redoBtn');
                
                if (undoBtn) {
                    undoBtn.disabled = this.historyIndex <= 0;
                    undoBtn.title = this.historyIndex > 0 
                        ? `Undo (Ctrl+Z) - ${this.historyIndex} actions available`
                        : 'Nothing to undo (Ctrl+Z)';
                }
                
                if (redoBtn) {
                    redoBtn.disabled = this.historyIndex >= this.history.length - 1;
                    redoBtn.title = this.historyIndex < this.history.length - 1
                        ? `Redo (Ctrl+Y or Ctrl+Shift+Z) - ${this.history.length - this.historyIndex - 1} actions available`
                        : 'Nothing to redo (Ctrl+Y or Ctrl+Shift+Z)';
                }
            }

            // Save Reminder System
            startSaveReminder() {
                // Don't start if disabled by user
                if (this.saveReminderDisabled) {
                    return;
                }
                
                // Clear any existing interval
                if (this.saveReminderInterval) {
                    clearInterval(this.saveReminderInterval);
                }
                
                // Show reminder every 5 minutes (300000ms)
                this.saveReminderInterval = setInterval(() => {
                    if (!this.saveReminderDisabled) {
                        this.showSaveReminder();
                    }
                }, 300000);
            }

            showSaveReminder() {
                // Don't show during export
                if (this.isExporting) {
                    console.log('⏸️ Save reminder skipped (export in progress)');
                    return;
                }
                
                const modal = document.getElementById('saveReminderModal');
                const overlay = document.getElementById('saveReminderOverlay');
                const checkbox = document.getElementById('dontShowAgain');
                
                // Reset checkbox
                checkbox.checked = false;
                
                // Show modal
                modal.classList.add('show');
                overlay.classList.add('show');
            }

            closeSaveReminder() {
                const modal = document.getElementById('saveReminderModal');
                const overlay = document.getElementById('saveReminderOverlay');
                const checkbox = document.getElementById('dontShowAgain');
                
                // Check if user wants to disable reminders
                if (checkbox.checked) {
                    this.saveReminderDisabled = true;
                    localStorage.setItem('saveReminderDisabled', 'true');
                    
                    // Stop the interval
                    if (this.saveReminderInterval) {
                        clearInterval(this.saveReminderInterval);
                        this.saveReminderInterval = null;
                    }
                    
                    this.showStatus('Save reminders disabled');
                }
                
                // Hide modal
                modal.classList.remove('show');
                overlay.classList.remove('show');
            }

            saveFromReminder() {
                // Open the save dialog
                this.showSaveDialog();
                
                // Close the reminder
                this.closeSaveReminder();
            }

            renderProperties() {
                const container = document.getElementById('propertiesContent');
                
                if (!this.selectedClip) {
                    container.innerHTML = `
                        <div class="property-group">
                            <div style="text-align: center; padding: 50px 20px; color: #666666;">
                                <div style="font-size: 14px; margin-bottom: 10px; font-weight: 600; color: #666666;">PROPERTIES</div>
                                Select a clip to edit
                            </div>
                        </div>
                    `;
                    return;
                }

                const clip = this.selectedClip;
                
                // Auto-open properties panel when clip is selected - DISABLED FOR NOW
                // const panel = document.getElementById('propertiesPanel');
                // if (!panel.classList.contains('open')) {
                //     panel.classList.add('open');
                // }
                
                const _escapedName = clip.name.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                container.innerHTML = `
                    <div class="property-group">
                        <div class="property-label">Clip Name</div>
                        <input type="text" class="property-input" value="${_escapedName}" onchange="app.commitClipProperty('name', this.value)">
                    </div>
                    <div class="property-group">
                        <div class="property-label">Start Time</div>
                        <input type="number" class="property-input" value="${clip.startTime.toFixed(2)}" step="0.1" onchange="app.commitClipProperty('startTime', parseFloat(this.value))">
                    </div>
                    <div class="property-group">
                        <div class="property-label">Duration</div>
                        <input type="number" class="property-input" value="${clip.duration.toFixed(2)}" step="0.1" onchange="app.commitClipProperty('duration', parseFloat(this.value))">
                    </div>
                    <div class="property-group">
                        <div class="property-label">Source Start</div>
                        <input type="number" class="property-input" value="${(clip.sourceStart || 0).toFixed(2)}" step="0.1" onchange="app.commitClipProperty('sourceStart', parseFloat(this.value))">
                    </div>
                    <div class="property-group">
                        <div class="property-label">Type</div>
                        <input type="text" class="property-input" value="${clip.type}" disabled>
                    </div>
                `;

                // Add specific properties based on clip type
                if (clip.type === 'block') {
                    container.innerHTML += `
                        <div class="property-group">
                            <div class="property-label">Block Color</div>
                            <input type="color" class="property-input" value="${clip.color}" onchange="app.commitClipProperty('color', this.value)">
                        </div>
                        <div class="property-group">
                            <div class="property-label">Opacity (%)</div>
                            <input type="range" class="property-input" min="0" max="100" value="${(clip.opacity || 1.0) * 100}" oninput="app.updateClipProperty('opacity', this.value / 100); this.nextElementSibling.textContent = this.value + '%'" onchange="app.saveState(); app.renderTracks();">
                            <span style="color: #888; font-size: 12px;">${Math.round((clip.opacity || 1.0) * 100)}%</span>
                        </div>
                        <div class="property-group">
                            <div class="property-label">Width (%)</div>
                            <input type="range" class="property-input" min="10" max="100" value="${clip.width || 50}" oninput="app.updateClipProperty('width', parseFloat(this.value)); this.nextElementSibling.textContent = this.value + '%'" onchange="app.saveState(); app.renderTracks();">
                            <span style="color: #888; font-size: 12px;">${clip.width || 50}%</span>
                        </div>
                        <div class="property-group">
                            <div class="property-label">Height (%)</div>
                            <input type="range" class="property-input" min="10" max="100" value="${clip.height || 50}" oninput="app.updateClipProperty('height', parseFloat(this.value)); this.nextElementSibling.textContent = this.value + '%'" onchange="app.saveState(); app.renderTracks();">
                            <span style="color: #888; font-size: 12px;">${clip.height || 50}%</span>
                        </div>
                        <div class="property-group">
                            <div class="property-label">Position X (%)</div>
                            <input type="range" class="property-input" min="0" max="100" value="${clip.posX || 25}" oninput="app.updateClipProperty('posX', parseFloat(this.value)); this.nextElementSibling.textContent = this.value + '%'" onchange="app.saveState(); app.renderTracks();">
                            <span style="color: #888; font-size: 12px;">${clip.posX || 25}%</span>
                        </div>
                        <div class="property-group">
                            <div class="property-label">Position Y (%)</div>
                            <input type="range" class="property-input" min="0" max="100" value="${clip.posY || 25}" oninput="app.updateClipProperty('posY', parseFloat(this.value)); this.nextElementSibling.textContent = this.value + '%'" onchange="app.saveState(); app.renderTracks();">
                            <span style="color: #888; font-size: 12px;">${clip.posY || 25}%</span>
                        </div>
                    `;
                }

                if (clip.type === 'video' || clip.type === 'image') {
                    const vs = clip.videoScale !== undefined ? Math.round(clip.videoScale) : 100;
                    const vx = clip.videoPosX !== undefined ? Math.round(clip.videoPosX) : 50;
                    const vy = clip.videoPosY !== undefined ? Math.round(clip.videoPosY) : 50;
                    container.innerHTML += `
                        <div class="property-group" style="padding-bottom:2px;">
                            <div class="property-label" style="color:#555;letter-spacing:1px;font-size:9px;text-transform:uppercase;">Transform</div>
                        </div>
                        <div class="property-group">
                            <div class="property-label">Scale (%)</div>
                            <input type="range" id="vidScaleSlider" class="property-input" min="5" max="800" value="${vs}" oninput="app.updateClipProperty('videoScale', parseFloat(this.value)); this.nextElementSibling.textContent = Math.round(this.value) + '%'; app.updatePreview();" onchange="app.saveState(); app.renderTracks();">
                            <span style="color:#888;font-size:12px;">${vs}%</span>
                        </div>
                        <div class="property-group">
                            <div class="property-label">Position X (%)</div>
                            <input type="range" id="vidPosXSlider" class="property-input" min="-200" max="300" value="${vx}" oninput="app.updateClipProperty('videoPosX', parseFloat(this.value)); this.nextElementSibling.textContent = Math.round(this.value) + '%'; app.updatePreview();" onchange="app.saveState(); app.renderTracks();">
                            <span style="color:#888;font-size:12px;">${vx}%</span>
                        </div>
                        <div class="property-group">
                            <div class="property-label">Position Y (%)</div>
                            <input type="range" id="vidPosYSlider" class="property-input" min="-200" max="300" value="${vy}" oninput="app.updateClipProperty('videoPosY', parseFloat(this.value)); this.nextElementSibling.textContent = Math.round(this.value) + '%'; app.updatePreview();" onchange="app.saveState(); app.renderTracks();">
                            <span style="color:#888;font-size:12px;">${vy}%</span>
                        </div>
                        <div class="property-group">
                            <button class="btn btn-secondary" style="width:100%;font-size:10px;" onclick="app.resetVideoTransform()">↺ Reset Transform</button>
                        </div>
                        <div class="property-group" style="padding-bottom:2px;margin-top:6px;">
                            <div class="property-label" style="color:#555;letter-spacing:1px;font-size:9px;text-transform:uppercase;">Transitions</div>
                        </div>
                        <div class="property-group">
                            <div class="property-label">Fade In (s)</div>
                            <input type="range" class="property-input" min="0" max="5" step="0.1" value="${(clip.fadeIn || 0).toFixed(1)}" oninput="app.updateClipProperty('fadeIn', parseFloat(this.value)); this.nextElementSibling.textContent = parseFloat(this.value).toFixed(1) + 's'; app.updatePreview();" onchange="app.saveState(); app.renderTracks();">
                            <span style="color:#888;font-size:12px;">${(clip.fadeIn || 0).toFixed(1)}s</span>
                        </div>
                        <div class="property-group">
                            <div class="property-label">Fade Out (s)</div>
                            <input type="range" class="property-input" min="0" max="5" step="0.1" value="${(clip.fadeOut || 0).toFixed(1)}" oninput="app.updateClipProperty('fadeOut', parseFloat(this.value)); this.nextElementSibling.textContent = parseFloat(this.value).toFixed(1) + 's'; app.updatePreview();" onchange="app.saveState(); app.renderTracks();">
                            <span style="color:#888;font-size:12px;">${(clip.fadeOut || 0).toFixed(1)}s</span>
                        </div>
                    `;
                }

                if (clip.type === 'text') {
                    const px = clip.posX !== undefined ? clip.posX : 50;
                    const py = clip.posY !== undefined ? clip.posY : 50;
                    const _sh = this._getTextShadow(clip.style);
                    const _shOn = !!(clip.style && clip.style.shadowEnabled);
                    container.innerHTML += `
                        <div class="property-group">
                            <div class="property-label">Position X (%)</div>
                            <input type="range" class="property-input text-pos-slider" min="0" max="100" value="${px}" oninput="app.updateClipProperty('posX', parseFloat(this.value)); this.nextElementSibling.textContent = this.value + '%'; app.updatePreview();" onchange="app.saveState(); app.renderTracks();">
                            <span style="color: #888; font-size: 12px;">${Math.round(px)}%</span>
                        </div>
                        <div class="property-group">
                            <div class="property-label">Position Y (%)</div>
                            <input type="range" class="property-input text-pos-slider" min="0" max="100" value="${py}" oninput="app.updateClipProperty('posY', parseFloat(this.value)); this.nextElementSibling.textContent = this.value + '%'; app.updatePreview();" onchange="app.saveState(); app.renderTracks();">
                            <span style="color: #888; font-size: 12px;">${Math.round(py)}%</span>
                        </div>
                        <div class="property-group" style="padding-bottom:2px;margin-top:6px;">
                            <div class="property-label" style="color:#555;letter-spacing:1px;font-size:9px;text-transform:uppercase;">Ombre du texte</div>
                        </div>
                        <div class="property-group">
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#aaa;">
                                <input type="checkbox" ${_shOn ? 'checked' : ''} onchange="app.setClipTextShadow('enabled', this.checked)">
                                Activer l'ombre
                            </label>
                        </div>
                        <div class="property-group" style="padding-left:6px;${_shOn ? '' : 'opacity:.45;pointer-events:none;'}">
                            <div class="property-label">Flou (px)</div>
                            <input type="range" class="property-input" min="0" max="40" value="${_sh ? _sh.blur : 4}" oninput="app.setClipTextShadow('blur', parseInt(this.value)); this.nextElementSibling.textContent = this.value + 'px';" onchange="app.saveState();">
                            <span style="color:#888;font-size:12px;">${_sh ? _sh.blur : 4}px</span>
                        </div>
                        <div class="property-group" style="padding-left:6px;${_shOn ? '' : 'opacity:.45;pointer-events:none;'}">
                            <div class="property-label">Décalage X (px)</div>
                            <input type="range" class="property-input" min="-20" max="20" value="${_sh ? _sh.offsetX : 2}" oninput="app.setClipTextShadow('offsetX', parseInt(this.value)); this.nextElementSibling.textContent = this.value + 'px';" onchange="app.saveState();">
                            <span style="color:#888;font-size:12px;">${_sh ? _sh.offsetX : 2}px</span>
                        </div>
                        <div class="property-group" style="padding-left:6px;${_shOn ? '' : 'opacity:.45;pointer-events:none;'}">
                            <div class="property-label">Décalage Y (px)</div>
                            <input type="range" class="property-input" min="-20" max="20" value="${_sh ? _sh.offsetY : 2}" oninput="app.setClipTextShadow('offsetY', parseInt(this.value)); this.nextElementSibling.textContent = this.value + 'px';" onchange="app.saveState();">
                            <span style="color:#888;font-size:12px;">${_sh ? _sh.offsetY : 2}px</span>
                        </div>
                        <div class="property-group">
                            <button class="btn btn-secondary" style="width:100%;font-size:10px;" onclick="app.editTextClip(app.selectedClip)">✎ Éditer le texte…</button>
                        </div>
                        <div class="property-group" style="text-align:center; color:#555; font-size:10px; padding: 4px 0;">
                            ↕ Déplacer directement dans la prévisualisation
                        </div>
                    `;
                }

                container.innerHTML += `
                    <div class="property-group">
                        <button class="btn btn-primary" style="width: 100%;" onclick="app.deleteClip(app.selectedClip)">
                            Delete Clip
                        </button>
                    </div>
                `;

                // Keep fade panel in sync when properties are repainted
                const _fp = document.getElementById('fadePanel');
                if (_fp && _fp.style.display !== 'none') this.updateFadePanel();
            }

            // ============================================
            // 🅣 TEXT SHADOW — ombre optionnelle (OFF par défaut)
            // ============================================
            // Source de vérité unique, partagée par l'aperçu ET les 3 moteurs d'export.
            // Le style est stocké dans clip.style.shadow* :
            //   shadowEnabled : bool  (défaut false → AUCUNE ombre)
            //   shadowColor   : CSS color (défaut rgba(0,0,0,0.8))
            //   shadowBlur    : px  (0–40)
            //   shadowOffsetX : px  (-20 … 20)
            //   shadowOffsetY : px  (-20 … 20)
            //
            // ⚠️ Historiquement, l'ombre était TOUJOURS appliquée en dur à l'export
            // (rgba(0,0,0,.8) blur 4 offset 2,2) alors que l'aperçu CSS la dessinait
            // aussi. On garde donc la compatibilité ascendante : si `shadowEnabled`
            // n'a jamais été défini sur un ancien projet, on conserve l'ancien rendu
            // (ombre présente) pour ne pas changer l'aspect des projets existants.
            _getTextShadow(style) {
                const s = style || {};
                // `undefined` (projet antérieur) → ancien comportement = ombre ; `false` → pas d'ombre.
                const enabled = s.shadowEnabled === undefined ? true : !!s.shadowEnabled;
                if (!enabled) return null;
                return {
                    color: s.shadowColor || 'rgba(0,0,0,0.8)',
                    blur: s.shadowBlur !== undefined ? Number(s.shadowBlur) : 4,
                    offsetX: s.shadowOffsetX !== undefined ? Number(s.shadowOffsetX) : 2,
                    offsetY: s.shadowOffsetY !== undefined ? Number(s.shadowOffsetY) : 2
                };
            }

            /** Applique (ou efface) l'ombre de texte sur un contexte canvas. */
            _applyTextShadow(ctx, style) {
                const sh = this._getTextShadow(style);
                if (!sh) {
                    ctx.shadowColor = 'rgba(0,0,0,0)';
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    return;
                }
                ctx.shadowColor = sh.color;
                ctx.shadowBlur = sh.blur;
                ctx.shadowOffsetX = sh.offsetX;
                ctx.shadowOffsetY = sh.offsetY;
            }

            /** Représentation CSS `text-shadow` pour l'aperçu (overlay texte). */
            _getTextShadowCss(style) {
                const sh = this._getTextShadow(style);
                if (!sh) return 'none';
                return `${sh.offsetX}px ${sh.offsetY}px ${sh.blur}px ${sh.color}`;
            }

            /**
             * 🅣 Met à jour un réglage d'ombre de texte (depuis le panneau Propriétés).
             * @param {'enabled'|'blur'|'offsetX'|'offsetY'|'color'} prop
             */
            setClipTextShadow(prop, value, { rerender = true } = {}) {
                const clip = this.selectedClip;
                if (!clip || clip.type !== 'text') return;
                if (!clip.style) clip.style = {};
                const s = clip.style;
                if (prop === 'enabled') {
                    s.shadowEnabled = !!value;
                    // À l'activation, garantir des valeurs par défaut exploitables.
                    if (s.shadowColor === undefined) s.shadowColor = 'rgba(0,0,0,0.8)';
                    if (s.shadowBlur === undefined) s.shadowBlur = 4;
                    if (s.shadowOffsetX === undefined) s.shadowOffsetX = 2;
                    if (s.shadowOffsetY === undefined) s.shadowOffsetY = 2;
                } else if (prop === 'color') {
                    s.shadowColor = value;
                } else if (prop === 'blur') {
                    s.shadowBlur = Math.max(0, Math.min(40, Number(value) || 0));
                } else if (prop === 'offsetX' || prop === 'offsetY') {
                    s[`shadow${prop === 'offsetX' ? 'OffsetX' : 'OffsetY'}`] = Math.max(-20, Math.min(20, Number(value) || 0));
                }
                this._lastPreviewKey = null; // force la reconstruction de l'overlay
                if (rerender) {
                    this.updatePreview();
                    // Le panneau doit refléter l'état actif/inactif des réglages.
                    if (prop === 'enabled') this.renderProperties();
                }
            }

            updateClipProperty(prop, value) {
                if (this.selectedClip) {
                    // Clamp time/duration to legal values (N5 fix)
                    if (prop === 'startTime') {
                        value = Math.max(0, isNaN(value) ? 0 : value);
                    } else if (prop === 'duration') {
                        const maxDur = (this.selectedClip.sourceDuration || Infinity) - (this.selectedClip.sourceStart || 0);
                        value = Math.max(0.1, Math.min(isNaN(value) ? 0.1 : value, isFinite(maxDur) ? maxDur : value));
                    } else if (prop === 'sourceStart') {
                        value = Math.max(0, isNaN(value) ? 0 : value);
                    }
                    this.selectedClip[prop] = value;
                    if (prop === 'videoScale' || prop === 'videoPosX' || prop === 'videoPosY' || prop === 'startTime' || prop === 'duration' || prop === 'sourceStart') {
                        this._cachedActiveClip = null;
                        this._lastXfKey = null;
                        this.forceVideoUpdate = true;
                    }
                    // Only save undo state at commit (onchange), not on every oninput tick.
                    // Callers that need immediate save pass saveNow=true.
                    this.updatePreview();
                }
            }

            // Called by onchange (text inputs, drag-end) to commit to undo history
            commitClipProperty(prop, value) {
                if (this.selectedClip) {
                    this.updateClipProperty(prop, value);
                    this.saveState();
                    this.renderTracks();
                }
            }

            updateClipStyle(prop, value) {
                if (this.selectedClip && this.selectedClip.style) {
                    this.selectedClip.style[prop] = value;
                    this.saveState();
                    this.renderTracks();
                    this.updatePreview(); // Update preview to show changes immediately
                }
            }

            editTextClip(clip) {
                // Open text editor modal
                const modal = document.getElementById('textEditorModal');
                if (!modal) {
                    this.createTextEditorModal();
                }
                
                this.selectedClip = clip;
                const contentInput = document.getElementById('textEditorContent');
                const fontSelect = document.getElementById('textEditorFont');
                const colorInput = document.getElementById('textEditorColor');
                const sizeInput = document.getElementById('textEditorSize');
                
                contentInput.value = clip.content;
                fontSelect.value = clip.style.fontFamily;
                colorInput.value = clip.style.color;
                sizeInput.value = parseInt(clip.style.fontSize);

                // 🅣 Ombre : charger l'état réel du clip dans les contrôles.
                const shEnabled = document.getElementById('textEditorShadow');
                const shColor = document.getElementById('textEditorShadowColor');
                const shBlur = document.getElementById('textEditorShadowBlur');
                const shX = document.getElementById('textEditorShadowX');
                const shY = document.getElementById('textEditorShadowY');
                const shadow = this._getTextShadow(clip.style);
                if (shEnabled) {
                    // `null` = ombre explicitement désactivée ; on reflète l'état réel.
                    shEnabled.checked = !!shadow && clip.style.shadowEnabled !== false;
                }
                if (shadow) {
                    if (shColor) shColor.value = this._toHexColor(shadow.color);
                    if (shBlur) shBlur.value = shadow.blur;
                    if (shX) shX.value = shadow.offsetX;
                    if (shY) shY.value = shadow.offsetY;
                }
                const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v + 'px'; };
                if (shBlur) setTxt('textEditorShadowBlurValue', shBlur.value);
                if (shX) setTxt('textEditorShadowXValue', shX.value);
                if (shY) setTxt('textEditorShadowYValue', shY.value);
                this.toggleTextShadowControls();

                document.getElementById('textEditorModal').classList.add('show');
                contentInput.focus();
                contentInput.select();
            }

            /** Affiche/masque le bloc de réglages d'ombre selon la case à cocher. */
            toggleTextShadowControls() {
                const enabled = document.getElementById('textEditorShadow');
                const controls = document.getElementById('textEditorShadowControls');
                if (controls) controls.style.display = enabled && enabled.checked ? 'block' : 'none';
            }

            /** Convertit une couleur CSS (rgb()/rgba()/hex) en #rrggbb pour <input type=color>. */
            _toHexColor(cssColor) {
                if (!cssColor) return '#000000';
                const c = String(cssColor).trim();
                if (/^#[0-9a-f]{6}$/i.test(c)) return c;
                if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
                const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
                if (m) {
                    const hx = (n) => parseInt(n, 10).toString(16).padStart(2, '0');
                    return '#' + hx(m[1]) + hx(m[2]) + hx(m[3]);
                }
                return '#000000';
            }

            createTextEditorModal() {
                const modal = document.createElement('div');
                modal.id = 'textEditorModal';
                modal.className = 'modal';
                modal.innerHTML = `
                    <div class="modal-content" style="max-width: 600px;">
                        <div class="modal-header">
                            <span>EDIT TEXT</span>
                            <span class="modal-close" onclick="app.closeTextEditor()">×</span>
                        </div>
                        <div style="padding: 20px;">
                            <div class="property-group">
                                <div class="property-label">Text Content</div>
                                <textarea id="textEditorContent" class="property-input" rows="4" style="font-size: 16px; resize: vertical;"></textarea>
                            </div>
                            <div class="property-group">
                                <div class="property-label">Font Family</div>
                                <select id="textEditorFont" class="property-input" onchange="app.updateTextEditorPreview()">
                                    <option value="Arial">Arial</option>
                                    <option value="Space Grotesk">Space Grotesk</option>
                                    <option value="Outfit">Outfit</option>
                                    <option value="Syne">Syne</option>
                                    <option value="Orbitron">Orbitron</option>
                                    <option value="Space Mono">Space Mono</option>
                                    <option value="IBM Plex Mono">IBM Plex Mono</option>
                                    <option value="JetBrains Mono">JetBrains Mono</option>
                                    <option value="custom">📁 Load Custom Font (TTF, OTF, WOFF)...</option>
                                </select>
                                <input type="file" id="customFontInput" accept=".ttf,.otf,.woff,.woff2" style="display: none;" onchange="app.loadCustomFont(this)">
                                <div style="margin-top: 8px; font-size: 11px; color: #666; line-height: 1.4;">
                                    💡 Supported formats: <strong style="color: #888;">TTF</strong> (TrueType), <strong style="color: #888;">OTF</strong> (OpenType), <strong style="color: #888;">WOFF/WOFF2</strong> (Web Fonts)
                                </div>
                            </div>
                            <div class="property-group">
                                <div class="property-label">Font Size</div>
                                <input type="range" id="textEditorSize" class="property-input" min="12" max="200" value="48" oninput="app.updateTextEditorPreview()">
                                <span id="textEditorSizeValue" style="color: #888; font-size: 12px;">48px</span>
                            </div>
                            <div class="property-group">
                                <div class="property-label">Text Color</div>
                                <input type="color" id="textEditorColor" class="property-input" value="#ffffff" onchange="app.updateTextEditorPreview()">
                            </div>
                            <div class="property-group">
                                <label class="property-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                    <input type="checkbox" id="textEditorShadow" onchange="app.toggleTextShadowControls(); app.updateTextEditorPreview();">
                                    Ombre du texte (text shadow)
                                </label>
                                <div id="textEditorShadowControls" style="display:none; margin-top:10px; padding-left:2px;">
                                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                                        <span style="font-size:11px;color:#888;width:70px;">Couleur</span>
                                        <input type="color" id="textEditorShadowColor" class="property-input" value="#000000" style="flex:1;" onchange="app.updateTextEditorPreview()">
                                    </div>
                                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                                        <span style="font-size:11px;color:#888;width:70px;">Flou</span>
                                        <input type="range" id="textEditorShadowBlur" min="0" max="40" value="4" style="flex:1;" oninput="document.getElementById('textEditorShadowBlurValue').textContent=this.value+'px';app.updateTextEditorPreview();">
                                        <span id="textEditorShadowBlurValue" style="font-size:11px;color:#888;width:38px;">4px</span>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                                        <span style="font-size:11px;color:#888;width:70px;">Décalage X</span>
                                        <input type="range" id="textEditorShadowX" min="-20" max="20" value="2" style="flex:1;" oninput="document.getElementById('textEditorShadowXValue').textContent=this.value+'px';app.updateTextEditorPreview();">
                                        <span id="textEditorShadowXValue" style="font-size:11px;color:#888;width:38px;">2px</span>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <span style="font-size:11px;color:#888;width:70px;">Décalage Y</span>
                                        <input type="range" id="textEditorShadowY" min="-20" max="20" value="2" style="flex:1;" oninput="document.getElementById('textEditorShadowYValue').textContent=this.value+'px';app.updateTextEditorPreview();">
                                        <span id="textEditorShadowYValue" style="font-size:11px;color:#888;width:38px;">2px</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="export-actions">
                            <button class="export-btn" onclick="app.closeTextEditor()">Cancel</button>
                            <button class="export-btn primary" onclick="app.applyTextChanges()">Apply</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                
                // Handle custom font selection
                document.getElementById('textEditorFont').addEventListener('change', (e) => {
                    if (e.target.value === 'custom') {
                        document.getElementById('customFontInput').click();
                    }
                });
            }

            updateTextEditorPreview() {
                const sizeInput = document.getElementById('textEditorSize');
                const sizeValue = document.getElementById('textEditorSizeValue');
                if (sizeInput && sizeValue) {
                    sizeValue.textContent = sizeInput.value + 'px';
                }
            }

            loadCustomFont(input) {
                const file = input.files[0];
                if (!file) {
                    document.getElementById('textEditorFont').value = 'Arial';
                    return;
                }
                
                const fontName = file.name.replace(/\.[^/.]+$/, '');
                const reader = new FileReader();
                
                reader.onload = (e) => {
                    const fontFace = new FontFace(fontName, `url(${e.target.result})`);
                    fontFace.load().then((loadedFont) => {
                        document.fonts.add(loadedFont);
                        
                        // Add to select options
                        const select = document.getElementById('textEditorFont');
                        const customOption = select.querySelector('option[value="custom"]');
                        const newOption = document.createElement('option');
                        newOption.value = fontName;
                        newOption.textContent = fontName + ' (Custom)';
                        select.insertBefore(newOption, customOption);
                        select.value = fontName;
                        
                        this.updateTextEditorPreview();
                        this.showStatus(`✓ Font "${fontName}" loaded`);
                    }).catch((err) => {
                        console.error('Font load error:', err);
                        this.showStatus('❌ Failed to load font');
                        document.getElementById('textEditorFont').value = 'Arial';
                    });
                };
                
                reader.readAsDataURL(file);
            }

            applyTextChanges() {
                if (!this.selectedClip || this.selectedClip.type !== 'text') return;
                
                const content = document.getElementById('textEditorContent').value;
                const font = document.getElementById('textEditorFont').value;
                const color = document.getElementById('textEditorColor').value;
                const size = document.getElementById('textEditorSize').value + 'px';
                
                this.selectedClip.content = content;
                this.selectedClip.style.fontFamily = font;
                this.selectedClip.style.color = color;
                this.selectedClip.style.fontSize = size;

                // 🅣 Ombre (optionnelle, OFF par défaut)
                const shEnabled = document.getElementById('textEditorShadow');
                const shColor = document.getElementById('textEditorShadowColor');
                const shBlur = document.getElementById('textEditorShadowBlur');
                const shX = document.getElementById('textEditorShadowX');
                const shY = document.getElementById('textEditorShadowY');
                const alpha = 0.8; // opacité constante, cohérente avec l'ancien rendu
                if (shEnabled) {
                    this.selectedClip.style.shadowEnabled = shEnabled.checked;
                    if (shColor) {
                        const hex = shColor.value;
                        const r = parseInt(hex.slice(1, 3), 16);
                        const g = parseInt(hex.slice(3, 5), 16);
                        const b = parseInt(hex.slice(5, 7), 16);
                        this.selectedClip.style.shadowColor = `rgba(${r},${g},${b},${alpha})`;
                    }
                    if (shBlur) this.selectedClip.style.shadowBlur = parseInt(shBlur.value, 10);
                    if (shX) this.selectedClip.style.shadowOffsetX = parseInt(shX.value, 10);
                    if (shY) this.selectedClip.style.shadowOffsetY = parseInt(shY.value, 10);
                }
                
                this.saveState();
                this.renderTracks();
                this.renderProperties();
                this.updatePreview();
                this.closeTextEditor();
                this.showStatus('✓ Text updated');
            }

            closeTextEditor() {
                const modal = document.getElementById('textEditorModal');
                if (modal) {
                    modal.classList.remove('show');
                }
            }

            // ============================================
            // AUDIO EXTRACTION
            // ============================================
            
            extractAudio(event, clipId) {
                event.stopPropagation();
                
                // Find clip
                let clip = null;
                for (const track of this.tracks) {
                    const found = track.clips.find(c => c.id === clipId);
                    if (found) {
                        clip = found;
                        break;
                    }
                }

                if (!clip || clip.type !== 'video') {
                    this.showStatus('Can only extract audio from video clips');
                    return;
                }

                // Find or create audio track
                let audioTrack = this.tracks.find(t => t.name.includes('AUDIO'));
                if (!audioTrack) {
                    audioTrack = this.addTrack('AUDIO 1');
                }

                // Use the original (pre-proxy) media URL so the new audio clip reads the
                // full-quality audio track from the source file instead of any downscaled
                // preview proxy. Falls back gracefully when no proxy exists.
                const media = this.mediaLibrary.find(m => m.id === clip.mediaId);
                const audioUrl = (media && media.originalUrl) ? media.originalUrl
                    : (media && media.url) ? media.url
                    : (clip.originalUrl || clip.url);

                // Create audio clip
                const audioClip = {
                    id: this.clipIdCounter++,
                    mediaId: clip.mediaId,
                    name: clip.name + ' [AUDIO]',
                    url: audioUrl,
                    type: 'audio',
                    startTime: clip.startTime,
                    duration: clip.duration,
                    sourceDuration: clip.sourceDuration,
                    sourceStart: clip.sourceStart || 0,
                    trackId: audioTrack.id
                };

                audioTrack.clips.push(audioClip);

                // Mute the video's built-in audio so we don't play / export both streams
                // simultaneously (double playback was causing clipping and crackles).
                clip.audioUnlinked = true;
                clip.audioMuted = true;

                this.saveState();
                this.renderTracks();
                this.updatePreview();
                this.showStatus(`🔓 Audio extracted → ${audioTrack.name}`);
            }

            // ============================================
            // EXPORT
            // ============================================
            
            async showExportModal() {
                // ⏸️ PAUSE PLAYBACK AUTOMATICALLY
                if (this.isPlaying) {
                    this.pause();
                    console.log('⏸️ Playback paused for export');
                }

                const modal = document.getElementById('exportModal');
                modal.classList.add('show');

                // Le moteur découle TOUJOURS du format : aucun état incohérent possible
                // (avant, on pouvait choisir « VP9+Opus » puis « MP4 » et obtenir un
                //  WebM, ou l'inverse).
                const fmt = this.selectedFormat === 'webm' ? 'webm'
                    : this.selectedFormat === 'mp3' ? 'mp3' : 'mp4';
                this.selectExportFormat(fmt);

                // Sonde réelle des codecs disponibles (H.264/AAC, VP9, Opus, LAME).
                const capabilities = await this._probeExportCapabilities();
                this._exportCapabilities = capabilities;
                this._updateGpuStatusBanner(capabilities);

                this._applyExportCapabilitiesToCards(capabilities);
                this.detectGpuInfo();
                this.updateSimpleModeDisplay();
                this._updateQualityFirstBadge();

                // Close on background click
                modal.onclick = (e) => {
                    if (e.target === modal) {
                        this.closeExportModal();
                    }
                };
            }

            /**
             * ══════════════════════════════════════════════════════════════════
             * EXPORT SIMPLIFIÉ — 3 formats, un seul chemin de code par format.
             *
             * Demande utilisateur du 2026-09-16 : « simplifier les exports en
             * proposant 3 exports principaux sans sous-parties et sans les onglets
             * complexes de la popin exporté ».
             *
             * Ce qui a été retiré : les modes AUTOMATIC / SIMPLE / ADVANCED (onglets),
             * les 5 cartes « moteur d'export » (Unifié / VP9+Opus / H.264+AAC /
             * Canvas / Natif) et l'étape « YOUR DEVICE ».
             * Ce qui remplace : 3 cartes (MP4, WEBM, MP3) + 2 listes (résolution,
             * images/seconde). Le choix du moteur n'est plus exposé : il découle du
             * format, ce qui supprime toute possibilité de fichier incohérent.
             * ══════════════════════════════════════════════════════════════════
             */

            /** Moteur associé à un format. */
            _exportEngineFor(format) {
                if (format === 'mp3') return 'mp3';
                if (format === 'webm') return 'webm-webcodecs';
                return 'webcodecs'; // mp4
            }

            /** Les formats d'export acceptés — source unique de vérité pour la validation. */
            static get EXPORT_FORMATS() { return ['mp4', 'webm', 'mp3']; }

            /**
             * Version de l'application. ⚠️ À garder synchronisée avec :
             *   • `splash-version` dans index.html
             *   • `CACHE_NAME` dans service-worker.js (cuttheflow-shell-v…)
             * Elle est inscrite dans les fichiers projet (.ctf / .json) pour pouvoir
             * diagnostiquer un fichier enregistré par une version plus ancienne.
             */
            static APP_VERSION = '3.10.1';

            /**
             * Normalise une valeur de format d'export venue d'un fichier projet ou du
             * localStorage. Tout ce qui n'est pas un format connu retombe sur `mp4`
             * (les projets d'avant la 3.10.0 pouvaient contenir `mkv`, qui n'est plus
             * proposé : on ne casse pas le chargement pour autant).
             */
            _normalizeExportFormat(value) {
                const v = String(value || '').toLowerCase();
                if (CutTheFlow.EXPORT_FORMATS.includes(v)) return v;
                if (v === 'm4a' || v === 'aac') return 'mp3';   // anciens alias audio
                if (v === 'mkv') return 'mp4';                  // conteneur retiré de l'UI
                return 'mp4';
            }

            /** Restaure le format d'export choisi lors de la dernière session. */
            _restoreSelectedFormat() {
                try {
                    const saved = localStorage.getItem('ctf_export_format');
                    if (saved) this.selectedFormat = this._normalizeExportFormat(saved);
                } catch (_) {}
            }

            /** Mémorise le format d'export choisi (survit au rechargement de page). */
            _persistSelectedFormat() {
                try { localStorage.setItem('ctf_export_format', this.selectedFormat); } catch (_) {}
            }

            /** Sélection d'un format d'export (les 3 cartes de la popin). */
            selectExportFormat(format) {
                this.selectedFormat = this._normalizeExportFormat(format);
                this.selectedEncoder = this._exportEngineFor(this.selectedFormat);
                this._persistSelectedFormat();
                document.querySelectorAll('.export-card').forEach(card => {
                    card.classList.toggle('active', card.dataset.export === this.selectedFormat);
                });
                const quick = document.getElementById('exportQuickSettings');
                if (quick) quick.style.display = this.selectedFormat === 'mp3' ? 'none' : '';
                const btn = document.getElementById('startExportBtn');
                if (btn) btn.textContent = 'EXPORT ' + this.selectedFormat.toUpperCase();
                this._buildExportSelects();
                this._refreshExportNote();
                this.updateSimpleModeDisplay();
            }

            /** Grille des résolutions disponibles + liste des cadences. */
            _buildExportSelects() {
                const resolutions = CutTheFlow.FORMAT_RESOLUTIONS[this.selectedAspectRatio]
                    || CutTheFlow.FORMAT_RESOLUTIONS['16:9'];
                const resSel = document.getElementById('exportResSelect');
                if (resSel) {
                    if (!resolutions.includes(this.selectedResolution)) {
                        const preset = CutTheFlow.FORMAT_PRESETS[this.selectedAspectRatio];
                        this.selectedResolution = preset ? `${preset.w}x${preset.h}` : resolutions[1];
                    }
                    resSel.innerHTML = resolutions.map(res => {
                        const [w, h] = res.split('x');
                        const label = CutTheFlow.FORMAT_RES_LABELS[res] || res;
                        return `<option value="${res}"${res === this.selectedResolution ? ' selected' : ''}>${w}×${h} — ${label}</option>`;
                    }).join('');
                }

                const nativeFps = this._getNativeTimelineFps();
                const fpsSel = document.getElementById('exportFpsSelect');
                if (fpsSel) {
                    const presets = [
                        { v: 'native', label: `Native (${nativeFps} fps) — recommandé` },
                        { v: '24', label: '24 fps — rendu cinéma' },
                        { v: '30', label: '30 fps — standard web' },
                        { v: '60', label: '60 fps — fluide / jeu' }
                    ];
                    const cur = String(this.selectedFps || 30);
                    const custom = !presets.some(p => p.v === cur)
                        ? [{ v: cur, label: `${cur} fps — personnalisé` }] : [];
                    fpsSel.innerHTML = [...presets, ...custom].map(p =>
                        `<option value="${p.v}"${p.v === cur || (p.v === 'native' && cur === String(nativeFps)) ? ' selected' : ''}>${p.label}</option>`
                    ).join('');
                }
            }

            /**
             * Cadence « native » = celle des vidéos du montage (détectée à l'import).
             * Évite de ré-échantillonner inutilement (30 → 30 = aucune image dupliquée).
             */
            _getNativeTimelineFps() {
                const counts = new Map();
                this.tracks.forEach(track => {
                    if (track.muted || track._effectiveMute) return;
                    track.clips.forEach(clip => {
                        if (clip.type !== 'video' || !clip.mediaId) return;
                        const media = this.mediaLibrary.find(m => m.id === clip.mediaId);
                        const fps = media && media.fps ? Math.round(media.fps) : null;
                        if (fps) counts.set(fps, (counts.get(fps) || 0) + clip.duration);
                    });
                });
                let best = 30, bestDur = -1;
                counts.forEach((dur, fps) => { if (dur > bestDur) { bestDur = dur; best = fps; } });
                return best;
            }

            setExportResolution(res) {
                if (!res || res === this.selectedResolution) return;
                this.selectResolution(res);
                this._buildExportSelects();
                this._refreshExportNote();
            }

            setExportFps(value) {
                if (value === 'native') {
                    this.selectedFps = this._getNativeTimelineFps();
                    this.updateSimpleModeDisplay();
                    this._refreshExportNote();
                    return;
                }
                const fps = Number(value);
                if (fps > 0 && fps <= 240) {
                    this.selectedFps = fps;
                    this.updateSimpleModeDisplay();
                    this._refreshExportNote();
                }
            }

            /** Phrase de récapitulatif sous les réglages. */
            _refreshExportNote() {
                const note = document.getElementById('exportNote');
                if (!note) return;
                const fmt = this.selectedFormat || 'mp4';
                const res = (this.selectedResolution || '1920x1080').replace('x', '×');
                const fps = this.selectedFps || 30;
                const cap = this._exportCapabilities || {};
                let html;

                if (fmt === 'mp3') {
                    html = `🎵 <strong>MP3 — audio seul</strong> · 48 kHz stéréo · 192 kbps (encodeur LAME, le même que ffmpeg/Audacity)<br>` +
                        `Le fichier contient exactement le mixage du montage : volumes de piste, fondus, détachement audio et bornes temporelles.`;
                } else {
                    const codecDesc = fmt === 'webm' ? 'VP9 + Opus (WebM)' : 'H.264 + AAC (MP4)';
                    html = `🎬 <strong>${codecDesc}</strong> · ${res} · ${fps} fps<br>` +
                        `Rendu <strong>hors temps réel</strong> : chaque image est extraite exactement à sa position sur la timeline, donc le son et l'image restent alignés. ` +
                        `Seul le temps de calcul varie selon la machine — jamais le fichier.`;
                }
                note.innerHTML = html;
            }

            /**
             * Active/désactive les 3 cartes selon les capacités réelles du navigateur.
             * Un format indisponible reste VISIBLE (avec la raison), pour que
             * l'utilisateur comprenne pourquoi au lieu de chercher un bouton absent.
             */
            _applyExportCapabilitiesToCards(capabilities = {}) {
                const setCard = (id, ok, reason) => {
                    const card = document.getElementById(id);
                    if (!card) return;
                    card.disabled = !ok;
                    card.title = ok ? '' : reason;
                    const desc = card.querySelector('.export-card-desc');
                    if (desc && !ok && !desc.dataset.original) {
                        desc.dataset.original = desc.textContent;
                        desc.textContent = '⚠️ ' + reason;
                    } else if (desc && ok && desc.dataset.original) {
                        desc.textContent = desc.dataset.original;
                        delete desc.dataset.original;
                    }
                };
                setCard('exportCardMp4', !!capabilities.mp4WebCodecs, 'Encodage H.264/AAC indisponible sur ce navigateur');
                setCard('exportCardWebm', !!capabilities.vp9, 'Encodage VP9 indisponible sur ce navigateur');
                setCard('exportCardMp3', typeof lamejs !== 'undefined' && !!lamejs.Mp3Encoder, 'Encodeur MP3 (lamejs) non chargé');

                // Si le format courant n'est pas disponible, on bascule sur un autre
                // plutôt que de laisser l'utilisateur cliquer sur EXPORT et échouer.
                const current = document.getElementById('exportCard' + (
                    this.selectedFormat === 'webm' ? 'Webm' :
                    this.selectedFormat === 'mp3' ? 'Mp3' : 'Mp4'));
                if (current && current.disabled) {
                    const fallback = ['exportCardMp4', 'exportCardWebm', 'exportCardMp3']
                        .map(id => document.getElementById(id))
                        .find(c => c && !c.disabled);
                    if (fallback) this.selectExportFormat(fallback.dataset.export);
                }
            }

            /** Conservé pour compatibilité — les onglets de mode n'existent plus. */
            switchExportMode() {
                /* Les modes AUTOMATIC / SIMPLE / ADVANCED ont été supprimés le
                   2026-09-16 : la popin d'export ne comporte plus qu'une seule vue. */
                this.exportMode = 'simple';
            }
            
            updateAutomaticModeDisplay() {
                // Les onglets de mode ont été supprimés : plus rien à afficher.
            }

            updateSimpleModeDisplay() {
                // Les anciennes pastilles « Simple mode » ont été supprimées avec les
                // onglets ; on garde la fonction (appelée à plusieurs endroits) et on
                // rafraîchit ce qui existe encore dans la popin.
                this._refreshExportNote();
            }

            _updateQualityFirstBadge() {
                const badge = document.getElementById('qualityFirstBadge');
                if (!badge) return;
                // Hide badge if WebCodecs is selected (it has its own engine, quality-first
                // only applies to MediaRecorder/transmux paths via startExport)
                const isWebCodecs = this.selectedEncoder === 'webcodecs';
                if (this.prefs.exportQualityFirst && !isWebCodecs) {
                    badge.style.display = 'block';
                } else if (this.prefs.exportQualityFirst && isWebCodecs) {
                    badge.style.display = 'block';
                    badge.style.background = '#3a2a1a';
                    badge.style.borderColor = '#5a4a2a';
                    badge.style.color = '#fa0';
                    badge.textContent = '⚠️ QUALITY-FIRST — WebCodecs a son propre moteur, mode standard appliqué';
                } else {
                    badge.style.display = 'none';
                    // Reset styling for next time
                    badge.style.background = '#1a3a1a';
                    badge.style.borderColor = '#2a5a2a';
                    badge.style.color = '#4f4';
                    badge.textContent = '🔒 QUALITY-FIRST MODE — Export lent mais parfait, chaque frame garantie';
                }
            }

            detectGpuInfo() {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                // Always release the probe context when leaving this method (free VRAM).
                const releaseProbe = () => {
                    try { gl && gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch(e) {}
                };

                if (gl) {
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    let renderer = 'Unknown';
                    let vendor = 'Unknown';
                    
                    if (debugInfo) {
                        renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                        vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
                    } else {
                        renderer = gl.getParameter(gl.RENDERER);
                        vendor = gl.getParameter(gl.VENDOR);
                    }
                    
                    console.log('🎮 GPU Detected:');
                    console.log(`   Renderer: ${renderer}`);
                    console.log(`   Vendor: ${vendor}`);
                    console.log(`   WebGL Version: ${gl instanceof WebGL2RenderingContext ? '2.0' : '1.0'}`);
                    
                    // Detect hardware type and suggest optimal settings
                    const hardwareProfile = this.getHardwareProfile(renderer, vendor);
                    this.currentHardwareProfile = hardwareProfile;
                    
                    console.log('💻 Hardware Profile:', hardwareProfile);
                    
                    // Update GPU description in the UI with recommendations
                    const gpuDesc = document.querySelector('.gpu-desc');
                    if (gpuDesc && renderer !== 'Unknown') {
                        let simpleName = renderer.replace(/ANGLE \(|\)|Direct3D11 vs_5_0 ps_5_0|OpenGL/gi, '').trim();
                        if (simpleName.length > 50) {
                            simpleName = simpleName.substring(0, 47) + '...';
                        }
                        gpuDesc.textContent = simpleName || 'Use graphics card for faster rendering';
                    }
                    
                    // 🧹 La bannière « réglages recommandés pour votre appareil » a été
                    //    retirée avec l'étape « YOUR DEVICE » de l'ancienne popin : la
                    //    popin d'export ne comporte plus qu'une seule vue (3 cartes).
                    //    Le profil matériel reste calculé et disponible pour
                    //    applyRecommendedSettings() et pour le bandeau GPU.
                    releaseProbe();
                } else {
                    console.warn('⚠️ WebGL not supported on this device');
                    const gpuDesc = document.querySelector('.gpu-desc');
                    if (gpuDesc) {
                        gpuDesc.textContent = 'WebGL not available - will use CPU';
                    }
                    this.currentHardwareProfile = { type: 'cpu', tier: 'low' };
                    releaseProbe();
                }
            }

            getHardwareProfile(renderer, vendor) {
                const r = renderer.toLowerCase();
                const v = vendor.toLowerCase();
                
                // Apple Silicon (M1, M2, M3)
                if (r.includes('apple') || r.includes('m1') || r.includes('m2') || r.includes('m3')) {
                    if (r.includes('m3')) {
                        return { type: 'apple', model: 'M3', tier: 'ultra', maxRes: '8K', recommendedFps: 60 };
                    } else if (r.includes('m2')) {
                        return { type: 'apple', model: 'M2', tier: 'high', maxRes: '4K', recommendedFps: 60 };
                    } else if (r.includes('m1')) {
                        return { type: 'apple', model: 'M1', tier: 'high', maxRes: '4K', recommendedFps: 60 };
                    }
                    return { type: 'apple', model: 'Silicon', tier: 'high', maxRes: '4K', recommendedFps: 60 };
                }
                
                // Mac Intel (old Macs with Intel GPU/CPU)
                const isMac = /Mac|Macintosh/.test(navigator.userAgent);
                if (isMac && r.includes('intel')) {
                    // Intel Iris Plus (MacBook Pro 13" 2016-2020)
                    if (r.includes('iris plus') || r.includes('iris pro')) {
                        return { type: 'mac-intel', model: 'Iris Plus', tier: 'medium', maxRes: '1080p', recommendedFps: 30 };
                    }
                    // Intel Iris (MacBook Air, Mac mini)
                    if (r.includes('iris')) {
                        return { type: 'mac-intel', model: 'Iris', tier: 'low', maxRes: '1080p', recommendedFps: 24 };
                    }
                    // Intel HD Graphics (older Macs)
                    if (r.includes('hd') || r.includes('hd graphics')) {
                        return { type: 'mac-intel', model: 'HD Graphics', tier: 'low', maxRes: '720p', recommendedFps: 24 };
                    }
                    // Generic Intel Mac
                    return { type: 'mac-intel', model: 'Intel', tier: 'low', maxRes: '1080p', recommendedFps: 24 };
                }
                
                // Mac with discrete AMD GPU (iMac Pro, MacBook Pro 15"/16" 2016-2019)
                if (isMac && (r.includes('amd') || r.includes('radeon'))) {
                    if (r.includes('pro 5') || r.includes('pro vega')) {
                        return { type: 'mac-intel', model: 'Radeon Pro', tier: 'high', maxRes: '4K', recommendedFps: 30 };
                    }
                    return { type: 'mac-intel', model: 'Radeon', tier: 'medium', maxRes: '1440p', recommendedFps: 30 };
                }
                
                // NVIDIA GPUs
                if (r.includes('nvidia') || r.includes('geforce') || r.includes('rtx') || r.includes('gtx') || r.includes('quadro')) {
                    // RTX 40 series
                    if (r.includes('rtx 40') || r.includes('4090') || r.includes('4080') || r.includes('4070')) {
                        return { type: 'nvidia', model: 'RTX 40xx', tier: 'ultra', maxRes: '8K', recommendedFps: 60 };
                    }
                    // RTX 30 series
                    if (r.includes('rtx 30') || r.includes('3090') || r.includes('3080') || r.includes('3070') || r.includes('3060')) {
                        return { type: 'nvidia', model: 'RTX 30xx', tier: 'ultra', maxRes: '4K', recommendedFps: 60 };
                    }
                    // RTX 20 series
                    if (r.includes('rtx 20') || r.includes('2080') || r.includes('2070') || r.includes('2060')) {
                        return { type: 'nvidia', model: 'RTX 20xx', tier: 'high', maxRes: '4K', recommendedFps: 30 };
                    }
                    // GTX 16 series
                    if (r.includes('gtx 16') || r.includes('1660') || r.includes('1650')) {
                        return { type: 'nvidia', model: 'GTX 16xx', tier: 'medium', maxRes: '1440p', recommendedFps: 30 };
                    }
                    // GTX 10 series
                    if (r.includes('gtx 10') || r.includes('1080') || r.includes('1070') || r.includes('1060')) {
                        return { type: 'nvidia', model: 'GTX 10xx', tier: 'medium', maxRes: '1440p', recommendedFps: 30 };
                    }
                    return { type: 'nvidia', model: 'Generic', tier: 'medium', maxRes: '1080p', recommendedFps: 30 };
                }
                
                // AMD GPUs
                if (r.includes('amd') || r.includes('radeon') || r.includes('rx ')) {
                    // RX 7000 series
                    if (r.includes('rx 7') || r.includes('7900') || r.includes('7800') || r.includes('7700')) {
                        return { type: 'amd', model: 'RX 7xxx', tier: 'ultra', maxRes: '4K', recommendedFps: 60 };
                    }
                    // RX 6000 series
                    if (r.includes('rx 6') || r.includes('6900') || r.includes('6800') || r.includes('6700') || r.includes('6600')) {
                        return { type: 'amd', model: 'RX 6xxx', tier: 'high', maxRes: '4K', recommendedFps: 30 };
                    }
                    // RX 5000 series
                    if (r.includes('rx 5') || r.includes('5700') || r.includes('5600') || r.includes('5500')) {
                        return { type: 'amd', model: 'RX 5xxx', tier: 'medium', maxRes: '1440p', recommendedFps: 30 };
                    }
                    return { type: 'amd', model: 'Generic', tier: 'medium', maxRes: '1080p', recommendedFps: 30 };
                }
                
                // Intel GPUs
                if (r.includes('intel')) {
                    // Arc series
                    if (r.includes('arc')) {
                        return { type: 'intel', model: 'Arc', tier: 'medium', maxRes: '1440p', recommendedFps: 30 };
                    }
                    // Iris Xe
                    if (r.includes('iris xe')) {
                        return { type: 'intel', model: 'Iris Xe', tier: 'medium', maxRes: '1080p', recommendedFps: 30 };
                    }
                    // UHD Graphics
                    if (r.includes('uhd')) {
                        return { type: 'intel', model: 'UHD', tier: 'low', maxRes: '1080p', recommendedFps: 24 };
                    }
                    // HD Graphics
                    return { type: 'intel', model: 'HD', tier: 'low', maxRes: '720p', recommendedFps: 24 };
                }
                
                // Generic/Unknown
                return { type: 'generic', model: 'Unknown', tier: 'medium', maxRes: '1080p', recommendedFps: 30 };
            }

            showHardwareRecommendations(profile) {
                // Find or create recommendations banner
                let banner = document.getElementById('hardwareRecommendations');
                if (!banner) {
                    banner = document.createElement('div');
                    banner.id = 'hardwareRecommendations';
                    banner.className = 'hardware-banner';
                    
                    const exportModal = document.querySelector('#exportModal .modal-content');
                    if (exportModal) {
                        exportModal.insertBefore(banner, exportModal.firstChild.nextSibling);
                    }
                }
                
                // Détection Mac/PC
                const isMac = /Mac|Macintosh|MacIntel|MacPPC|Mac68K/.test(navigator.userAgent) || 
                              /Mac/.test(navigator.platform) || 
                              navigator.platform === 'MacIntel';
                const platformName = isMac ? '🍎 Mac' : '🖥️ PC';
                
                // Build recommendation message
                let deviceName = '';
                let recommendation = '';
                let chipClass = '';
                
                if (profile.type === 'apple') {
                    deviceName = `Apple ${profile.model}`;
                    recommendation = `Optimized for ${profile.maxRes} @ ${profile.recommendedFps}fps`;
                    chipClass = 'chip-apple';
                } else if (profile.type === 'mac-intel') {
                    deviceName = `Mac Intel ${profile.model}`;
                    recommendation = `Recommended: ${profile.maxRes} @ ${profile.recommendedFps}fps`;
                    chipClass = 'chip-intel';
                } else if (profile.type === 'nvidia') {
                    deviceName = `NVIDIA ${profile.model}`;
                    recommendation = `Best: ${profile.maxRes} @ ${profile.recommendedFps}fps`;
                    chipClass = 'chip-nvidia';
                } else if (profile.type === 'amd') {
                    deviceName = `AMD ${profile.model}`;
                    recommendation = `Best: ${profile.maxRes} @ ${profile.recommendedFps}fps`;
                    chipClass = 'chip-amd';
                } else if (profile.type === 'intel') {
                    deviceName = `Intel ${profile.model}`;
                    recommendation = `Recommended: ${profile.maxRes} @ ${profile.recommendedFps}fps`;
                    chipClass = 'chip-intel';
                } else {
                    deviceName = 'Generic GPU';
                    recommendation = `Safe: ${profile.maxRes} @ ${profile.recommendedFps}fps`;
                    chipClass = 'chip-generic';
                }
                
                banner.innerHTML = `
                    <div class="hardware-banner-content">
                        <div class="hardware-chip ${chipClass}"></div>
                        <div class="hardware-info">
                            <div class="hardware-platform">${platformName}</div>
                            <div class="hardware-device">${deviceName}</div>
                            <div class="hardware-recommendation">${recommendation}</div>
                        </div>
                        <button class="hardware-apply-btn" onclick="app.applyRecommendedSettings()">Apply Settings</button>
                    </div>
                `;
            }

            applyRecommendedSettings() {
                if (!this.currentHardwareProfile) return;
                
                const profile = this.currentHardwareProfile;
                
                // Apply resolution
                const resMap = {
                    '8K': '7680x4320',
                    '4K': '3840x2160',
                    '1440p': '2560x1440',
                    '1080p': '1920x1080',
                    '720p': '1280x720'
                };
                
                const recommendedRes = resMap[profile.maxRes] || '1920x1080';
                this.selectResolution(recommendedRes);
                
                // Apply FPS
                this.selectFps(profile.recommendedFps);
                
                // Apply format (MP4 by default)
                this.selectFormat('mp4');
                
                // Enable GPU acceleration for high/ultra tier (preview + export),
                // disable for low tier. toggleGpuAcceleration() now drives both prefs
                // in lockstep, so a single call is enough.
                if (profile.tier === 'high' || profile.tier === 'ultra') {
                    if (!this.useGpuAcceleration || !this.useGpuExport) {
                        if (!this.useGpuAcceleration) this.toggleGpuAcceleration();
                        // Make sure export flag follows even if preview was already on.
                        if (!this.useGpuExport) {
                            this.useGpuExport = true;
                            this.prefs.gpuExport = true;
                            this._savePrefs();
                        }
                    }
                } else if (profile.tier === 'low') {
                    if (this.useGpuAcceleration || this.useGpuExport) {
                        if (this.useGpuAcceleration) this.toggleGpuAcceleration();
                        if (this.useGpuExport) {
                            this.useGpuExport = false;
                            this.prefs.gpuExport = false;
                            this._savePrefs();
                        }
                    }
                }
                
                console.log(`✅ Applied recommended settings for ${profile.type} ${profile.model}`);
                this.showStatus(`✅ Settings optimized for your ${profile.type === 'apple' ? 'Apple ' : ''}${profile.model}`);
                
                // Update simple mode display
                this.updateSimpleModeDisplay();
            }

            async _probeExportCapabilities() {
                const canRecord = typeof MediaRecorder !== 'undefined' &&
                    typeof HTMLCanvasElement !== 'undefined' &&
                    typeof HTMLCanvasElement.prototype.captureStream === 'function';
                const supportsMime = mime => canRecord && MediaRecorder.isTypeSupported(mime);
                const webmRecorder = [
                    'video/webm;codecs=vp9,opus',
                    'video/webm;codecs=vp8,opus',
                    'video/webm'
                ].some(supportsMime);
                const mp4Recorder = [
                    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
                    'video/mp4;codecs=avc1.42E01E',
                    'video/mp4'
                ].some(supportsMime);

                let h264 = false;
                let aac = false;
                const [width, height] = (this.selectedResolution || '1280x720').split('x').map(Number);
                const fps = Number(this.selectedFps) || 30;
                if (typeof VideoEncoder !== 'undefined' && typeof VideoEncoder.isConfigSupported === 'function') {
                    const codecs = width * height >= 1920 * 1080
                        ? ['avc1.640028', 'avc1.4D4028', 'avc1.42E028']
                        : ['avc1.42E01F', 'avc1.4D401F', 'avc1.42E01E'];
                    for (const codec of codecs) {
                        try {
                            const result = await VideoEncoder.isConfigSupported({
                                codec, width, height, framerate: fps, bitrate: 8_000_000,
                                hardwareAcceleration: this.useGpuExport ? 'prefer-hardware' : 'prefer-software'
                            });
                            if (result.supported) { h264 = true; break; }
                        } catch (_) {}
                    }
                }
                if (typeof AudioEncoder !== 'undefined' && typeof AudioEncoder.isConfigSupported === 'function') {
                    try {
                        const result = await AudioEncoder.isConfigSupported({
                            codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000
                        });
                        aac = !!result.supported;
                    } catch (_) {}
                }

                // 🎬 VP9 (moteur WebM offline). Sonde SANS forcer le matériel :
                // demander 'prefer-hardware' pour VP9 renvoie « non supporté » sur la
                // quasi-totalité des machines (pas d'encodeur VP9 matériel) et faisait
                // croire que le moteur VP9 n'existait pas → tout export WebM basculait
                // sur la capture temps réel (source du ralenti). Audit 2026-09-10.
                let vp9 = false;
                if (typeof VideoEncoder !== 'undefined' && typeof VideoEncoder.isConfigSupported === 'function') {
                    for (const codec of ['vp09.00.31.08', 'vp09.00.21.08', 'vp09.00.10.08']) {
                        try {
                            const result = await VideoEncoder.isConfigSupported({
                                codec, width, height, framerate: fps, bitrate: 8_000_000, latencyMode: 'quality'
                            });
                            if (result.supported) { vp9 = true; break; }
                        } catch (_) {}
                    }
                }

                return { webmRecorder, mp4Recorder, h264, aac, vp9, mp4WebCodecs: h264 && aac && typeof MP4Box !== 'undefined' };
            }

            _updateGpuStatusBanner(capabilities = this._exportCapabilities || {}) {
                const banner = document.getElementById('gpuStatusBanner');
                const icon = document.getElementById('gpuStatusIcon');
                const text = document.getElementById('gpuStatusText');
                const toggle = document.getElementById('gpuQuickToggle');
                if (!banner || !icon || !text) return;
                
                banner.style.display = 'flex';
                banner.style.background = this.useGpuExport ? '#13271d' : '#202024';
                banner.style.border = `1px solid ${this.useGpuExport ? '#26a269' : '#555'}`;
                banner.style.color = '#fff';
                icon.textContent = this.useGpuExport ? '⚡' : '💻';
                const formats = [capabilities.mp4WebCodecs || capabilities.mp4Recorder ? 'MP4 ✓' : 'MP4 ✕', capabilities.webmRecorder ? 'WebM ✓' : 'WebM ✕'].join(' · ');
                text.textContent = `GPU ${this.useGpuExport ? 'ACTIVÉ' : 'DÉSACTIVÉ'} · ${formats}`;
                if (toggle) toggle.textContent = this.useGpuExport ? 'DÉSACTIVER' : 'ACTIVER';
            }

            closeExportModal() {
                const modal = document.getElementById('exportModal');
                modal.classList.remove('show');
                
                // Reset export state
                document.getElementById('exportProgress').style.display = 'none';
                document.getElementById('startExportBtn').disabled = false;
                
                const fill = document.getElementById('exportProgressFill');
                if (fill) fill.style.width = '0%';
                
                const status = document.getElementById('exportStatus');
                if (status) status.textContent = '';
            }

            selectResolution(resolution) {
                this.selectedResolution = resolution;
                document.querySelectorAll('[data-resolution]').forEach(el => {
                    el.classList.toggle('selected', el.dataset.resolution === resolution);
                });
                this.updateSimpleModeDisplay();
            }

            // ============================================
            // FORMAT PRESET (ASPECT RATIO)
            // ============================================
            
            // Mapping of aspect ratio presets to their default resolutions
            static FORMAT_PRESETS = {
                '16:9':  { w: 1920, h: 1080, label: '1920×1080', css: '16 / 9',  desc: 'Paysage (YouTube, TV)' },
                '9:16':  { w: 1080, h: 1920, label: '1080×1920', css: '9 / 16',  desc: 'Portrait (TikTok, Reels)' },
                '1:1':   { w: 1080, h: 1080, label: '1080×1080', css: '1 / 1',   desc: 'Carré (Instagram)' },
                '4:5':   { w: 1080, h: 1350, label: '1080×1350', css: '4 / 5',   desc: 'Portrait (Instagram Post)' },
                '4:3':   { w: 1440, h: 1080, label: '1440×1080', css: '4 / 3',   desc: 'Classique 4:3' },
                '21:9':  { w: 2560, h: 1080, label: '2560×1080', css: '21 / 9',  desc: 'Cinéma Ultra-large' }
            };

            // Resolution options per aspect ratio (for the export modal)
            /**
             * 🥇 Fournisseurs IA + métadonnées d'interface (2026-09-16).
             * L'ordre ci-dessous = l'ordre d'affichage : DeepSeek 4.1 Flash d'abord
             * (le meilleur rapport vitesse/qualité/prix pour des actions de montage
             * en JSON, avec 1 M de contexte et la vision).
             * Les modèles sont exposés dans index.html (optgroups) — garder les deux
             * listes synchronisées.
             */
            static AI_PROVIDERS = {
                deepseek: {
                    label: 'DeepSeek',
                    keyPage: 'https://platform.deepseek.com/api_keys',
                    keyHint: 'platform.deepseek.com (offre gratuite à l\'inscription)',
                    keyPlaceholder: 'sk-...'
                },
                openrouter: {
                    label: 'OpenRouter',
                    keyPage: 'https://openrouter.ai/keys',
                    keyHint: 'openrouter.ai/keys — modèles « :free » sans frais',
                    keyPlaceholder: 'sk-or-...'
                },
                groq: {
                    label: 'Groq',
                    keyPage: 'https://console.groq.com/keys',
                    keyHint: 'console.groq.com/keys — très rapide, quota gratuit limité',
                    keyPlaceholder: 'gsk_...'
                },
                openai: {
                    label: 'OpenAI',
                    keyPage: 'https://platform.openai.com/api-keys',
                    keyHint: 'platform.openai.com/api-keys',
                    keyPlaceholder: 'sk-...'
                },
                anthropic: {
                    label: 'Anthropic',
                    keyPage: 'https://console.anthropic.com/settings/keys',
                    keyHint: 'console.anthropic.com → API keys',
                    keyPlaceholder: 'sk-ant-...'
                },
                google: {
                    label: 'Google',
                    keyPage: 'https://aistudio.google.com/app/apikey',
                    keyHint: 'aistudio.google.com/app/apikey (offre gratuite)',
                    keyPlaceholder: 'AIza...'
                }
            };

            /** Endpoints OpenAI-compatibles (chat/completions). */
            static AI_OPENAI_COMPATIBLE = {
                deepseek: 'https://api.deepseek.com/v1/chat/completions',
                openrouter: 'https://openrouter.ai/api/v1/chat/completions',
                groq: 'https://api.groq.com/openai/v1/chat/completions',
                openai: 'https://api.openai.com/v1/chat/completions'
            };

            static FORMAT_RESOLUTIONS = {
                '16:9':  ['1280x720', '1920x1080', '2560x1440', '3840x2160', '7680x4320'],
                '9:16':  ['720x1280', '1080x1920', '1440x2560', '2160x3840'],
                '1:1':   ['720x720', '1080x1080', '1440x1440', '2160x2160'],
                '4:5':   ['864x1080', '1080x1350', '1728x2160'],
                '4:3':   ['960x720', '1440x1080', '1920x1440', '2880x2160'],
                '21:9':  ['1720x720', '2560x1080', '3440x1440', '5120x2160']
            };

            static FORMAT_RES_LABELS = {
                '1280x720': 'HD 720p',
                '1920x1080': 'Full HD 1080p',
                '2560x1440': 'QHD 1440p',
                '3840x2160': '4K UHD',
                '7680x4320': '8K',
                '720x1280': 'HD 720p',
                '1080x1920': 'Full HD 1080p',
                '1440x2560': 'QHD 1440p',
                '2160x3840': '4K UHD',
                '720x720': 'HD 720p',
                '1080x1080': 'Full HD 1080p',
                '1440x1440': 'QHD 1440p',
                '2160x2160': '4K UHD',
                '864x1080': 'HD',
                '1080x1350': 'Full HD',
                '1728x2160': '4K',
                '960x720': 'HD',
                '1440x1080': 'Full HD',
                '1920x1440': 'QHD',
                '2880x2160': '4K',
                '1720x720': 'HD',
                '2560x1080': 'Full HD',
                '3440x1440': 'QHD',
                '5120x2160': '4K'
            };

            setFormatPreset(preset) {
                if (!CutTheFlow.FORMAT_PRESETS[preset]) return;
                
                this.selectedAspectRatio = preset;
                const fmt = CutTheFlow.FORMAT_PRESETS[preset];
                
                // Update default resolution to match aspect ratio
                this.selectedResolution = `${fmt.w}x${fmt.h}`;
                
                // Update dropdown menu items
                document.querySelectorAll('.format-menu-item').forEach(item => {
                    item.classList.toggle('selected', item.dataset.preset === preset);
                });
                
                // Update trigger button label & icon
                const triggerLabel = document.getElementById('formatTriggerLabel');
                if (triggerLabel) triggerLabel.textContent = preset;
                
                const triggerIcon = document.getElementById('formatTriggerIcon');
                if (triggerIcon) triggerIcon.dataset.aspect = preset;
                
                // Update resolution info in dropdown footer
                const info = document.getElementById('formatPresetInfo');
                if (info) info.textContent = fmt.label;
                
                // Update preview wrapper aspect ratio with smooth transition
                const wrapper = document.getElementById('previewWrapper');
                if (wrapper) {
                    wrapper.dataset.aspect = preset;
                }
                
                // Close the dropdown
                this.closeFormatDropdown();
                
                // Update resolution options in export modal
                this.updateExportResolutionOptions();
                
                // Update export display
                this.updateSimpleModeDisplay();
                
                console.log(`📐 Format preset: ${preset} (${fmt.label}) — ${fmt.desc}`);
            }

            toggleFormatDropdown() {
                const dropdown = document.getElementById('formatDropdown');
                if (!dropdown) return;
                const isOpen = dropdown.classList.toggle('open');
                
                // Close on outside click
                if (isOpen) {
                    const closeHandler = (e) => {
                        if (!dropdown.contains(e.target)) {
                            dropdown.classList.remove('open');
                            document.removeEventListener('click', closeHandler);
                        }
                    };
                    // Defer so the current click doesn't immediately close it
                    setTimeout(() => document.addEventListener('click', closeHandler), 0);
                }
            }

            closeFormatDropdown() {
                const dropdown = document.getElementById('formatDropdown');
                if (dropdown) dropdown.classList.remove('open');
            }

            // ============================================
            // CLIP EFFECTS (FX) SYSTEM
            // ============================================

            toggleFxPanel() {
                const panel = document.getElementById('fxPanel');
                const btn = document.getElementById('fxTriggerBtn');
                if (!panel) return;

                const isOpen = panel.style.display === 'none' || panel.style.display === '';
                panel.style.display = isOpen ? 'block' : 'none';
                if (btn) btn.classList.toggle('active', isOpen);

                if (isOpen) {
                    // Close other panels (Anim / Fade) when opening FX
                    const animPanel = document.getElementById('animPanel');
                    if (animPanel) animPanel.style.display = 'none';
                    document.getElementById('animTriggerBtn')?.classList.remove('active');
                    this.updateFxDropdownState();
                }
            }

            // Legacy alias
            toggleFxDropdown() { this.toggleFxPanel(); }

            // ============================================
            // 🎬 ANIMATION PANEL
            // ============================================
            toggleAnimPanel() {
                const panel = document.getElementById('animPanel');
                const btn = document.getElementById('animTriggerBtn');
                if (!panel) return;
                const opening = panel.style.display === 'none' || panel.style.display === '';
                // Close sibling panels for clarity (only one open at a time).
                const fxPanel = document.getElementById('fxPanel');
                if (fxPanel) fxPanel.style.display = 'none';
                document.getElementById('fxTriggerBtn')?.classList.remove('active');
                const fadePanel = document.getElementById('fadePanel');
                if (fadePanel) fadePanel.style.display = 'none';
                document.getElementById('fadeTriggerBtn')?.classList.remove('active');
                panel.style.display = opening ? 'block' : 'none';
                if (btn) btn.classList.toggle('active', opening);
                if (opening) this.updateAnimPanelState();
            }

            updateAnimPanelState() {
                const clip = this.selectedClip;
                const label = document.getElementById('animActiveLabel');
                const slider = document.getElementById('animDurationSlider');
                const valLabel = document.getElementById('animDurationVal');
                const intSlider = document.getElementById('animIntensitySlider');
                const intLabel = document.getElementById('animIntensityVal');
                const items = document.querySelectorAll('#animGrid .anim-item');

                const preset = (clip && clip.animation && clip.animation.preset) || 'none';
                const dur    = (clip && clip.animation && clip.animation.duration != null) ? clip.animation.duration : 0.6;
                const inten  = (clip && clip.animation && clip.animation.intensity != null) ? clip.animation.intensity : 100;

                if (slider)    slider.value = dur;
                if (valLabel)  valLabel.textContent = Number(dur).toFixed(1) + 's';
                if (intSlider) intSlider.value = inten;
                if (intLabel)  intLabel.textContent = Math.round(inten) + '%';

                items.forEach(el => el.classList.toggle('active', el.dataset.anim === preset));

                if (label) {
                    if (!clip) {
                        label.textContent = 'Select a clip first';
                    } else if (preset === 'none') {
                        label.textContent = 'No animation';
                    } else {
                        label.textContent = preset.toUpperCase().replace('-', ' ') + ' — ' + Number(dur).toFixed(1) + 's · ' + Math.round(inten) + '%';
                    }
                }
            }

            applyClipAnimation(name) {
                if (!this.selectedClip) {
                    this.showStatus('Sélectionne un clip d\'abord', 'warning');
                    return;
                }
                const clip = this.selectedClip;
                if (name === 'none') {
                    delete clip.animation;
                } else {
                    if (!clip.animation) clip.animation = { duration: 0.6, intensity: 100 };
                    clip.animation.preset = name;
                    if (clip.animation.duration  == null) clip.animation.duration  = 0.6;
                    if (clip.animation.intensity == null) clip.animation.intensity = 100;
                }
                // Force the FX cache key to invalidate so the next preview frame redraws.
                this._lastFxKey = null;
                this.updateAnimPanelState();
                this.saveState();
                this.updatePreview();
                this.renderTracks();
                this.showStatus(`Animation: ${name.toUpperCase()}`, 'success');
            }

            setAnimDuration(value) {
                if (!this.selectedClip) return;
                const v = Math.max(0.1, Math.min(3, parseFloat(value) || 0.6));
                if (!this.selectedClip.animation) this.selectedClip.animation = { preset: 'fade-in', intensity: 100 };
                this.selectedClip.animation.duration = v;
                const valLabel = document.getElementById('animDurationVal');
                if (valLabel) valLabel.textContent = v.toFixed(1) + 's';
                this.updateAnimPanelState();
                this.updatePreview();
                this._scheduleSaveState();
            }

            setAnimIntensity(value) {
                if (!this.selectedClip) return;
                const v = Math.max(0, Math.min(200, parseFloat(value) || 100));
                if (!this.selectedClip.animation) this.selectedClip.animation = { preset: 'fade-in', duration: 0.6 };
                this.selectedClip.animation.intensity = v;
                const intLabel = document.getElementById('animIntensityVal');
                if (intLabel) intLabel.textContent = Math.round(v) + '%';
                this.updateAnimPanelState();
                this.updatePreview();
                this._scheduleSaveState();
            }

            // ============================================
            //   FADE / TRANSITION PANEL
            // ============================================
            toggleFadePanel() {
                const panel = document.getElementById('fadePanel');
                const btn   = document.getElementById('fadeTriggerBtn');
                if (!panel) return;
                const opening = panel.style.display === 'none' || panel.style.display === '';
                // Close other panels
                const fxPanel = document.getElementById('fxPanel');
                if (fxPanel) fxPanel.style.display = 'none';
                document.getElementById('fxTriggerBtn')?.classList.remove('active');
                const animPanel = document.getElementById('animPanel');
                if (animPanel) animPanel.style.display = 'none';
                document.getElementById('animTriggerBtn')?.classList.remove('active');
                panel.style.display = opening ? 'block' : 'none';
                if (btn) btn.classList.toggle('active', opening);
                if (opening) this.updateFadePanel();
            }

            updateFadePanel() {
                const clip = this.selectedClip;
                const fi  = clip ? (clip.fadeIn  || 0) : 0;
                const fo  = clip ? (clip.fadeOut || 0) : 0;
                const dur = clip ? clip.duration : 0;

                // Label
                const label = document.getElementById('fadePanelClipLabel');
                if (label) label.textContent = clip ? clip.name : 'Select a clip first';

                // Slider values
                const slIn  = document.getElementById('fadePanelIn');
                const slOut = document.getElementById('fadePanelOut');
                const vlIn  = document.getElementById('fadePanelInVal');
                const vlOut = document.getElementById('fadePanelOutVal');
                if (slIn)  slIn.value  = fi;
                if (slOut) slOut.value = fo;
                if (vlIn)  vlIn.textContent  = fi.toFixed(1)  + 's';
                if (vlOut) vlOut.textContent = fo.toFixed(1) + 's';

                // Active preset highlight
                const hasIn  = fi  > 0;
                const hasOut = fo > 0;
                let activePreset = 'none';
                if (hasIn && hasOut) activePreset = 'inout';
                else if (hasIn)      activePreset = 'in';
                else if (hasOut)     activePreset = 'out';
                document.querySelectorAll('.fade-preset-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.preset === activePreset);
                });

                // Envelope SVG
                this._drawFadeEnvelope(fi, fo, dur);
            }

            _drawFadeEnvelope(fi, fo, dur) {
                const W = 300, H = 36, mid = 18;
                const line = document.getElementById('fadeEnvelopeLine');
                const fill = document.getElementById('fadeEnvelopeFill');
                if (!line || !fill) return;
                const disp = dur > 0 ? dur : 5; // display window in seconds
                const xIn  = dur > 0 ? Math.min((fi  / disp) * W, W * 0.48) : 0;
                const xOut = dur > 0 ? Math.max(W - (fo / disp) * W, W * 0.52) : W;
                // Build polyline: ramp up from (0,H) to (xIn,mid), flat to (xOut,mid), ramp down to (W,H)
                const pts = `0,${H} ${xIn},${mid} ${xOut},${mid} ${W},${H}`;
                line.setAttribute('points', pts);
                fill.setAttribute('points', pts);
            }

            applyFadePreset(preset) {
                if (!this.selectedClip) return;
                const dur = this.selectedClip.duration || 4;
                const t   = Math.min(1.0, dur / 3); // default 1/3 of clip, max 1s
                const DEFAULT_IN  = parseFloat(Math.min(t, 1.0).toFixed(1));
                const DEFAULT_OUT = parseFloat(Math.min(t, 1.0).toFixed(1));
                switch (preset) {
                    case 'none':
                        this.selectedClip.fadeIn  = 0;
                        this.selectedClip.fadeOut = 0;
                        break;
                    case 'in':
                        this.selectedClip.fadeIn  = DEFAULT_IN;
                        this.selectedClip.fadeOut = 0;
                        break;
                    case 'out':
                        this.selectedClip.fadeIn  = 0;
                        this.selectedClip.fadeOut = DEFAULT_OUT;
                        break;
                    case 'inout':
                        this.selectedClip.fadeIn  = DEFAULT_IN;
                        this.selectedClip.fadeOut = DEFAULT_OUT;
                        break;
                }
                this.saveState();
                this.updateFadePanel();
                this.updatePreview();
                // Sync properties panel sliders if visible
                this.renderProperties();
            }

            setFadePanelIn(val) {
                if (!this.selectedClip) return;
                this.selectedClip.fadeIn = val;
                const v = document.getElementById('fadePanelInVal');
                if (v) v.textContent = val.toFixed(1) + 's';
                this._scheduleSaveState();
                this.updatePreview();
                this._drawFadeEnvelope(val, this.selectedClip.fadeOut || 0, this.selectedClip.duration);
                this._syncFadePresetHighlight();
                this.renderProperties();
            }

            setFadePanelOut(val) {
                if (!this.selectedClip) return;
                this.selectedClip.fadeOut = val;
                const v = document.getElementById('fadePanelOutVal');
                if (v) v.textContent = val.toFixed(1) + 's';
                this._scheduleSaveState();
                this.updatePreview();
                this._drawFadeEnvelope(this.selectedClip.fadeIn || 0, val, this.selectedClip.duration);
                this._syncFadePresetHighlight();
                this.renderProperties();
            }

            _syncFadePresetHighlight() {
                const clip = this.selectedClip;
                const fi = clip ? (clip.fadeIn  || 0) : 0;
                const fo = clip ? (clip.fadeOut || 0) : 0;
                let p = 'none';
                if (fi > 0 && fo > 0) p = 'inout';
                else if (fi > 0) p = 'in';
                else if (fo > 0) p = 'out';
                document.querySelectorAll('.fade-preset-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.preset === p);
                });
            }

            updateFxDropdownState() {
                const clip = this.selectedClip;
                const currentFx = (clip && clip.effect) ? clip.effect : 'none';
                const intensity = (clip && clip.effectIntensity != null) ? clip.effectIntensity : 50;
                
                // Highlight active effect
                document.querySelectorAll('.fx-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.fx === currentFx);
                });
                
                // Show/hide intensity slider
                const intensityRow = document.getElementById('fxIntensityRow');
                const slider = document.getElementById('fxIntensitySlider');
                const valueLabel = document.getElementById('fxIntensityValue');
                const footerLabel = document.getElementById('fxActiveLabel');
                
                if (currentFx !== 'none') {
                    if (intensityRow) intensityRow.style.display = 'flex';
                    if (slider) slider.value = intensity;
                    if (valueLabel) valueLabel.textContent = intensity + '%';
                    if (footerLabel) footerLabel.textContent = currentFx.toUpperCase() + ' — ' + intensity + '%';
                } else {
                    if (intensityRow) intensityRow.style.display = 'none';
                    if (footerLabel) footerLabel.textContent = clip ? 'No effect applied' : 'Select a clip first';
                }
            }

            applyClipEffect(fxName) {
                if (!this.selectedClip) {
                    this.showStatus('Select a clip first', 'warning');
                    return;
                }
                
                if (fxName === 'none') {
                    delete this.selectedClip.effect;
                    delete this.selectedClip.effectIntensity;
                } else {
                    this.selectedClip.effect = fxName;
                    if (this.selectedClip.effectIntensity == null) {
                        this.selectedClip.effectIntensity = 50;
                    }
                }
                
                this.updateFxDropdownState();
                this.saveState();
                this.updatePreview();
                this.renderTracks();
                this.showStatus(`Effect: ${fxName.toUpperCase()}`, 'success');
            }

            setEffectIntensity(value) {
                if (!this.selectedClip) return;
                this.selectedClip.effectIntensity = parseInt(value);
                
                const valueLabel = document.getElementById('fxIntensityValue');
                const footerLabel = document.getElementById('fxActiveLabel');
                if (valueLabel) valueLabel.textContent = value + '%';
                if (footerLabel && this.selectedClip.effect) {
                    footerLabel.textContent = this.selectedClip.effect.toUpperCase() + ' — ' + value + '%';
                }
                
                this.updatePreview();
                this._scheduleSaveState(); // F3 fix: FX intensity changes must be undoable (debounced)
            }

            /**
             * Apply a clip effect to the preview video/image via CSS filters + overlays.
             * Always calls applyColorGrading() at the end so FX and CG never overwrite each other.
             */
            /**
             * Met en pause les DEUX lecteurs d'aperçu (double tampon) et nettoie les
             * écouteurs de chargement en attente. À utiliser partout où l'ancien code
             * ne visait que `#previewVideo` : sinon un lecteur caché continue de jouer.
             */
            _pausePreviewVideos() {
                for (const el of [this._previewVideo, this._previewVideoB,
                                  document.getElementById('previewVideo'),
                                  document.getElementById('previewVideoB')]) {
                    if (!el) continue;
                    try { if (!el.paused) el.pause(); } catch (_) {}
                    if (el._loadListener) {
                        if (typeof el._loadListener === 'number') clearInterval(el._loadListener);
                        else el.removeEventListener('canplay', el._loadListener);
                        el._loadListener = null;
                    }
                }
            }

            /**
             * Élément média d'aperçu actuellement VISIBLE (`#previewVideo`,
             * `#previewVideoB` ou `#previewImage`). Indispensable depuis le double tampon :
             * `#previewVideo` n'est plus forcément celui qui est affiché (les FX canvas
             * peignaient une vidéo cachée, donc du noir).
             */
            _getVisiblePreviewMedia() {
                const a = document.getElementById('previewVideo');
                const b = document.getElementById('previewVideoB');
                const ig = document.getElementById('previewImage');
                for (const el of [a, b]) {
                    if (el && el.style.display !== 'none' && el.videoWidth) return el;
                }
                if (a && a.style.display !== 'none') return a;
                if (b && b.style.display !== 'none') return b;
                return ig;
            }

            applyClipEffectToPreview(clip) {
                // Guard: skip expensive DOM rebuild when the same clip+effect is already
                // applied. Called 60fps from updatePreview — without this guard it destroys
                // and recreates FX canvas overlays on every animation frame.
                const _fxKey = clip
                    ? `${clip.id}_${clip.effect || 'none'}_${clip.effectIntensity ?? 50}`
                    : '__no_clip__';
                // Always skip if key matches — not just during playback (fixes scrub perf)
                if (this._lastFxKey === _fxKey) return;
                this._lastFxKey = _fxKey;

                const previewContainer = document.getElementById('previewWrapper');
                if (!previewContainer) return;

                // Stop any running pixelate canvas loop
                if (this._pixelateRaf) {
                    cancelAnimationFrame(this._pixelateRaf);
                    this._pixelateRaf = null;
                }

                // Remove all existing FX overlays
                previewContainer.querySelectorAll('.fx-overlay').forEach(el => el.remove());

                // Reset CSS FX classes
                previewContainer.classList.remove('fx-glitch', 'fx-vhs', 'fx-scanlines', 'fx-shake', 'fx-mirror', 'fx-duotone');

                // Stop duotone / teal-orange canvas loop
                if (this._duotoneRaf) {
                    cancelAnimationFrame(this._duotoneRaf);
                    this._duotoneRaf = null;
                }
                if (this._tealOrangeRaf) {
                    cancelAnimationFrame(this._tealOrangeRaf);
                    this._tealOrangeRaf = null;
                }

                // Clear FX filter — color grading will reapply
                this._fxFilter = '';

                if (!clip || !clip.effect || clip.effect === 'none') {
                    this.applyColorGrading();
                    return;
                }

                const intensity = (clip.effectIntensity != null ? clip.effectIntensity : 50) / 100;
                const fx = clip.effect;

                switch (fx) {
                    case 'glitch':
                        previewContainer.classList.add('fx-glitch');
                        break;

                    case 'rgb-split': {
                        const rgbOffset = Math.round(2 + intensity * 14);
                        const rgbSrc = this._getVisiblePreviewMedia();
                        const rgbC = document.createElement('canvas');
                        rgbC.className = 'fx-overlay';
                        rgbC.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;';
                        previewContainer.appendChild(rgbC);
                        const rgbCtx = rgbC.getContext('2d', { willReadFrequently: true });
                        const drawRgb = () => {
                            if (!rgbC.isConnected) return;
                            const rw = previewContainer.clientWidth || 320;
                            const rh = previewContainer.clientHeight || 180;
                            if (rgbC.width !== rw || rgbC.height !== rh) { rgbC.width = rw; rgbC.height = rh; }
                            try {
                                rgbCtx.drawImage(rgbSrc, 0, 0, rw, rh);
                                const id = rgbCtx.getImageData(0, 0, rw, rh);
                                const d = id.data, cp = new Uint8ClampedArray(d);
                                for (let i = 0; i < d.length; i += 4) {
                                    const px = (i / 4) % rw, row = Math.floor(i / 4 / rw);
                                    const rSrc = Math.min(px + rgbOffset, rw - 1);
                                    d[i] = cp[(row * rw + rSrc) * 4];
                                    const bSrc = Math.max(px - rgbOffset, 0);
                                    d[i + 2] = cp[(row * rw + bSrc) * 4 + 2];
                                }
                                rgbCtx.putImageData(id, 0, 0);
                            } catch(e) {}
                            this._pixelateRaf = requestAnimationFrame(drawRgb);
                        };
                        drawRgb();
                        break;
                    }

                    case 'vhs':
                        previewContainer.classList.add('fx-vhs');
                        this._fxFilter = `saturate(${70 + intensity * 40}%) contrast(${100 + intensity * 15}%)`;
                        break;

                    case 'scanlines':
                        previewContainer.classList.add('fx-scanlines');
                        break;

                    case 'pixelate': {
                        // True canvas-based pixelation loop
                        const blockSize = Math.max(2, Math.round(3 + intensity * 22));
                        const source = this._getVisiblePreviewMedia();

                        const pxCanvas = document.createElement('canvas');
                        pxCanvas.className = 'fx-overlay';
                        pxCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;image-rendering:pixelated;image-rendering:crisp-edges;';
                        previewContainer.appendChild(pxCanvas);
                        const pxCtx = pxCanvas.getContext('2d');

                        const drawFrame = () => {
                            if (!pxCanvas.isConnected) return;
                            const w = previewContainer.clientWidth  || 320;
                            const h = previewContainer.clientHeight || 180;
                            const sw = Math.max(1, Math.ceil(w / blockSize));
                            const sh = Math.max(1, Math.ceil(h / blockSize));
                            if (pxCanvas.width !== sw)  pxCanvas.width  = sw;
                            if (pxCanvas.height !== sh) pxCanvas.height = sh;
                            try { pxCtx.drawImage(source, 0, 0, sw, sh); } catch(e) {}
                            this._pixelateRaf = requestAnimationFrame(drawFrame);
                        };
                        drawFrame();
                        break;
                    }

                    case 'invert':
                        this._fxFilter = `invert(${Math.round(intensity * 100)}%)`;
                        break;

                    case 'blur':
                        this._fxFilter = `blur(${Math.round(1 + intensity * 14)}px)`;
                        break;

                    case 'shake':
                        previewContainer.classList.add('fx-shake');
                        break;

                    case 'mirror':
                        previewContainer.classList.add('fx-mirror');
                        break;

                    case 'noise': {
                        const noiseEl = document.createElement('div');
                        noiseEl.className = 'fx-overlay fx-noise-overlay';
                        noiseEl.style.opacity = 0.1 + intensity * 0.5;
                        previewContainer.appendChild(noiseEl);
                        break;
                    }

                    case 'duotone': {
                        // Real-time canvas duotone: maps luma → indigo(shadow) ↔ gold(highlight)
                        const shadow  = [10,  5,  80];  // deep indigo
                        const hilite  = [255, 195, 20];  // warm gold
                        const source  = this._getVisiblePreviewMedia();

                        const dtCanvas = document.createElement('canvas');
                        dtCanvas.className = 'fx-overlay';
                        dtCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;';
                        previewContainer.appendChild(dtCanvas);
                        const dtCtx = dtCanvas.getContext('2d', { willReadFrequently: true });

                        const drawDuotone = () => {
                            if (!dtCanvas.isConnected) return;
                            const w = previewContainer.clientWidth  || 320;
                            const h = previewContainer.clientHeight || 180;
                            // Render at half-res for performance
                            const sw = Math.max(1, Math.ceil(w / 2));
                            const sh = Math.max(1, Math.ceil(h / 2));
                            if (dtCanvas.width !== sw)  dtCanvas.width  = sw;
                            if (dtCanvas.height !== sh) dtCanvas.height = sh;
                            try {
                                dtCtx.drawImage(source, 0, 0, sw, sh);
                                const id = dtCtx.getImageData(0, 0, sw, sh);
                                const d  = id.data;
                                for (let i = 0; i < d.length; i += 4) {
                                    const luma = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) / 255;
                                    const t = luma;
                                    const dr = shadow[0] + (hilite[0] - shadow[0]) * t;
                                    const dg = shadow[1] + (hilite[1] - shadow[1]) * t;
                                    const db = shadow[2] + (hilite[2] - shadow[2]) * t;
                                    d[i]   = d[i]   + (dr - d[i])   * intensity;
                                    d[i+1] = d[i+1] + (dg - d[i+1]) * intensity;
                                    d[i+2] = d[i+2] + (db - d[i+2]) * intensity;
                                }
                                dtCtx.putImageData(id, 0, 0);
                            } catch(e) {}
                            this._duotoneRaf = requestAnimationFrame(drawDuotone);
                        };
                        drawDuotone();
                        break;
                    }

                    case 'teal-orange': {
                        // Hollywood Teal & Orange: shadows→teal, highlights→orange
                        const srcTO    = this._getVisiblePreviewMedia();

                        const toCanvas = document.createElement('canvas');
                        toCanvas.className = 'fx-overlay';
                        toCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;';
                        previewContainer.appendChild(toCanvas);
                        const toCtx = toCanvas.getContext('2d', { willReadFrequently: true });

                        const drawTO = () => {
                            if (!toCanvas.isConnected) return;
                            const w  = previewContainer.clientWidth  || 320;
                            const h  = previewContainer.clientHeight || 180;
                            const sw = Math.max(1, Math.ceil(w / 2));
                            const sh = Math.max(1, Math.ceil(h / 2));
                            if (toCanvas.width !== sw)  toCanvas.width  = sw;
                            if (toCanvas.height !== sh) toCanvas.height = sh;
                            try {
                                toCtx.drawImage(srcTO, 0, 0, sw, sh);
                                const id = toCtx.getImageData(0, 0, sw, sh);
                                const d  = id.data;
                                const str = intensity; // 0..1
                                for (let i = 0; i < d.length; i += 4) {
                                    const luma = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) / 255;
                                    // Shadow teal push (low luma)
                                    const shadowW = Math.max(0, 1 - luma * 2.5) * str;
                                    // Highlight orange push (high luma)
                                    const highlightW = Math.max(0, luma * 2.5 - 1.5) * str;
                                    // Teal: R-, G+, B+
                                    d[i]   = Math.min(255, Math.max(0, d[i]   - 30 * shadowW + 60 * highlightW));
                                    d[i+1] = Math.min(255, Math.max(0, d[i+1] + 20 * shadowW -  5 * highlightW));
                                    d[i+2] = Math.min(255, Math.max(0, d[i+2] + 25 * shadowW - 60 * highlightW));
                                }
                                toCtx.putImageData(id, 0, 0);
                            } catch(e) {}
                            this._tealOrangeRaf = requestAnimationFrame(drawTO);
                        };
                        drawTO();
                        break;
                    }
                }

                // Always reapply color grading so CG+FX filters are combined
                this.applyColorGrading();
            }

            /**
             * Retourne la liste des effets appliqués à un clip (pour les moteurs d'export).
             * Compatible avec le pattern app._getClipEffects(clip).length > 0
             */
            _getClipEffects(clip) {
                if (!clip || !clip.effect || clip.effect === 'none') return [];
                return [clip.effect]; // Un seul effet par clip actuellement, mais retourne un array pour extensibilité
            }

            /**
             * 🚀 POOL DE CANVAS TEMPORAIRES (2026-09-10) — optimisation FX.
             *
             * `applyClipEffectToCanvas()` est appelée POUR CHAQUE FRAME de l'export
             * (jusqu'à 30-60 fois par seconde de vidéo, soit des milliers d'appels sur
             * un montage réel) et certaines branches FX (`pixelate`, `invert`, `blur`,
             * `shake`, `mirror`) faisaient `document.createElement('canvas')` À CHAQUE
             * APPEL. Un canvas 1920x1080 pèse ~8 Mo : on allouait donc plusieurs
             * gigaoctets cumulés et on forçait le ramasse-miettes en pleine boucle
             * d'encodage — c'est la principale cause de lenteur ressentie sur les FX.
             *
             * Ce pool réutilise un canvas par besoin et ne le redimensionne que si la
             * taille change réellement. Économie mesurée : 0 allocation canvas/frame.
             */
            _fxScratch(role, w, h) {
                if (!this._fxPool) this._fxPool = new Map();
                let entry = this._fxPool.get(role);
                if (!entry) {
                    const c = document.createElement('canvas');
                    entry = { canvas: c, ctx: c.getContext('2d') };
                    this._fxPool.set(role, entry);
                }
                const { canvas, ctx } = entry;
                // Redimensionner seulement si nécessaire (le redimensionnement efface le canvas)
                if (canvas.width !== w || canvas.height !== h) {
                    canvas.width = w;
                    canvas.height = h;
                } else {
                    ctx.clearRect(0, 0, w, h);
                }
                return entry;
            }

            /**
             * Apply clip effect to a canvas context (for export)
             */
            applyClipEffectToCanvas(ctx, clip, width, height, frameCount) {
                if (!clip || !clip.effect || clip.effect === 'none') return;
                
                const intensity = (clip.effectIntensity != null ? clip.effectIntensity : 50) / 100;
                const fx = clip.effect;
                
                switch (fx) {
                    case 'glitch': {
                        // Random horizontal slice displacement
                        const sliceCount = Math.floor(3 + intensity * 12);
                        const imageData = ctx.getImageData(0, 0, width, height);
                        const data = imageData.data;
                        // 🐛 CORRECTIF (2026-09-10) — déplacement en place.
                        // L'ancienne version lisait `data[srcIdx]` APRÈS avoir écrit dans `data` :
                        // chaque slice relisait des pixels déjà décalés par la slice précédente,
                        // ce qui produisait des traînées horizontales cumulatives qui n'existent
                        // pas dans l'aperçu (le CSS, lui, décale le calque d'origine). On déplace
                        // donc DEPUIS une copie intacte → rendu export identique à l'aperçu.
                        const srcData = new Uint8ClampedArray(data);
                        
                        for (let i = 0; i < sliceCount; i++) {
                            if (Math.random() > 0.4 + (1 - intensity) * 0.4) {
                                const y = Math.floor(Math.random() * height);
                                const sliceH = Math.floor(2 + Math.random() * (10 + intensity * 30));
                                const offset = Math.floor((Math.random() - 0.5) * intensity * 60);
                                
                                for (let row = y; row < Math.min(y + sliceH, height); row++) {
                                    for (let x = 0; x < width; x++) {
                                        const srcX = Math.min(Math.max(x + offset, 0), width - 1);
                                        const dstIdx = (row * width + x) * 4;
                                        const srcIdx = (row * width + srcX) * 4;
                                        data[dstIdx] = srcData[srcIdx];
                                        data[dstIdx + 1] = srcData[srcIdx + 1];
                                        data[dstIdx + 2] = srcData[srcIdx + 2];
                                    }
                                }
                            }
                        }
                        
                        // Random color channel offset  
                        if (Math.random() < intensity * 0.6) {
                            const channelOffset = Math.floor(intensity * 8);
                            // ← lit dans la copie intacte, pas dans `data` déjà modifié
                            for (let i = 0; i < data.length; i += 4) {
                                const shiftIdx = Math.min(i + channelOffset * 4, data.length - 4);
                                data[i] = srcData[shiftIdx]; // Red shift
                            }
                        }
                        
                        ctx.putImageData(imageData, 0, 0);
                        break;
                    }
                    
                    case 'rgb-split': {
                        const offset = Math.round(3 + intensity * 12);
                        const imageData = ctx.getImageData(0, 0, width, height);
                        const data = imageData.data;
                        const copy = new Uint8ClampedArray(data);
                        
                        for (let i = 0; i < data.length; i += 4) {
                            const px = (i / 4) % width;
                            // Shift red channel right
                            const rSrc = Math.min(px + offset, width - 1);
                            const rIdx = (Math.floor(i / 4 / width) * width + rSrc) * 4;
                            data[i] = copy[rIdx];
                            
                            // Shift blue channel left
                            const bSrc = Math.max(px - offset, 0);
                            const bIdx = (Math.floor(i / 4 / width) * width + bSrc) * 4;
                            data[i + 2] = copy[bIdx + 2];
                        }
                        
                        ctx.putImageData(imageData, 0, 0);
                        break;
                    }
                    
                    case 'vhs': {
                        // VHS: scanlines + color bleed + noise
                        const imageData = ctx.getImageData(0, 0, width, height);
                        const data = imageData.data;
                        
                        for (let y = 0; y < height; y++) {
                            // Scanline darkening (every other line)
                            if (y % 2 === 0) {
                                for (let x = 0; x < width; x++) {
                                    const idx = (y * width + x) * 4;
                                    data[idx] = Math.floor(data[idx] * (1 - intensity * 0.2));
                                    data[idx + 1] = Math.floor(data[idx + 1] * (1 - intensity * 0.2));
                                    data[idx + 2] = Math.floor(data[idx + 2] * (1 - intensity * 0.2));
                                }
                            }
                            // Horizontal jitter
                            if (Math.random() < intensity * 0.15) {
                                const jitter = Math.floor((Math.random() - 0.5) * intensity * 10);
                                for (let x = 0; x < width; x++) {
                                    const srcX = Math.min(Math.max(x + jitter, 0), width - 1);
                                    const dstIdx = (y * width + x) * 4;
                                    const srcIdx = (y * width + srcX) * 4;
                                    data[dstIdx] = data[srcIdx];
                                    data[dstIdx + 1] = data[srcIdx + 1];
                                    data[dstIdx + 2] = data[srcIdx + 2];
                                }
                            }
                        }
                        
                        // Film grain noise
                        for (let i = 0; i < data.length; i += 4) {
                            const noise = (Math.random() - 0.5) * intensity * 40;
                            data[i] = Math.min(255, Math.max(0, data[i] + noise));
                            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
                            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
                        }
                        
                        ctx.putImageData(imageData, 0, 0);
                        
                        // Subtle warm tint
                        ctx.save();
                        ctx.globalAlpha = intensity * 0.15;
                        ctx.fillStyle = '#ff8800';
                        ctx.fillRect(0, 0, width, height);
                        ctx.restore();
                        break;
                    }
                    
                    case 'scanlines': {
                        ctx.save();
                        ctx.globalAlpha = intensity * 0.5;
                        for (let y = 0; y < height; y += 3) {
                            ctx.fillStyle = '#000000';
                            ctx.fillRect(0, y, width, 1);
                        }
                        ctx.restore();
                        break;
                    }
                    
                    case 'pixelate': {
                        const blockSize = Math.max(2, Math.floor(2 + intensity * 18));
                        // 🚀 PERF : canvas réutilisé (était alloué à chaque frame)
                        const { canvas: tempCanvas, ctx: tempCtx } = this._fxScratch(
                            'pixelate', Math.ceil(width / blockSize), Math.ceil(height / blockSize));
                        tempCtx.drawImage(ctx.canvas, 0, 0, tempCanvas.width, tempCanvas.height);
                        ctx.imageSmoothingEnabled = false;
                        ctx.drawImage(tempCanvas, 0, 0, width, height);
                        ctx.imageSmoothingEnabled = true;
                        break;
                    }
                    
                    case 'invert': {
                        // J2 fix: copy to temp canvas first — drawing a canvas onto itself
                        // with a filter is undefined behaviour (black frame in Chrome, corrupt in Firefox)
                        // 🚀 PERF : canvas réutilisé (était alloué à chaque frame)
                        const { canvas: invTemp, ctx: invCtx } = this._fxScratch('invert', width, height);
                        invCtx.drawImage(ctx.canvas, 0, 0);
                        ctx.save();
                        ctx.filter = `invert(${Math.round(intensity * 100)}%)`;
                        ctx.clearRect(0, 0, width, height);
                        ctx.drawImage(invTemp, 0, 0);
                        ctx.filter = 'none';
                        ctx.restore();
                        break;
                    }
                    
                    case 'blur': {
                        // Same fix: copy to temp before applying CSS filter to canvas
                        // 🚀 PERF : canvas réutilisé (était alloué à chaque frame)
                        const { canvas: blurTemp, ctx: blurCtx } = this._fxScratch('blur', width, height);
                        blurCtx.drawImage(ctx.canvas, 0, 0);
                        const px = Math.round(1 + intensity * 10);
                        ctx.save();
                        ctx.filter = `blur(${px}px)`;
                        ctx.clearRect(0, 0, width, height);
                        ctx.drawImage(blurTemp, 0, 0);
                        ctx.filter = 'none';
                        ctx.restore();
                        break;
                    }
                    
                    case 'shake': {
                        const maxShake = Math.round(intensity * 12);
                        const dx = Math.floor((Math.random() - 0.5) * maxShake * 2);
                        const dy = Math.floor((Math.random() - 0.5) * maxShake * 2);
                        // 🚀 PERF : canvas réutilisé (était alloué à chaque frame)
                        const { canvas: shakeTemp, ctx: shakeCtx } = this._fxScratch('shake', width, height);
                        shakeCtx.drawImage(ctx.canvas, 0, 0);
                        ctx.fillStyle = '#000000';
                        ctx.fillRect(0, 0, width, height);
                        ctx.drawImage(shakeTemp, dx, dy);
                        break;
                    }
                    
                    case 'mirror': {
                        // 🚀 PERF : canvas réutilisé (était alloué à chaque frame)
                        const { canvas: mirTemp, ctx: mirCtx } = this._fxScratch('mirror', width, height);
                        mirCtx.drawImage(ctx.canvas, 0, 0);
                        ctx.save();
                        ctx.translate(width, 0);
                        ctx.scale(-1, 1);
                        ctx.drawImage(mirTemp, 0, 0);
                        ctx.restore();
                        break;
                    }
                    
                    case 'noise': {
                        const imageData = ctx.getImageData(0, 0, width, height);
                        const data = imageData.data;
                        const noiseLevel = intensity * 80;
                        
                        for (let i = 0; i < data.length; i += 4) {
                            const noise = (Math.random() - 0.5) * noiseLevel;
                            data[i] = Math.min(255, Math.max(0, data[i] + noise));
                            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
                            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
                        }
                        
                        ctx.putImageData(imageData, 0, 0);
                        break;
                    }
                    
                    case 'duotone': {
                        // Duotone: map luma to indigo(shadow) ↔ gold(highlight)
                        const shadow = [10,  5,  80];
                        const hilite = [255, 195, 20];
                        const imageData = ctx.getImageData(0, 0, width, height);
                        const d = imageData.data;
                        for (let i = 0; i < d.length; i += 4) {
                            const luma = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) / 255;
                            const t = luma;
                            const dr = shadow[0] + (hilite[0] - shadow[0]) * t;
                            const dg = shadow[1] + (hilite[1] - shadow[1]) * t;
                            const db = shadow[2] + (hilite[2] - shadow[2]) * t;
                            d[i]   = Math.round(d[i]   + (dr - d[i])   * intensity);
                            d[i+1] = Math.round(d[i+1] + (dg - d[i+1]) * intensity);
                            d[i+2] = Math.round(d[i+2] + (db - d[i+2]) * intensity);
                        }
                        ctx.putImageData(imageData, 0, 0);
                        break;
                    }

                    case 'teal-orange': {
                        // Hollywood Teal & Orange grade
                        const imageData = ctx.getImageData(0, 0, width, height);
                        const d = imageData.data;
                        const str = intensity;
                        for (let i = 0; i < d.length; i += 4) {
                            const luma = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) / 255;
                            const shadowW    = Math.max(0, 1 - luma * 2.5) * str;
                            const highlightW = Math.max(0, luma * 2.5 - 1.5) * str;
                            d[i]   = Math.min(255, Math.max(0, Math.round(d[i]   - 30 * shadowW + 60 * highlightW)));
                            d[i+1] = Math.min(255, Math.max(0, Math.round(d[i+1] + 20 * shadowW -  5 * highlightW)));
                            d[i+2] = Math.min(255, Math.max(0, Math.round(d[i+2] + 25 * shadowW - 60 * highlightW)));
                        }
                        ctx.putImageData(imageData, 0, 0);
                        break;
                    }
                }
            }

            toggleMediaLibrary() {
                const panel = document.getElementById('mediaLibraryPanel');
                const btn = document.getElementById('mediaLibraryOpenBtn');
                if (!panel) return;
                panel.classList.toggle('collapsed');
                const isCollapsed = panel.classList.contains('collapsed');
                if (btn) {
                    if (isCollapsed) {
                        btn.classList.add('visible');
                    } else {
                        btn.classList.remove('visible');
                    }
                }
            }

            updateExportResolutionOptions() {
                const resolutions = CutTheFlow.FORMAT_RESOLUTIONS[this.selectedAspectRatio] || CutTheFlow.FORMAT_RESOLUTIONS['16:9'];
                
                // Target specifically the resolution options container
                const resContainer = document.getElementById('exportResolutionOptions');
                if (!resContainer) return;
                
                // Rebuild resolution options
                resContainer.innerHTML = '';
                resolutions.forEach(res => {
                    const [w, h] = res.split('x');
                    const label = CutTheFlow.FORMAT_RES_LABELS[res] || res;
                    const isSelected = res === this.selectedResolution;
                    const div = document.createElement('div');
                    div.className = `export-option${isSelected ? ' selected' : ''}`;
                    div.dataset.resolution = res;
                    div.onclick = () => this.selectResolution(res);
                    div.innerHTML = `<div class="export-option-label">${w}×${h}</div><div class="export-option-desc">${label}</div>`;
                    resContainer.appendChild(div);
                });
                
                // If current resolution isn't in the list, select the default
                if (!resolutions.includes(this.selectedResolution)) {
                    const fmt = CutTheFlow.FORMAT_PRESETS[this.selectedAspectRatio];
                    this.selectedResolution = `${fmt.w}x${fmt.h}`;
                    // Re-mark selected
                    resContainer.querySelectorAll('.export-option').forEach(el => {
                        el.classList.toggle('selected', el.dataset.resolution === this.selectedResolution);
                    });
                }
            }

            selectFps(fps) {
                this.selectedFps = fps;
                document.querySelectorAll('[data-fps]').forEach(el => {
                    el.classList.toggle('selected', el.dataset.fps == fps);
                });
                this.updateSimpleModeDisplay();
            }

            selectFormat(format) {
                // Passe par le même chemin que la popin : normalisation + persistance +
                // recalcul du moteur, pour éviter deux sources de vérité divergentes.
                this.selectExportFormat(format);
            }

            // Master GPU toggle (the button shown in the export modal).
            // Drives BOTH preview and export GPU prefs together so the user gets
            // a single, coherent on/off switch. Préférences modal still exposes
            // the two flags independently for power users.
            toggleGpuAcceleration() {
                const next = !this.useGpuAcceleration;
                this.useGpuAcceleration = next;
                this.useGpuExport       = next;
                this.prefs.gpuPreview   = next;
                this.prefs.gpuExport    = next;
                this._savePrefs();
                const btn = document.getElementById('gpuAccelerationBtn');
                if (btn) btn.classList.toggle('active', next);
                // Re-sync the Préférences toggles if open.
                const prefPrev = document.getElementById('pref-gpuPreview');
                if (prefPrev) prefPrev.checked = next;
                const prefExp = document.getElementById('pref-gpuExport');
                if (prefExp) prefExp.checked = next;
                this._applyGpuLayerHints(next);
                console.log(`🎮 GPU Acceleration: ${next ? 'ENABLED' : 'DISABLED'} (preview + export)`);
                this.updateSimpleModeDisplay();
                this._probeExportCapabilities().then(capabilities => {
                    this._exportCapabilities = capabilities;
                    this._updateGpuStatusBanner(capabilities);
                });
            }

            // Apply lightweight GPU compositor hints.
            // IMPORTANT: Do NOT set transform on <video>/<img> preview elements —
            // _applyVideoTransform manages their transform and any interference
            // breaks seek events, playback, and positioning.
            _applyGpuLayerHints(enable) {
                // Timeline tracks: CSS containment isolates reflows without
                // creating extra GPU layers or interfering with video elements.
                const timelineEls = [
                    document.querySelector('.timeline-content'),
                    document.querySelector('.tracks-area')
                ].filter(Boolean);

                for (const el of timelineEls) {
                    el.style.contain = enable ? 'layout style paint' : '';
                }

                // Preview wrapper: hint the compositor that this area will
                // contain animated video content. No transform — just a hint.
                const previewWrapper = document.getElementById('previewWrapper');
                if (previewWrapper) {
                    previewWrapper.style.contain = enable ? 'layout style paint' : '';
                }
            }

            // ── PREFERENCES ──────────────────────────────────────────────────────

            _loadPrefs() {
                try {
                    const saved = localStorage.getItem('ctf_prefs');
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        Object.assign(this.prefs, parsed);
                    }
                } catch(e) {}
                // Sync legacy flags from prefs
                this.useGpuAcceleration = this.prefs.gpuPreview;
                this.useGpuExport       = this.prefs.gpuExport;
                this.SNAP_THRESHOLD     = this.prefs.snapThreshold;
                this.autoSaveInterval   = this.prefs.autoSaveDelay * 1000;
            }

            _savePrefs() {
                try { localStorage.setItem('ctf_prefs', JSON.stringify(this.prefs)); } catch(e) {}
            }

            setPref(key, value) {
                this.prefs[key] = value;
                this._savePrefs();
                // Apply immediately
                if (key === 'gpuPreview') {
                    this.useGpuAcceleration = value;
                    this._lastFxKey = null;
                    const btn = document.getElementById('gpuAccelerationBtn');
                    if (btn) btn.classList.toggle('active', value);
                    // Re-apply hot-path GPU hints immediately so the toggle is visible without reload.
                    this._applyGpuLayerHints(value);
                    this.updateSimpleModeDisplay();
                }
                if (key === 'gpuExport') {
                    this.useGpuExport = value;
                    // Keep the export pipeline flag in sync so the next render uses the new pref.
                    this.useGpuAcceleration = this.prefs.gpuPreview; // preview unchanged
                    this.updateSimpleModeDisplay();
                }
                if (key === 'snapEnabled') {
                    this.SNAP_THRESHOLD = value ? this.prefs.snapThreshold : 0;
                }
                if (key === 'snapThreshold') {
                    if (this.prefs.snapEnabled) this.SNAP_THRESHOLD = value;
                }
                if (key === 'autoSaveDelay') {
                    this.autoSaveInterval = value * 1000;
                    this.startAutoSave(); // restart with new interval
                }
                if (key === 'loopPlayback') {
                    // Applied in play() — nothing extra needed
                }
                if (key === 'exportQualityFirst') {
                    // No immediate action needed — applied on next export
                }
                if (key === 'adaptivePreview') {
                    // Reset adaptive state so it re-evaluates on next playback
                    this._adaptivePreviewActive = false;
                    this._adaptiveLowPerf = false;
                }
                if (key === 'previewForcePerformance') {
                    // Applied live in updatePlayhead/updatePreview. Reset the frame-skip
                    // counter and, when turning the mode OFF, clear any forced proxy so
                    // the preview returns to full quality immediately.
                    this._frameSkipCounter = 0;
                    if (!value && !this._adaptiveLowPerf) this._previewUseProxy = false;
                }
            }

            // ── Auto-optimisation selon la machine ────────────────────────────
            autoOptimizePreferences() {
                if (!window.exportSafeguards) return;
                
                const optimal = window.exportSafeguards.getOptimalPreferences();
                if (!optimal) return;
                
                // Appliquer tous les réglages recommandés
                const keys = ['gpuPreview', 'gpuExport', 'exportQualityFirst', 'adaptivePreview',
                             'previewForcePerformance',
                             'snapEnabled', 'snapThreshold', 'loopPlayback', 'autoSaveDelay',
                             'showWaveform', 'rippleEnabled'];
                for (const key of keys) {
                    if (optimal[key] !== undefined) {
                        this.setPref(key, optimal[key]);
                    }
                }
                
                // Appliquer résolution et FPS recommandés si export ouvert
                if (optimal.recommendedResolution) {
                    this.selectedResolution = optimal.recommendedResolution;
                }
                if (optimal.recommendedFps) {
                    this.selectedFps = optimal.recommendedFps;
                }
                if (optimal.recommendedEncoder) {
                    this.selectedEncoder = optimal.recommendedEncoder;
                    try { this.selectEncoder(optimal.recommendedEncoder); } catch(e) {}
                }
                
                // Rafraîchir l'UI
                this.showPreferences();
                this.updateSimpleModeDisplay();
                
                // Afficher un toast de confirmation
                const perfEmoji = optimal.gpuPreview === false ? '🟠' : optimal.recommendedEncoder === 'studio' ? '🟢' : '🟡';
                this.showStatus(`${perfEmoji} Réglages optimisés pour votre machine !`);
                
                // Feedback visuel sur le bouton
                const btn = document.querySelector('.pref-section button.export-btn.primary');
                if (btn) {
                    const originalText = btn.textContent;
                    btn.textContent = '✅ Optimisé !';
                    btn.style.background = '#2a5a2a';
                    btn.style.borderColor = '#4a8a4a';
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.style.background = '';
                        btn.style.borderColor = '';
                    }, 2000);
                }
                
                if (optimal.reason) {
                    console.log('🛡️ Auto-optimized preferences:', optimal);
                }
            }

            showPreferences() {
                const modal = document.getElementById('preferencesModal');
                if (!modal) return;
                // Sync all toggles to current prefs
                const sync = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) el.checked = !!val;
                };
                const syncVal = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) { el.value = val; el.nextElementSibling && (el.nextElementSibling.textContent = el.nextElementSibling.dataset.unit ? val + el.nextElementSibling.dataset.unit : val); }
                };
                sync('pref-gpuPreview',    this.prefs.gpuPreview);
                sync('pref-gpuExport',     this.prefs.gpuExport);
                sync('pref-snapEnabled',   this.prefs.snapEnabled);
                sync('pref-loopPlayback',  this.prefs.loopPlayback);
                sync('pref-showWaveform',  this.prefs.showWaveform);
                sync('pref-rippleEnabled', this.prefs.rippleEnabled);
                sync('pref-exportQualityFirst', this.prefs.exportQualityFirst);
                sync('pref-adaptivePreview', this.prefs.adaptivePreview);
                sync('pref-previewForcePerformance', this.prefs.previewForcePerformance);
                syncVal('pref-snapThreshold', this.prefs.snapThreshold);
                syncVal('pref-autoSaveDelay', this.prefs.autoSaveDelay);
                // Language dropdown — reflects the language currently applied by I18N.
                const langSelect = document.getElementById('pref-language');
                if (langSelect) {
                    const current = (window.I18N && window.I18N.lang) || localStorage.getItem('ctf_lang') || 'en';
                    langSelect.value = current === 'fr' ? 'fr' : 'en';
                }
                // Detect GPU info for display
                this._updatePrefsGpuInfo();
                modal.style.display = 'flex';
                modal.onclick = (e) => { if (e.target === modal) this.closePreferences(); };
            }

            closePreferences() {
                const modal = document.getElementById('preferencesModal');
                if (modal) modal.style.display = 'none';
            }

            _updatePrefsGpuInfo() {
                const el = document.getElementById('pref-gpu-info');
                const machineEl = document.getElementById('pref-machine-info');
                
                let gpuName = 'Détection en cours…';
                let gpuColor = '#888';
                
                // Toujours mettre à jour le bandeau machine, même si GPU pas détecté
                if (machineEl) {
                    const sys = window.exportSafeguards ? window.exportSafeguards.systemInfo : null;
                    const perfLabel = sys ? { low: '🟠 Modeste', medium: '🟡 Équilibrée', high: '🟢 Puissante' }[sys.performanceLevel] || 'Inconnue' : 'Inconnue';
                    const osLabel = sys ? sys.os : this._detectOS();
                    const memLabel = navigator.deviceMemory ? navigator.deviceMemory + ' Go' : '? Go';
                    const coresLabel = navigator.hardwareConcurrency || '?';
                    
                    // Détection GPU légère (juste pour le nom)
                    try {
                        const canvas = document.createElement('canvas');
                        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                        if (gl) {
                            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
                            const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
                            gpuName = (r || 'GPU détecté').toString().replace(/ANGLE \(|\)|Direct3D11 vs_5_0 ps_5_0|OpenGL/gi, '').trim() || 'GPU détecté';
                            gpuColor = '#0f9';
                            try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch(e) {}
                        } else {
                            gpuName = 'Pas de GPU détecté (rendu CPU)';
                            gpuColor = '#f80';
                        }
                    } catch(e) {
                        gpuName = 'Détection impossible';
                        gpuColor = '#666';
                    }
                    
                    if (gpuName.length > 60) gpuName = gpuName.substring(0, 57) + '…';
                    
                    machineEl.innerHTML = `
                        <strong>${perfLabel}</strong> · ${osLabel} · ${memLabel} RAM · ${coresLabel} cœurs<br>
                        <span style="color:${gpuColor};">GPU : ${gpuName}</span>
                    `;
                }
                
                if (el) { el.textContent = gpuName; el.style.color = gpuColor; }
            }
            
            _detectOS() {
                const ua = navigator.userAgent;
                if (/Mac|iPhone|iPad|iPod/.test(ua)) return 'macOS';
                if (/Windows/.test(ua)) return 'Windows';
                if (/Linux/.test(ua)) return 'Linux';
                if (/Android/.test(ua)) return 'Android';
                return 'Other';
            }
            
            selectEncoder(encoderType) {
                this.selectedEncoder = encoderType;
                
                // Update UI
                document.querySelectorAll('.encoder-option').forEach(opt => {
                    opt.classList.toggle('active', opt.dataset.encoder === encoderType);
                });
                
                // Update encoder explanation panel
                this._updateEncoderExplanation(encoderType);
                
                // Update settings display
                // ⚠️ Les cartes « moteur d'export » et le panneau de réglages automatiques
                //    ont été retirés de la popin le 2026-09-16 : ces éléments n'existent
                //    plus dans le DOM et TOUTES les écritures sont désormais gardées.
                const formatValue = document.getElementById('autoFormatValue');
                const qualityValue = document.getElementById('autoQualityValue');
                const notice = document.getElementById('autoNotice');
                
                if (encoderType === 'webm-webcodecs') {
                    if (formatValue) formatValue.textContent = 'WebM (VP9 + Opus)';
                    if (qualityValue) qualityValue.textContent = 'Ultra (5-20 Mbps VP9)';
                    if (notice) notice.textContent = '⚡ 100% offline — audio et vidéo parfaitement synchronisés quelle que soit la machine';
                } else if (encoderType === 'unified') {
                    if (formatValue) formatValue.textContent = (this.selectedFormat || 'webm').toUpperCase();
                    if (qualityValue) qualityValue.textContent = 'Pro (16-30 Mbps)';
                    if (notice) notice.textContent = '🏗️ Sélection automatique du meilleur moteur selon le format choisi (VP9 WebM ou H.264 MP4)';
                } else if (encoderType === 'webcodecs') {
                    if (formatValue) formatValue.textContent = 'MP4 (H.264 + AAC)';
                    if (qualityValue) qualityValue.textContent = 'Ultra (16-30 Mbps)';
                    if (notice) notice.textContent = '🎞️ MP4 offline — compatible iPhone, Android, Windows, macOS, réseaux sociaux';
                } else if (encoderType === 'canvas') {
                    if (formatValue) formatValue.textContent = 'WebM (VP9 + Opus)';
                    if (qualityValue) qualityValue.textContent = 'Pro (8-30 Mbps)';
                    if (notice) notice.textContent = '🎯 Temps réel — utilisé automatiquement si VP9 WebCodecs n\'est pas disponible';
                } else {
                    // mediarecorder
                    if (formatValue) formatValue.textContent = 'WebM (VP9 + Opus)';
                    if (qualityValue) qualityValue.textContent = 'High (8-30 Mbps)';
                    if (notice) notice.textContent = '📼 Capture native du navigateur — maximum de compatibilité, pas de codec externe';
                }
                
                // Update quality-first badge
                this._updateQualityFirstBadge();
            }

            _updateEncoderExplanation(encoderType) {
                const title = document.getElementById('encoderExplanationTitle');
                const text = document.getElementById('encoderExplanationText');
                const details = document.getElementById('encoderExplanationDetails');
                if (!title || !text || !details) return;

                const explanations = {
                    'webm-webcodecs': {
                        title: '⚡ VP9 + Opus — Nouveau moteur offline',
                        text: '<strong>Le plus fiable.</strong> Encode chaque image et chaque échantillon audio <strong>hors temps réel</strong>, puis assemble le tout en WebM. Le résultat est bit-identique sur un petit laptop comme sur un PC gamer — seul le temps d\'attente change. Audio et vidéo sont synchronisés par timestamps mathématiques, pas par horloge système.',
                        details: '<span>✅ Audio Opus 128kbps</span><span>🎞️ WebM VP9</span><span>🖥️ GPU auto</span><span>🎯 100% Déterministe</span><span>🔒 Sync parfaite</span>'
                    },
                    'unified': {
                        title: '🏗️ Unifié (Auto) — Routeur intelligent',
                        text: '<strong>Choix automatique.</strong> Analyse votre navigateur et choisit le meilleur moteur disponible : VP9+Opus pour WebM, H.264+AAC pour MP4. Si VP9 n\'est pas supporté, bascule sur Canvas automatiquement.',
                        details: '<span>✅ Audio + Vidéo</span><span>🎞️ MP4 ou WebM</span><span>🖥️ GPU optionnel</span><span>🔄 Fallback auto</span>'
                    },
                    'webcodecs': {
                        title: '🎞️ H.264 + AAC — MP4 Offline',
                        text: '<strong>MP4 universel.</strong> Encode en H.264+AAC hors temps réel via WebCodecs. Compatible avec tous les appareils (iPhone, Android, Windows, TV, réseaux sociaux). Résultat identique quelle que soit la vitesse de votre machine.',
                        details: '<span>✅ Audio AAC</span><span>🎞️ MP4 H.264</span><span>⚡ GPU ou CPU</span><span>📱 Universel</span><span>🎯 Déterministe</span>'
                    },
                    'canvas': {
                        title: '🎯 Canvas Real-time — Fallback WebM',
                        text: '<strong>Fallback temps réel.</strong> Fonctionne sur tous les navigateurs sans WebCodecs. Utilise MediaRecorder avec synchronisation adaptative. Moins précis que VP9 offline mais toujours fonctionnel.',
                        details: '<span>✅ Audio + Vidéo</span><span>🎞️ WebM VP9/VP8</span><span>💻 Sans GPU</span><span>⏩ Skip adaptatif</span>'
                    },
                    'mediarecorder': {
                        title: '📼 Classique (Natif) — Compatibilité max',
                        text: '<strong>Mode compatibilité.</strong> Capture MediaRecorder native du navigateur. Le rendu est temps réel. À utiliser si les autres moteurs échouent sur votre config.',
                        details: '<span>✅ Audio + Vidéo</span><span>🎞️ Format natif</span><span>💻 Pas de GPU</span><span>📼 Compatibilité max</span>'
                    }
                };

                const exp = explanations[encoderType] || explanations['webm-webcodecs'];
                title.textContent = exp.title;
                text.innerHTML = exp.text;
                details.innerHTML = exp.details;
            }
            
            /**
             * ⚠️ Avertit si l'onglet est (ou passe) en arrière-plan pendant un export.
             *
             * Chrome bride les `setTimeout` d'un onglet non visible à **1 seconde**, puis
             * **gèle** l'onglet. Les moteurs d'export rendent la main entre chaque image
             * par `setTimeout` (contrôle de flux de l'encodeur) : dans un onglet gelé la
             * boucle ne reprend jamais et l'export reste figé — SANS erreur, ce qui est
             * très déroutant. Un seul écouteur est posé (remplacé à chaque export), donc
             * pas d'accumulation.
             */
            _watchBackgroundExport() {
                const warn = () => {
                    const message = window.tr
                        ? window.tr(
                            'Keep this tab visible while exporting: Chrome pauses background tabs, which freezes the export.',
                            "Gardez cet onglet visible pendant l'export : Chrome met les onglets en arrière-plan en pause, ce qui fige l'export.")
                        : "Gardez cet onglet visible pendant l'export : Chrome met les onglets en arrière-plan en pause, ce qui fige l'export.";
                    this.showStatus('⚠️ ' + message, 'warning', 12000);
                };
                if (document.hidden) warn();
                if (this._bgExportListener) {
                    document.removeEventListener('visibilitychange', this._bgExportListener);
                }
                this._bgExportListener = () => { if (document.hidden) warn(); };
                document.addEventListener('visibilitychange', this._bgExportListener);
            }

            async handleExport() {
                // ⏸️ PAUSE PLAYBACK
                if (this.isPlaying) this.pause();

                // Le format est la SEULE décision : le moteur en découle.
                const format = ['mp4', 'webm', 'mp3'].includes(this.selectedFormat)
                    ? this.selectedFormat : 'mp4';
                this.selectedFormat = format;
                const encoder = this._exportEngineFor(format);

                console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #0ff');
                console.log(`%c🎬 EXPORT — Format: ${format.toUpperCase()}`, 'color: #0ff; font-size: 14px; font-weight: bold');
                console.log(`%c   Moteur: ${encoder} | ${this.selectedResolution} | ${this.selectedFps} fps`, 'color: #0ff');
                console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #0ff');

                const updateStatusAuto = (msg) => {
                    const el = document.getElementById('exportStatus');
                    if (el) el.textContent = msg;
                };

                // Rien à exporter ?
                if (this.getTimelineEndTime() <= 0) {
                    updateStatusAuto('❌ La timeline est vide — ajoutez au moins un clip.');
                    this.showStatus('❌ Timeline vide : rien à exporter.', 'error', 7000);
                    return;
                }

                // ── ⚠️ ONGLET EN ARRIÈRE-PLAN : l'export VA se figer ────────────────
                // Constaté au banc (2026-09-17) : un export lancé dans un onglet non
                // visible s'arrête net (ex. 271 images sur 390) et ne reprend jamais.
                // Cause = Chrome, pas l'app : les `setTimeout` des onglets cachés sont
                // bridés à 1 s, puis l'onglet est GELÉ. Or les moteurs d'export
                // rendent la main entre chaque image par `setTimeout` (contrôle de
                // flux de l'encodeur) : plus de timer = plus d'export, et AUCUNE
                // erreur n'est levée (le thread est simplement suspendu).
                // On prévient AVANT de commencer plutôt que de laisser croire à un bug.
                this._watchBackgroundExport();

                // ── 🎵 MP3 : audio seul ─────────────────────────────────────────────
                if (format === 'mp3') {
                    updateStatusAuto('🎵 Mixage et encodage MP3…');
                    return startMp3Export(this);
                }

                // ── 🎬 WEBM : VP9 + Opus offline ────────────────────────────────────
                if (format === 'webm') {
                    updateStatusAuto('⚡ Export WebM (VP9 + Opus)…');
                    try {
                        return await startWebMWebCodecsExport(this);
                    } catch (e) {
                        if (e && e.message === 'WEBM_VP9_UNSUPPORTED') {
                            // Repli assumé ET annoncé (jamais silencieux) : le moteur temps
                            // réel peut étirer un long montage.
                            console.warn('⚠️ VP9 WebCodecs indisponible → repli sur le moteur temps réel');
                            updateStatusAuto('⚠️ VP9 indisponible — repli sur le moteur temps réel…');
                            _warnRealtimeFallback(this, window.tr
                                ? window.tr(
                                    'VP9 is unavailable on this device — falling back to the real-time engine. Long montages may drift (the video can be stretched). For an exact file, export in MP4 (H.264).',
                                    "VP9 n'est pas disponible sur cet appareil — repli sur le moteur temps réel. Les montages longs risquent un décalage (vidéo étirée). Pour un fichier exact, exportez en MP4 (H.264).")
                                : "VP9 indisponible — repli sur le moteur temps réel : les montages longs peuvent être étirés.");
                            return startCanvasExport(this);
                        }
                        throw e;
                    }
                }

                // ── 🎬 MP4 : H.264 + AAC offline ────────────────────────────────────
                updateStatusAuto('🎞️ Export MP4 (H.264 + AAC)…');
                try {
                    return await startWebCodecsExport(this);
                } catch (e) {
                    if (e && e.message === 'MP4_H264_UNSUPPORTED') {
                        // Ce navigateur ne sait pas encoder en H.264 : on le DIT, et on
                        // bascule sur WebM plutôt que d'échouer sans explication.
                        console.warn('⚠️ H.264 WebCodecs indisponible → repli sur WebM');
                        updateStatusAuto('⚠️ H.264 indisponible sur ce navigateur — export en WebM…');
                        this.showStatus('⚠️ Ce navigateur ne sait pas encoder en H.264 : export en WebM à la place (qualité équivalente, format moins universel).', 'warning', 9000);
                        this.selectedFormat = 'webm';
                        this.selectedEncoder = 'webm-webcodecs';
                        try {
                            return await startWebMWebCodecsExport(this);
                        } catch (e2) {
                            if (e2 && e2.message === 'WEBM_VP9_UNSUPPORTED') {
                                _warnRealtimeFallback(this, window.tr
                                    ? window.tr(
                                        'VP9 is unavailable on this device — falling back to the real-time engine. Long montages may drift (the video can be stretched). For an exact file, export in MP4 (H.264).',
                                        "VP9 n'est pas disponible sur cet appareil — repli sur le moteur temps réel. Les montages longs risquent un décalage (vidéo étirée). Pour un fichier exact, exportez en MP4 (H.264).")
                                    : "VP9 indisponible — repli sur le moteur temps réel.");
                                return startCanvasExport(this);
                            }
                            throw e2;
                        }
                    }
                    throw e;
                }
            }
            

            showExportPreview(width, height, fps, format, size) {
                const modal = document.getElementById('exportPreviewModal');
                const video = document.getElementById('exportPreviewVideo');
                
                // Set video source
                video.src = this.exportedVideoUrl;

                // 🎵 Export audio seul (MP3) : pas de résolution ni de cadence à afficher,
                //    et le libellé du bouton devient « DOWNLOAD MP3 ».
                const isAudioOnly = !!(this.exportedMimeType && this.exportedMimeType.startsWith('audio/'));
                const ext = this._exportExtension();
                const dlBtn = document.getElementById('downloadExportBtn');
                if (dlBtn) dlBtn.textContent = isAudioOnly ? 'DOWNLOAD MP3' : 'DOWNLOAD';
                
                // Set details
                const resEl = document.getElementById('previewResolution');
                const fpsEl = document.getElementById('previewFps');
                if (resEl) resEl.textContent = isAudioOnly ? '—' : `${width}×${height}`;
                if (fpsEl) fpsEl.textContent = isAudioOnly ? '—' : `${fps} fps`;
                const fmt = ext.toUpperCase();
                const fmtEl = document.getElementById('previewFormat');
                if (fmtEl) fmtEl.textContent = fmt;
                const sizeEl = document.getElementById('previewSize');
                if (sizeEl) sizeEl.textContent = this.formatFileSize(size);

                // Prefill the rename input with the project name (or last used) and lock the extension display.
                const nameInput = document.getElementById('exportFilenameInput');
                const extLabel = document.getElementById('exportFilenameExt');
                if (nameInput) {
                    const baseName = (this.lastExportFilename || this.projectName || 'CUT_THE_FLOW_Export').replace(/\.[a-z0-9]{2,4}$/i, '');
                    nameInput.value = baseName;
                }
                if (extLabel) extLabel.textContent = '.' + ext;

                // Show modal
                modal.classList.add('show');
                
                // Close on background click
                modal.onclick = (e) => {
                    if (e.target === modal) {
                        this.closeExportPreviewModal();
                    }
                };
            }

            /**
             * Extension du fichier exporté, déduite du type MIME réellement produit.
             * Source unique de vérité pour l'aperçu ET le téléchargement (avant, la
             * logique était dupliquée à deux endroits et divergeait).
             */
            _exportExtension() {
                const mime = this.exportedMimeType || '';
                if (mime.includes('matroska')) return 'mkv';
                if (mime.includes('webm')) return 'webm';
                if (mime.includes('mp4')) return 'mp4';
                if (mime.includes('mpeg')) return 'mp3';
                if (mime.includes('wav')) return 'wav';
                const f = this.selectedFormat || 'mp4';
                return f === 'mkv' ? 'mkv' : f;
            }

            closeExportPreviewModal() {
                const modal = document.getElementById('exportPreviewModal');
                const video = document.getElementById('exportPreviewVideo');
                
                modal.classList.remove('show');
                video.pause();
                video.src = '';
                video.load();
            }

            downloadExportedVideo() {
                if (!this.exportedVideoBlob) {
                    this.showStatus('❌ No video to download');
                    return;
                }

                const extension = this._exportExtension();

                // Read user-chosen filename from the export popin (fallback to project name / timestamp).
                const nameInput = document.getElementById('exportFilenameInput');
                const rawName = (nameInput && nameInput.value.trim()) || this.projectName || `CUT_THE_FLOW_Export_${Date.now()}`;
                const safeName = this._sanitizeFilename ? this._sanitizeFilename(rawName) : rawName.replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 120);
                const finalName = safeName.replace(/\.[a-z0-9]{2,4}$/i, '') || 'export';
                this.lastExportFilename = finalName;

                const a = document.createElement('a');
                a.href = this.exportedVideoUrl;
                a.download = `${finalName}.${extension}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                this.showStatus(`✅ Download started: ${finalName}.${extension}`);
            }

            formatFileSize(bytes) {
                if (bytes < 1024) return bytes + ' B';
                if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
            }

            // ============================================
            // INDEXEDDB AUTO-SAVE SYSTEM
            // ============================================

            async initAutoSaveDB() {
                return new Promise((resolve, reject) => {
                    const request = indexedDB.open('CutTheFlowAutoSave', 2);
                    
                    request.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains('project')) {
                            db.createObjectStore('project', { keyPath: 'id' });
                        }
                        if (!db.objectStoreNames.contains('media')) {
                            db.createObjectStore('media', { keyPath: 'id' });
                        }
                    };
                    
                    request.onsuccess = (e) => {
                        this.autoSaveDB = e.target.result;
                        console.log('IndexedDB: Auto-save database ready');
                        resolve();
                    };
                    
                    request.onerror = (e) => {
                        console.error('IndexedDB: Failed to open', e);
                        resolve(); // Don't block app if IndexedDB fails
                    };
                });
            }

            startAutoSave() {
                if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
                
                this.autoSaveTimer = setInterval(() => {
                    if (this.autoSaveDirty && !this.isExporting) {
                        this.performAutoSave();
                    }
                }, this.autoSaveInterval);
                
                console.log(`Auto-save: Active (every ${this.autoSaveInterval / 1000}s)`);
            }

            markDirty() {
                this.autoSaveDirty = true;
            }

            async performAutoSave() {
                if (!this.autoSaveDB) return;
                
                const indicator = document.getElementById('autosaveIndicator');
                if (indicator) {
                    indicator.textContent = 'Saving...';
                    indicator.className = 'autosave-indicator saving';
                }
                
                try {
                    // 1. Save project state
                    const projectData = {
                        id: 'autosave',
                        version: '2.0',
                        projectName: this.projectName,
                        tracks: JSON.parse(JSON.stringify(this.tracks, (k,v)=>v===Infinity?'__INF__':v), (k,v)=>v==='__INF__'?Infinity:v),
                        mediaLibrary: this.mediaLibrary.map(m => ({
                            ...m,
                            url: undefined // URLs are transient, we store blobs separately
                        })),
                        currentTime: this.currentTime,
                        zoomLevel: this.zoomLevel,
                        trackIdCounter: this.trackIdCounter,
                        clipIdCounter: this.clipIdCounter,
                        mediaIdCounter: this.mediaIdCounter,
                        colorGrading: this.colorGrading,
                        selectedResolution: this.selectedResolution,
                        selectedAspectRatio: this.selectedAspectRatio,
                        selectedFps: this.selectedFps,
                        timestamp: Date.now()
                    };

                    const tx1 = this.autoSaveDB.transaction('project', 'readwrite');
                    tx1.objectStore('project').put(projectData);
                    await new Promise((res, rej) => { tx1.oncomplete = res; tx1.onerror = rej; });

                    // 2. Save media blobs
                    for (const media of this.mediaLibrary) {
                        if (media.url && media.url.startsWith('blob:')) {
                            try {
                                const resp = await fetch(media.url);
                                const blob = await resp.blob();
                                
                                const tx2 = this.autoSaveDB.transaction('media', 'readwrite');
                                tx2.objectStore('media').put({
                                    id: media.id,
                                    name: media.name,
                                    type: media.type,
                                    mimeType: blob.type,
                                    blob: blob
                                });
                                await new Promise((res, rej) => { tx2.oncomplete = res; tx2.onerror = rej; });
                            } catch (err) {
                                console.warn(`Auto-save: Could not save media ${media.name}`, err);
                            }
                        }
                    }

                    this.autoSaveDirty = false;
                    
                    if (indicator) {
                        indicator.textContent = 'Auto-saved';
                        indicator.className = 'autosave-indicator saved';
                        setTimeout(() => {
                            indicator.textContent = '';
                            indicator.className = 'autosave-indicator';
                        }, 3000);
                    }
                    
                    console.log('Auto-save: Complete');
                    
                } catch (err) {
                    console.error('Auto-save: Failed', err);
                    if (indicator) {
                        indicator.textContent = 'Auto-save failed';
                        indicator.className = 'autosave-indicator';
                    }
                }
            }

            async checkAutoSave() {
                if (!this.autoSaveDB) return;
                
                try {
                    const tx = this.autoSaveDB.transaction('project', 'readonly');
                    const store = tx.objectStore('project');
                    const request = store.get('autosave');
                    
                    const saved = await new Promise((res, rej) => {
                        request.onsuccess = () => res(request.result);
                        request.onerror = rej;
                    });
                    
                    if (saved && saved.timestamp) {
                        const age = Date.now() - saved.timestamp;
                        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
                        
                        if (age < maxAge) {
                            // Show recovery toast
                            const toast = document.getElementById('autosaveToast');
                            const info = document.getElementById('autosaveToastInfo');
                            
                            const date = new Date(saved.timestamp);
                            const timeStr = date.toLocaleString();
                            const trackCount = saved.tracks ? saved.tracks.length : 0;
                            const mediaCount = saved.mediaLibrary ? saved.mediaLibrary.length : 0;
                            const name = saved.projectName || 'Untitled';
                            
                            info.textContent = `"${name}" — ${timeStr} • ${trackCount} tracks, ${mediaCount} media`;
                            
                            setTimeout(() => toast.classList.add('show'), 1500);
                            
                            // Auto-hide after 15 seconds
                            this._autosaveToastTimeout = setTimeout(() => {
                                toast.classList.remove('show');
                            }, 15000);
                        }
                    }
                } catch (err) {
                    console.warn('Auto-save: Could not check for saved project', err);
                }
            }

            async restoreAutoSave() {
                if (!this.autoSaveDB) return;
                
                // Hide toast
                const toast = document.getElementById('autosaveToast');
                toast.classList.remove('show');
                if (this._autosaveToastTimeout) clearTimeout(this._autosaveToastTimeout);
                
                this.showStatus('Restoring auto-saved project...');
                
                try {
                    this.releaseProjectBlobUrls();

                    // 1. Load project data
                    const tx1 = this.autoSaveDB.transaction('project', 'readonly');
                    const request = tx1.objectStore('project').get('autosave');
                    const saved = await new Promise((res, rej) => {
                        request.onsuccess = () => res(request.result);
                        request.onerror = rej;
                    });
                    
                    if (!saved) {
                        this.showStatus('❌ No auto-saved project found');
                        return;
                    }
                    
                    // 2. Restore media blobs
                    const tx2 = this.autoSaveDB.transaction('media', 'readonly');
                    const mediaStore = tx2.objectStore('media');
                    const allMediaReq = mediaStore.getAll();
                    const allMedia = await new Promise((res, rej) => {
                        allMediaReq.onsuccess = () => res(allMediaReq.result);
                        allMediaReq.onerror = rej;
                    });
                    
                    // Rebuild media URLs from stored blobs
                    const mediaUrlMap = {};
                    for (const m of allMedia) {
                        if (m.blob) {
                            const url = URL.createObjectURL(m.blob);
                            mediaUrlMap[m.id] = url;
                        }
                    }
                    
                    // 3. Restore state
                    this.projectName = saved.projectName || 'Untitled';
                    this.tracks = saved.tracks || [];
                    this.mediaLibrary = (saved.mediaLibrary || []).map(m => ({
                        ...m,
                        url: mediaUrlMap[m.id] || m.url || ''
                    }));
                    this.currentTime = saved.currentTime || 0;
                    this.zoomLevel = saved.zoomLevel || 50;
                    this.trackIdCounter = saved.trackIdCounter || this.tracks.length;
                    this.clipIdCounter = saved.clipIdCounter || 1;
                    this.mediaIdCounter = saved.mediaIdCounter || 1;
                    this.colorGrading = saved.colorGrading || {
                        lift: 0, gamma: 0, gain: 0,
                        saturation: 100, contrast: 100, temp: 0
                    };
                    this.selectedResolution = saved.selectedResolution || '1920x1080';
                    this.selectedAspectRatio = saved.selectedAspectRatio || '16:9';
                    this.selectedFps = saved.selectedFps || 30;
                    
                    // Restore format preset UI
                    this.setFormatPreset(this.selectedAspectRatio);
                    
                    // Update clip URLs too
                    this.tracks.forEach(track => {
                        track.clips.forEach(clip => {
                            if (mediaUrlMap[clip.mediaId]) {
                                clip.url = mediaUrlMap[clip.mediaId];
                                clip.originalUrl = mediaUrlMap[clip.mediaId]; // M2 fix: keep originalUrl in sync
                            }
                        });
                    });
                    
                    // Recalculate solo
                    const anySolo = this.tracks.some(t => t.solo);
                    this.tracks.forEach(t => { t._effectiveMute = anySolo && !t.solo; });
                    
                    // Restore color grading
                    this.applyColorGrading();
                    
                    // Clear stale video cache (M4 fix)
                    this.releaseVideoCache();
                    this._currentPreviewClip = null;
                    this.forceVideoUpdate = true;
                    
                    // Clear audio cache
                    this.releaseAudioElements();
                    
                    // Re-render
                    this.render();
                    this.updatePlayhead();
                    this.saveState();
                    
                    this.showStatus(`✅ Project "${this.projectName}" restored from auto-save`);
                    
                } catch (err) {
                    console.error('Auto-save: Restore failed', err);
                    this.showStatus('❌ Failed to restore auto-saved project');
                }
            }

            dismissAutoSave() {
                const toast = document.getElementById('autosaveToast');
                toast.classList.remove('show');
                if (this._autosaveToastTimeout) clearTimeout(this._autosaveToastTimeout);
            }

            async clearAutoSave() {
                if (!this.autoSaveDB) return;
                try {
                    const tx1 = this.autoSaveDB.transaction('project', 'readwrite');
                    tx1.objectStore('project').clear();
                    const tx2 = this.autoSaveDB.transaction('media', 'readwrite');
                    tx2.objectStore('media').clear();
                } catch (e) { /* silent */ }
            }

            // ============================================
            // SAVE DIALOG
            // ============================================

            showSaveDialog() {
                const modal = document.getElementById('saveDialogModal');
                const overlay = document.getElementById('saveDialogOverlay');
                const nameInput = document.getElementById('saveProjectName');
                
                nameInput.value = this.projectName || 'Untitled';
                
                // Reset format selection
                this.selectSaveFormat(this.selectedSaveFormat || 'ctf');
                
                // Reset progress
                document.getElementById('saveProgress').style.display = 'none';
                document.getElementById('saveDialogConfirm').disabled = false;
                
                // Restore Pinata JWT if saved
                const savedJwt = sessionStorage.getItem('ctf_pinata_jwt');
                if (savedJwt) {
                    document.getElementById('pinataJwt').value = savedJwt;
                }
                
                modal.classList.add('show');
                overlay.classList.add('show');
                
                // Focus name input
                setTimeout(() => nameInput.select(), 100);
            }

            closeSaveDialog() {
                const modal = document.getElementById('saveDialogModal');
                const overlay = document.getElementById('saveDialogOverlay');
                modal.classList.remove('show');
                overlay.classList.remove('show');
            }

            selectSaveFormat(format) {
                this.selectedSaveFormat = format;
                
                // Update cards
                document.querySelectorAll('.save-format-card').forEach(card => {
                    card.classList.toggle('selected', card.dataset.format === format);
                });
                
                // Show/hide Pinata config
                document.getElementById('pinataConfig').style.display = 
                    format === 'pinata' ? 'block' : 'none';
            }

            async confirmSave() {
                const name = document.getElementById('saveProjectName').value.trim() || 'Untitled';
                this.projectName = name;
                
                const format = this.selectedSaveFormat;
                const btn = document.getElementById('saveDialogConfirm');
                btn.disabled = true;
                
                try {
                    switch (format) {
                        case 'ctf':
                            await this.saveAsCtf(name);
                            break;
                        case 'json':
                            this.saveAsJson(name);
                            break;
                        case 'pinata':
                            await this.saveToPinata(name);
                            break;
                    }
                    
                    this.closeSaveDialog();
                    
                } catch (err) {
                    console.error('Save failed:', err);
                    this.showStatus(`❌ Save failed: ${err.message}`);
                    btn.disabled = false;
                }
            }

            // ============================================
            // SAVE FORMATS
            // ============================================

            // --- .CTF Bundle (ZIP with media + project JSON) ---
            async saveAsCtf(name) {
                if (typeof JSZip === 'undefined') {
                    this.showStatus('❌ JSZip library not loaded');
                    throw new Error('JSZip not loaded');
                }
                
                const progress = document.getElementById('saveProgress');
                const progressFill = document.getElementById('saveProgressFill');
                const progressText = document.getElementById('saveProgressText');
                progress.style.display = 'block';
                
                const zip = new JSZip();
                
                // Collect media blobs
                const mediaFolder = zip.folder('media');
                const mediaMap = {}; // mediaId -> filename in zip
                const totalMedia = this.mediaLibrary.length;
                
                for (let i = 0; i < this.mediaLibrary.length; i++) {
                    const media = this.mediaLibrary[i];
                    const pct = Math.round(((i + 1) / (totalMedia + 1)) * 80);
                    progressFill.style.width = pct + '%';
                    progressText.textContent = `Packing media ${i + 1}/${totalMedia}...`;
                    
                    if (media.url && media.url.startsWith('blob:')) {
                        try {
                            const resp = await fetch(media.url);
                            const blob = await resp.blob();
                            
                            // Determine extension from mime type
                            const ext = this._mimeToExt(blob.type) || 'bin';
                            const fileName = `${media.id}_${this._sanitizeFilename(media.name)}.${ext}`;
                            
                            mediaFolder.file(fileName, blob);
                            mediaMap[media.id] = fileName;
                        } catch (err) {
                            console.warn(`CTF: Could not pack media ${media.name}`, err);
                        }
                    }
                }
                
                // Build project JSON
                progressText.textContent = 'Building project...';
                progressFill.style.width = '85%';
                
                const projectData = {
                    version: '2.0',
                    format: 'ctf',
                    appVersion: CutTheFlow.APP_VERSION,
                    projectName: name,
                    tracks: this.tracks.map(t => ({
                        ...t,
                        clips: t.clips.map(c => {
                            // Drop transient/non-serializable fields. `file` (File) becomes
                            // `{}` in JSON and breaks URL.createObjectURL on later loads.
                            const { file: _cf, ...cRest } = c;
                            const remoteClipUrl = typeof c.url === 'string' && /^(https?|data):/i.test(c.url);
                            return {
                                ...cRest,
                                url: undefined, // URLs are transient
                                // Repli de reliaison pour un média distant (conservé dans le JSON).
                                originalUrl: remoteClipUrl ? c.url : undefined,
                                isUsingProxy: false,
                                _ctfMediaFile: mediaMap[c.mediaId] || null
                            };
                        })
                    })),
                    mediaLibrary: this.mediaLibrary.map(m => {
                        const { file: _mf, ...mRest } = m;
                        // Un média embarqué est repéré par `_ctfMediaFile`. Un média distant
                        // (URL http/https/data) n'est PAS dans le ZIP : on conserve son URL,
                        // sinon il devenait « manquant » au rechargement du projet.
                        // Les URL blob ne survivent jamais à un rechargement : on ne les écrit pas.
                        const remote = typeof m.url === 'string' && /^(https?|data):/i.test(m.url);
                        return {
                            ...mRest,
                            url: remote ? m.url : undefined,
                            // Le proxy est un blob de session : jamais embarqué, jamais rechargé.
                            proxyUrl: undefined,
                            proxyWidth: 0,
                            proxyHeight: 0,
                            useProxy: false,
                            _ctfMediaFile: mediaMap[m.id] || null
                        };
                    }),
                    currentTime: this.currentTime,
                    zoomLevel: this.zoomLevel,
                    trackIdCounter: this.trackIdCounter,
                    clipIdCounter: this.clipIdCounter,
                    mediaIdCounter: this.mediaIdCounter,
                    colorGrading: this.colorGrading,
                    selectedResolution: this.selectedResolution,
                    selectedAspectRatio: this.selectedAspectRatio,
                    selectedFps: this.selectedFps,
                    // 🎬 Format d'export : depuis la 3.10.0 c'est la SEULE décision d'export
                    //    (le moteur en découle). Sans cette ligne, un projet enregistré en
                    //    MP3 ou WEBM se réouvrait en MP4.
                    selectedFormat: this.selectedFormat,
                    timestamp: Date.now()
                };
                
                zip.file('project.json', JSON.stringify(projectData, (k, v) => v === Infinity ? '__INF__' : v, 2));
                
                // Generate zip
                progressText.textContent = 'Compressing...';
                progressFill.style.width = '90%';
                
                const content = await zip.generateAsync({
                    type: 'blob',
                    compression: 'DEFLATE',
                    compressionOptions: { level: 3 } // Fast compression for large files
                }, (metadata) => {
                    const pct = 90 + Math.round(metadata.percent * 0.1);
                    progressFill.style.width = pct + '%';
                });
                
                // Download
                progressFill.style.width = '100%';
                progressText.textContent = 'Downloading...';
                
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${this._sanitizeFilename(name)}.ctf`;
                a.click();
                URL.revokeObjectURL(url);
                
                this.showStatus(`✅ Project "${name}" saved as .ctf`);
            }

            // --- .JSON (project data only) ---
            saveAsJson(name) {
                // Strip the File object — it can't be serialized and JSON.stringify turns it
                // into `{}`, which later passes truthy checks and breaks URL.createObjectURL.
                const sanitizedLibrary = this.mediaLibrary.map(m => {
                    const { file, ...rest } = m;
                    return rest;
                });
                const project = {
                    version: '2.0',
                    format: 'json',
                    appVersion: CutTheFlow.APP_VERSION,
                    projectName: name,
                    tracks: this.tracks,
                    mediaLibrary: sanitizedLibrary,
                    currentTime: this.currentTime,
                    zoomLevel: this.zoomLevel,
                    trackIdCounter: this.trackIdCounter,
                    clipIdCounter: this.clipIdCounter,
                    mediaIdCounter: this.mediaIdCounter,
                    colorGrading: this.colorGrading,
                    selectedResolution: this.selectedResolution,
                    selectedAspectRatio: this.selectedAspectRatio,
                    selectedFps: this.selectedFps,
                    // Voir saveAsCtf : le format d'export fait partie du projet.
                    selectedFormat: this.selectedFormat,
                    timestamp: Date.now()
                };

                const json = JSON.stringify(project, (k, v) => v === Infinity ? '__INF__' : v, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${this._sanitizeFilename(name)}.json`;
                a.click();
                URL.revokeObjectURL(url);

                this.showStatus(`✅ Project "${name}" saved as .json`);
            }

            // --- Pinata / IPFS ---
            async saveToPinata(name) {
                const jwt = document.getElementById('pinataJwt').value.trim();
                if (!jwt) {
                    throw new Error('Pinata JWT token required');
                }
                
                // Save JWT for next time
                sessionStorage.setItem('ctf_pinata_jwt', jwt);
                
                const progress = document.getElementById('saveProgress');
                const progressFill = document.getElementById('saveProgressFill');
                const progressText = document.getElementById('saveProgressText');
                progress.style.display = 'block';
                
                progressText.textContent = 'Preparing project for IPFS...';
                progressFill.style.width = '20%';
                
                // Build project JSON (like saveAsJson but upload to Pinata)
                const project = {
                    version: '2.0',
                    format: 'pinata',
                    projectName: name,
                    tracks: this.tracks,
                    mediaLibrary: this.mediaLibrary.map(m => ({
                        ...m,
                        url: undefined // blob URLs won't work on IPFS
                    })),
                    currentTime: this.currentTime,
                    zoomLevel: this.zoomLevel,
                    trackIdCounter: this.trackIdCounter,
                    clipIdCounter: this.clipIdCounter,
                    mediaIdCounter: this.mediaIdCounter,
                    colorGrading: this.colorGrading,
                    selectedResolution: this.selectedResolution,
                    selectedAspectRatio: this.selectedAspectRatio,
                    selectedFps: this.selectedFps,
                    timestamp: Date.now()
                };
                
                // First upload media files individually
                const mediaCIDs = {};
                const totalMedia = this.mediaLibrary.filter(m => m.url && m.url.startsWith('blob:')).length;
                let mediaIndex = 0;
                
                for (const media of this.mediaLibrary) {
                    if (media.url && media.url.startsWith('blob:')) {
                        try {
                            mediaIndex++;
                            const pct = 20 + Math.round((mediaIndex / (totalMedia + 1)) * 50);
                            progressFill.style.width = pct + '%';
                            progressText.textContent = `Uploading media ${mediaIndex}/${totalMedia} to IPFS...`;
                            
                            const resp = await fetch(media.url);
                            const blob = await resp.blob();
                            
                            const formData = new FormData();
                            formData.append('file', blob, media.name);
                            
                            const pinataMetadata = JSON.stringify({
                                name: `CTF_${name}_${media.name}`
                            });
                            formData.append('pinataMetadata', pinataMetadata);
                            
                            const uploadResp = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${jwt}` },
                                body: formData
                            });
                            
                            if (!uploadResp.ok) {
                                const errText = await uploadResp.text();
                                throw new Error(`Pinata upload failed: ${errText}`);
                            }
                            
                            const result = await uploadResp.json();
                            mediaCIDs[media.id] = result.IpfsHash;
                            console.log(`Pinata: Uploaded ${media.name} -> ${result.IpfsHash}`);
                            
                        } catch (err) {
                            console.warn(`Pinata: Could not upload ${media.name}`, err);
                        }
                    }
                }
                
                // Add IPFS CIDs to project
                project.mediaLibrary.forEach(m => {
                    if (mediaCIDs[m.id]) {
                        m.ipfsCID = mediaCIDs[m.id];
                        m.ipfsUrl = `https://gateway.pinata.cloud/ipfs/${mediaCIDs[m.id]}`;
                    }
                });
                
                // Upload project JSON
                progressText.textContent = 'Uploading project to IPFS...';
                progressFill.style.width = '80%';
                
                const projectBlob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
                const formData = new FormData();
                formData.append('file', projectBlob, `${name}.json`);
                
                const pinataMetadata = JSON.stringify({
                    name: `CutTheFlow_${name}`,
                    keyvalues: {
                        app: 'CutTheFlow',
                        version: '2.0',
                        mediaCount: String(this.mediaLibrary.length),
                        trackCount: String(this.tracks.length)
                    }
                });
                formData.append('pinataMetadata', pinataMetadata);
                
                const uploadResp = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${jwt}` },
                    body: formData
                });
                
                if (!uploadResp.ok) {
                    const errText = await uploadResp.text();
                    throw new Error(`Pinata upload failed: ${errText}`);
                }
                
                const result = await uploadResp.json();
                const projectCID = result.IpfsHash;
                const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${projectCID}`;
                
                progressFill.style.width = '100%';
                progressText.textContent = `✅ Published to IPFS`;
                
                // Copy CID to clipboard
                try {
                    await navigator.clipboard.writeText(ipfsUrl);
                } catch(e) { /* silent */ }
                
                // Show result with CID
                this.showStatus(`✅ Project "${name}" uploaded to IPFS: ${projectCID}`);
                
                // Also show an alert with the URL
                setTimeout(() => {
                    alert(`Project published to IPFS!\n\nCID: ${projectCID}\nURL: ${ipfsUrl}\n\n(URL copied to clipboard)`);
                }, 300);
            }

            // --- Load .CTF Bundle ---
            async loadCtfProject(file) {
                if (typeof JSZip === 'undefined') {
                    this.showStatus('❌ JSZip library not loaded');
                    return;
                }
                
                this.showStatus('Loading .ctf project...');
                
                try {
                    this.releaseProjectBlobUrls();

                    const zip = await JSZip.loadAsync(file);
                    
                    // Read project.json
                    const projectFile = zip.file('project.json');
                    if (!projectFile) {
                        throw new Error('Invalid .ctf file: missing project.json');
                    }
                    
                    const projectText = await projectFile.async('text');
                    const project = JSON.parse(projectText, (k, v) => v === '__INF__' ? Infinity : v);
                    
                    // Extract media files and create blob URLs
                    const mediaUrlMap = {};
                    const mediaFolder = zip.folder('media');
                    
                    if (mediaFolder) {
                        const mediaFiles = [];
                        mediaFolder.forEach((path, file) => {
                            if (!file.dir) mediaFiles.push({ path, file });
                        });
                        
                        for (const { path, file: zipFile } of mediaFiles) {
                            const blob = await zipFile.async('blob');
                            const url = URL.createObjectURL(blob);
                            
                            // Extract mediaId from filename (format: {id}_{name}.{ext})
                            const match = path.match(/^(\d+)_/);
                            if (match) {
                                mediaUrlMap[parseInt(match[1])] = url;
                            }
                        }
                    }
                    
                    // Restore state
                    this.projectName = project.projectName || 'Untitled';
                    this.tracks = (project.tracks || []).map(t => ({
                        ...t,
                        clips: t.clips.map(c => {
                            // Defensive: drop any leftover `file: {}` from older saves.
                            const cleaned = (c && c.file && !(c.file instanceof Blob))
                                ? (({ file: _f, ...rest }) => rest)(c)
                                : c;
                            const mediaUrl = mediaUrlMap[c.mediaId] || '';
                            // Un ancien projet peut contenir une URL blob morte (ou une URL
                            // distante) dans `originalUrl` : on ne réutilise que le distant.
                            const remote = typeof c.originalUrl === 'string' && /^(https?|data):/i.test(c.originalUrl);
                            const restoredUrl = mediaUrl || (remote ? c.originalUrl : '');
                            return {
                                ...cleaned,
                                url: restoredUrl,
                                originalUrl: restoredUrl,
                                // Le proxy n'est jamais embarqué dans le .ctf.
                                isUsingProxy: false
                            };
                        })
                    }));
                    this.mediaLibrary = (project.mediaLibrary || []).map(m => {
                        const cleaned = (m && m.file && !(m.file instanceof Blob))
                            ? (({ file: _f, ...rest }) => rest)(m)
                            : m;
                        const remote = typeof m.url === 'string' && /^(https?|data):/i.test(m.url);
                        return {
                            ...cleaned,
                            url: mediaUrlMap[m.id] || (remote ? m.url : ''),
                            // Le proxy est un blob de session : il est mort après rechargement.
                            proxyUrl: null,
                            proxyWidth: 0,
                            proxyHeight: 0,
                            useProxy: false
                        };
                    });
                    this.currentTime = project.currentTime || 0;
                    this.zoomLevel = project.zoomLevel || 50;
                    this.trackIdCounter = project.trackIdCounter || this.tracks.length;
                    this.clipIdCounter = project.clipIdCounter || 1;
                    this.mediaIdCounter = project.mediaIdCounter || 1;
                    this.colorGrading = project.colorGrading || {
                        lift: 0, gamma: 0, gain: 0,
                        saturation: 100, contrast: 100, temp: 0
                    };
                    
                    // Restore format preset
                    if (project.selectedAspectRatio) {
                        this.setFormatPreset(project.selectedAspectRatio);
                    }
                    if (project.selectedResolution) {
                        this.selectedResolution = project.selectedResolution;
                    }
                    if (project.selectedFps) {
                        this.selectedFps = project.selectedFps;
                    }
                    // Format d'export — absent des fichiers enregistrés avant la 3.10.0 :
                    // dans ce cas on conserve le format courant (pas de retour forcé à MP4).
                    if (project.selectedFormat) {
                        this.selectExportFormat(project.selectedFormat);
                    }
                    
                    // Recalculate solo
                    const anySolo = this.tracks.some(t => t.solo);
                    this.tracks.forEach(t => { t._effectiveMute = anySolo && !t.solo; });
                    
                    // Restore UI
                    this.applyColorGrading();
                    if (project.colorGrading) {
                        const sliders = {
                            lift: document.querySelector('input[oninput*="lift"]'),
                            gamma: document.querySelector('input[oninput*="gamma"]'),
                            gain: document.querySelector('input[oninput*="gain"]'),
                            saturation: document.querySelector('input[oninput*="saturation"]'),
                            contrast: document.querySelector('input[oninput*="contrast"]'),
                            temp: document.querySelector('input[oninput*="temp"]')
                        };
                        Object.keys(sliders).forEach(key => {
                            if (sliders[key] && this.colorGrading[key] !== undefined) {
                                sliders[key].value = this.colorGrading[key];
                            }
                        });
                    }
                    this.releaseAudioElements();

                    // Clean up _ctfMediaFile from clips and mediaLibrary (internal mapping,
                    // not needed after restoration — it's just noise in the data model).
                    this.tracks.forEach(t => t.clips.forEach(c => { delete c._ctfMediaFile; }));
                    this.mediaLibrary.forEach(m => { delete m._ctfMediaFile; });

                    // Clear any multi-selection from the previous project (stale ids).
                    if (this.selectedClipIds) this.selectedClipIds.clear();
                    this.selectedClip = null;

                    // Reset undo/redo: previous session history holds revoked blob URLs
                    // that would silently break media if the user pressed Ctrl+Z after load.
                    this.history = [];
                    this.historyIndex = -1;

                    this.render();
                    this.updatePlayhead();
                    this.saveState();
                    
                    // Check for missing media
                    const missing = this.mediaLibrary.filter(m => !m.url);
                    if (missing.length > 0) {
                        this.showRelinkModal(missing);
                    } else {
                        this.showStatus(`✅ Project "${this.projectName}" loaded from .ctf`);
                    }

                    console.log('CTF project loaded:', {
                        tracks: this.tracks.length,
                        media: this.mediaLibrary.length,
                        clips: this.tracks.reduce((sum, t) => sum + t.clips.length, 0),
                        missing: missing.length
                    });
                    
                } catch (err) {
                    console.error('CTF load failed:', err);
                    this.showStatus(`❌ Failed to load .ctf: ${err.message}`);
                }
            }

            // --- Utility helpers ---
            _sanitizeFilename(name) {
                return name.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_').substring(0, 80);
            }

            _mimeToExt(mime) {
                const map = {
                    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogg',
                    'video/quicktime': 'mov', 'video/x-matroska': 'mkv',
                    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
                    'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/webm': 'webm',
                    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
                    'image/webp': 'webp', 'image/svg+xml': 'svg'
                };
                return map[mime] || mime.split('/')[1] || 'bin';
            }

            // ============================================
            // PROJECT MANAGEMENT
            // ============================================
            
            newProject() {
                if (confirm('Create new project? Current work will be lost.')) {
                    this.releaseProjectBlobUrls();
                    this.mediaLibrary = [];
                    this.tracks = [];
                    this.selectedClip = null;
                    if (this.selectedClipIds) this.selectedClipIds.clear();
                    this.currentTime = 0;
                    this.trackIdCounter = 1;
                    this.clipIdCounter = 1;
                    this.mediaIdCounter = 1;
                    this.history = [];
                    this.historyIndex = -1;
                    this.projectName = 'Untitled';
                    this.clearAutoSave();
                    // N2 fix: reset color grading to defaults
                    this.colorGrading = { lift: 0, gamma: 0, gain: 0, saturation: 100, contrast: 100, temp: 0 };
                    this.applyColorGrading();
                    this.releaseVideoCache();
                    this._currentPreviewClip = null;
                    
                    // Re-create default tracks without full re-init
                    this.addTrack('VIDEO 1');
                    this.addTrack('VIDEO 2');
                    this.addTrack('VIDEO 3');
                    this.addTrack('AUDIO 1');
                    this.addTrack('AUDIO 2');
                    
                    this.render();
                    this.saveState();
                    // Collapse init states into single baseline
                    this.history = [this.history[this.historyIndex]];
                    this.historyIndex = 0;
                    this.updateUndoRedoButtons();
                    this.showStatus('New project created');
                }
            }

            saveProject() {
                // Now opens the save dialog instead of direct download
                this.showSaveDialog();
            }

            importProject() {
                // Alias to loadProject for UI consistency
                this.loadProject();
            }

            async loadProject() {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,.ctf';
                input.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    this.releaseProjectBlobUrls();
                    // .ctf = archive ZIP (projet + médias) ; .json = données seules
                    if (file.name.endsWith('.ctf')) return this.loadCtfProject(file);
                    return this.loadJsonProject(file);
                };
                input.click();
            }

            /**
             * Charge un projet au format .json (données seules, sans les médias).
             * Extrait de loadProject() pour être symétrique de loadCtfProject() — et
             * donc appelable directement (le banc de régression `tools/regression` s'en
             * sert pour tester l'aller-retour d'enregistrement).
             */
            async loadJsonProject(file) {
                try {
                        this.showStatus('Loading project...');
                        
                        const text = await file.text();
                        const project = JSON.parse(text, (k, v) => v === '__INF__' ? Infinity : v);
                        
                        // Restore project state
                        this.projectName = project.projectName || file.name.replace(/\.(json|ctf)$/i, '') || 'Untitled';
                        this.tracks = project.tracks || [];
                        // Older JSON saves may carry a `file: {}` (empty object from a
                        // non-serializable File). Drop it so export won't try to call
                        // URL.createObjectURL on a plain object.
                        this.mediaLibrary = (project.mediaLibrary || []).map(m => {
                            if (m && m.file && !(m.file instanceof Blob)) {
                                const { file: _f, ...rest } = m;
                                return rest;
                            }
                            return m;
                        });
                        // 🧹 Proxy et URL blob : ils ne survivent pas à un rechargement.
                        // Sans ce nettoyage, la preview (et l'ancien chemin d'export)
                        // demandait un blob révoqué → image noire jusqu'au relink.
                        this.mediaLibrary.forEach(m => {
                            if (!m) return;
                            if (typeof m.proxyUrl === 'string' && m.proxyUrl.startsWith('blob:')) {
                                m.proxyUrl = null;
                                m.proxyWidth = 0;
                                m.proxyHeight = 0;
                            }
                            if (!m.proxyUrl) m.useProxy = false;
                        });
                        (this.tracks || []).forEach(t => (t.clips || []).forEach(c => { c.isUsingProxy = false; }));
                        this.currentTime = project.currentTime || 0;
                        this.zoomLevel = project.zoomLevel || 50;
                        this.trackIdCounter = project.trackIdCounter || this.tracks.length;
                        this.clipIdCounter = project.clipIdCounter || 1;
                        this.mediaIdCounter = project.mediaIdCounter || 1;
                        this.colorGrading = project.colorGrading || {
                            lift: 0,
                            gamma: 0,
                            gain: 0,
                            saturation: 100,
                            contrast: 100,
                            temp: 0
                        };
                        
                        // Restore format preset / aspect ratio
                        if (project.selectedAspectRatio) {
                            this.setFormatPreset(project.selectedAspectRatio);
                        }
                        if (project.selectedResolution) {
                            this.selectedResolution = project.selectedResolution;
                        }
                        if (project.selectedFps) {
                            this.selectedFps = project.selectedFps;
                        }
                        // Format d'export (voir loadCtfProject)
                        if (project.selectedFormat) {
                            this.selectExportFormat(project.selectedFormat);
                        }
                        
                        // Recalculate solo logic (_effectiveMute)
                        const anySolo = this.tracks.some(t => t.solo);
                        this.tracks.forEach(t => {
                            t._effectiveMute = anySolo && !t.solo;
                        });
                        
                        // Restore color grading UI
                        this.applyColorGrading();
                        if (project.colorGrading) {
                            // Update sliders
                            const sliders = {
                                lift: document.querySelector('input[oninput*="lift"]'),
                                gamma: document.querySelector('input[oninput*="gamma"]'),
                                gain: document.querySelector('input[oninput*="gain"]'),
                                saturation: document.querySelector('input[oninput*="saturation"]'),
                                contrast: document.querySelector('input[oninput*="contrast"]'),
                                temp: document.querySelector('input[oninput*="temp"]')
                            };
                            
                            Object.keys(sliders).forEach(key => {
                                if (sliders[key] && this.colorGrading[key] !== undefined) {
                                    sliders[key].value = this.colorGrading[key];
                                }
                            });
                        }
                        
                        // Recreate audio elements cache for loaded clips
                        this.releaseAudioElements();

                        // Clear any multi-selection from the previous project (stale ids).
                        if (this.selectedClipIds) this.selectedClipIds.clear();
                        this.selectedClip = null;

                        // Reset undo/redo: previous session history holds revoked blob URLs
                        // that would silently break media if the user pressed Ctrl+Z after load.
                        this.history = [];
                        this.historyIndex = -1;

                        // Check for missing media files
                        const missingMedia = [];
                        for (const media of this.mediaLibrary) {
                            // Check if blob URL is still valid (it won't be after browser reload)
                            if (media.url && media.url.startsWith('blob:')) {
                                missingMedia.push(media);
                            }
                        }
                        
                        // Re-render everything
                        this.render();
                        this.updatePlayhead();
                        
                        // Save initial state for undo
                        this.saveState();
                        
                        if (missingMedia.length > 0) {
                            // Show relink modal
                            this.showRelinkModal(missingMedia);
                        } else {
                            this.showStatus('Project loaded successfully');
                        }
                        
                        console.log('Project loaded:', {
                            tracks: this.tracks.length,
                            media: this.mediaLibrary.length,
                            clips: this.tracks.reduce((sum, t) => sum + t.clips.length, 0),
                            missing: missingMedia.length
                        });
                        
                } catch (error) {
                    console.error('Failed to load project:', error);
                    this.showStatus('Failed to load project');
                }
            }

            showRelinkModal(missingMedia) {
                this.missingMediaList = missingMedia;
                this.relinkCount = 0;
                
                const modal = document.getElementById('relinkModal');
                const overlay = document.getElementById('relinkOverlay');
                const list = document.getElementById('relinkList');
                
                // Build list of missing files
                list.innerHTML = '';
                missingMedia.forEach((media, index) => {
                    const item = document.createElement('div');
                    item.className = 'relink-item';
                    
                    const infoDiv = document.createElement('div');
                    infoDiv.className = 'relink-item-info';
                    const nameDiv = document.createElement('div');
                    nameDiv.className = 'relink-item-name';
                    nameDiv.title = media.name;
                    nameDiv.textContent = media.name;
                    const typeDiv = document.createElement('div');
                    typeDiv.className = 'relink-item-type';
                    typeDiv.textContent = media.type;
                    infoDiv.appendChild(nameDiv);
                    infoDiv.appendChild(typeDiv);
                    
                    const statusDiv = document.createElement('div');
                    statusDiv.className = 'relink-item-status';
                    statusDiv.id = `relinkStatus${index}`;
                    statusDiv.textContent = 'Missing';
                    
                    const btn = document.createElement('button');
                    btn.className = 'relink-btn-small';
                    btn.textContent = 'Locate File';
                    btn.onclick = () => app.relinkFile(index);
                    
                    item.appendChild(infoDiv);
                    item.appendChild(statusDiv);
                    item.appendChild(btn);
                    list.appendChild(item);
                });
                
                modal.classList.add('show');
                overlay.classList.add('show');
            }

            async relinkFile(index) {
                const media = this.missingMediaList[index];
                
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = media.type === 'video' ? 'video/*' : 
                              media.type === 'audio' ? 'audio/*' : 
                              media.type === 'image' ? 'image/*' : '*/*';
                
                input.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    
                    // Create new blob URL
                    const newUrl = URL.createObjectURL(file);
                    
                    // Update media library
                    const mediaIndex = this.mediaLibrary.findIndex(m => m.id === media.id);
                    if (mediaIndex !== -1) {
                        this.mediaLibrary[mediaIndex].url = newUrl;
                        this.mediaLibrary[mediaIndex].name = file.name;
                        // Store the File so export can recreate a fresh blob URL if the
                        // current one is later revoked (large/long exports refresh URLs).
                        this.mediaLibrary[mediaIndex].file = file;
                    }
                    
                    // Update all clips using this media
                    this.tracks.forEach(track => {
                        track.clips.forEach(clip => {
                            if (clip.mediaId === media.id) {
                                clip.url = newUrl;
                                clip.originalUrl = newUrl; // keep export URL in sync
                            }
                        });
                    });
                    
                    // Update status
                    const statusEl = document.getElementById(`relinkStatus${index}`);
                    if (statusEl) {
                        statusEl.textContent = 'Linked';
                        statusEl.classList.add('linked');
                    }
                    
                    this.relinkCount++;
                    
                    // Re-render
                    this.render();
                    this.renderTracks();
                    this.updatePreview();
                    this.saveState();
                    
                    this.showStatus(`✅ Relinked: ${file.name}`);
                };
                
                input.click();
            }

            skipRelink() {
                const modal = document.getElementById('relinkModal');
                const overlay = document.getElementById('relinkOverlay');
                
                modal.classList.remove('show');
                overlay.classList.remove('show');
                
                this.showStatus(`Project loaded with ${this.missingMediaList.length} missing files`);
            }

            finishRelink() {
                const modal = document.getElementById('relinkModal');
                const overlay = document.getElementById('relinkOverlay');
                
                modal.classList.remove('show');
                overlay.classList.remove('show');
                
                const remaining = this.missingMediaList.length - this.relinkCount;
                
                if (remaining === 0) {
                    this.showStatus('All media files relinked successfully');
                } else {
                    this.showStatus(`Project loaded (${remaining} files still missing)`);
                }
            }

            // ============================================
            // UTILITIES
            // ============================================
            
            sleep(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            releaseExportedVideoUrl() {
                if (this.exportedVideoUrl && this.exportedVideoUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(this.exportedVideoUrl);
                }
                this.exportedVideoUrl = null;
            }

            storeExportedVideo(blob, mimeType) {
                this.releaseExportedVideoUrl();
                this.exportedVideoBlob = blob;
                this.exportedVideoUrl = URL.createObjectURL(blob);
                this.exportedMimeType = mimeType || blob?.type || null;
            }

            releaseProjectBlobUrls() {
                this.releaseVideoCache();
                this.mediaLibrary.forEach((media) => {
                    if (media?.url && media.url.startsWith('blob:')) {
                        URL.revokeObjectURL(media.url);
                    }
                    if (media?.proxyUrl && media.proxyUrl.startsWith('blob:')) {
                        URL.revokeObjectURL(media.proxyUrl);
                    }
                });
            }

            showLoading() {
                const loading = document.getElementById('loading');
                if (loading) loading.style.display = 'block';
            }

            hideLoading() {
                const loading = document.getElementById('loading');
                if (loading) loading.style.display = 'none';
            }

            /**
             * Affiche un message dans la barre de statut.
             * @param {string} message
             * @param {'info'|'warning'|'error'} [type='info'] — un avertissement reste
             *        affiché plus longtemps (7 s) : il doit pouvoir être lu.
             * @param {number} [duration] — durée explicite en ms (prime sur `type`).
             *
             * Rétrocompatible : l'immense majorité des appels passe un seul argument.
             */
            showStatus(message, type = 'info', duration) {
                const status = document.getElementById('statusMessage');
                if (status) {
                    const span = document.createElement('span');
                    span.textContent = message;
                    span.className = 'status-msg status-msg--' + type;
                    status.textContent = '';
                    status.appendChild(span);
                    status.classList.add('has-message');
                    // Les avertissements/erreurs restent affichés plus longtemps.
                    const ms = typeof duration === 'number'
                        ? duration
                        : (type === 'info' ? 3000 : 7000);
                    clearTimeout(this._statusTimer);
                    this._statusTimer = setTimeout(() => {
                        status.textContent = 'Ready';
                        status.classList.remove('has-message');
                    }, ms);
                }
            }
        }

        // ============================================
        // SPLASH SCREEN
        // ============================================
        (function initSplashScreen() {
            const splash = document.getElementById('splashScreen');
            if (!splash) return;
            const splashImg = document.getElementById('splashImage');

            // Curated picsum seeds → cinematic photos from the web only
            const picsumSeeds = [
                'cuttheflow-a', 'cuttheflow-b', 'cuttheflow-c',
                'cuttheflow-d', 'cuttheflow-e'
            ];

            if (splashImg) {
                const seed = picsumSeeds[Math.floor(Math.random() * picsumSeeds.length)];
                const picsumUrl = `https://picsum.photos/seed/${seed}/1400/900`;
                // Load web photo; fade in on success, hide media panel if offline
                splashImg.onload  = () => { splashImg.style.opacity = '1'; };
                splashImg.onerror = () => { splashImg.style.display = 'none'; };
                splashImg.src = picsumUrl;
            }

            const hideSplash = () => {
                splash.classList.add('hidden');
                splash.setAttribute('aria-hidden', 'true');
            };

            // Hide on click anywhere on splash
            splash.addEventListener('click', hideSplash);

            // Hide after load or timeout
            window.addEventListener('load', () => setTimeout(hideSplash, 2500));
            setTimeout(hideSplash, 9000); // Safety fallback
        })();

        // ============================================
        // INITIALIZE APP
        // ============================================
        
        let app;
        
        window.addEventListener('DOMContentLoaded', () => {
            app = new CutTheFlow();
            window.app = app; // For global access

            // Cleanup intervals/timers on tab close to avoid leaks in BFCache scenarios.
            // Also warn if an export is in progress.
            window.addEventListener('beforeunload', (e) => {
                try {
                    if (app?.saveReminderInterval) {
                        clearInterval(app.saveReminderInterval);
                        app.saveReminderInterval = null;
                    }
                    if (app?.autoSaveTimer) {
                        clearInterval(app.autoSaveTimer);
                        app.autoSaveTimer = null;
                    }
                    if (app?.isExporting) {
                        e.preventDefault();
                        e.returnValue = 'An export is in progress. Are you sure you want to leave?';
                        return e.returnValue;
                    }
                } catch (_) { /* best-effort */ }
            });

            // ── Global error surfacing ─────────────────────────────────────────
            // Silent failures are the #1 cause of "it froze / nothing happened"
            // reports. Catch uncaught errors + unhandled promise rejections and
            // show a discreet, rate-limited status so the user knows something
            // went wrong (and it lands in the console for debugging).
            let _lastErrToast = 0;
            const _surfaceError = (label, detail) => {
                console.error('[CutTheFlow]', label, detail);
                const now = Date.now();
                if (now - _lastErrToast < 4000) return; // rate-limit to avoid spam
                _lastErrToast = now;
                try { app?.showStatus?.('⚠️ ' + label, 'error'); } catch (_) {}
            };
            window.addEventListener('error', (e) => {
                // Ignore benign ResizeObserver loop notices and cross-origin script noise
                const msg = e?.message || '';
                if (/ResizeObserver loop/i.test(msg)) return;
                if (msg === 'Script error.' && !e.filename) return;
                _surfaceError('An unexpected error occurred', e?.error || msg);
            });
            window.addEventListener('unhandledrejection', (e) => {
                _surfaceError('An operation failed', e?.reason);
            });
        });
