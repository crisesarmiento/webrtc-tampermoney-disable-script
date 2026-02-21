// ==UserScript==
// @name         M-Game Clean Audio v3
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Bulletproof WebRTC audio bypass for RØDE M-Game — constraints + Web Audio API passthrough
// @author       Cris Sarmiento
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[M-Game v3]';
    const SAMPLE_RATE = 48000;

    console.log(`${TAG} Clean Audio v3 loaded`);

    // =========================================================================
    // SECTION 1: Constraint definitions
    // =========================================================================

    // W3C standard — {exact: false} = mandatory, browser must comply or fail
    const W3C_CONSTRAINTS = {
        echoCancellation: { exact: false },
        autoGainControl: { exact: false },
        noiseSuppression: { exact: false },
    };

    // Quality targets for music
    const QUALITY_CONSTRAINTS = {
        channelCount: { ideal: 2 },
        sampleRate: { ideal: SAMPLE_RATE },
        sampleSize: { ideal: 24 },
        latency: { ideal: 0.01 },
    };

    // Chrome legacy — some internal pipeline stages only check these
    const GOOG_CONSTRAINTS = {
        googEchoCancellation: false,
        googAutoGainControl: false,
        googAutoGainControl2: false,
        googNoiseSuppression: false,
        googNoiseSuppression2: false,
        googHighpassFilter: false,
        googTypingNoiseDetection: false,
        googAudioMirroring: false,
        googExperimentalAutoGainControl: false,
        googExperimentalNoiseSuppression: false,
        googExperimentalEchoCancellation: false,
        googDucking: false,
        googNoiseReduction: false,
    };

    // Optional (may not exist in all browsers)
    const OPTIONAL_CONSTRAINTS = {
        voiceIsolation: false,
    };

    // =========================================================================
    // SECTION 2: Web Audio API bypass
    //
    // This is the core improvement over v2. Instead of trusting the browser
    // to honor our constraints, we route the audio through the Web Audio API
    // which has NO built-in voice processing. The WebRTC stack then receives
    // a "pre-processed" stream it won't touch further.
    //
    // Flow:
    //   M-Game mic → getUserMedia → [Web Audio API passthrough] → clean stream
    //                                    ↓
    //                          MediaStreamSource
    //                                    ↓
    //                              GainNode (1.0)
    //                                    ↓
    //                        MediaStreamDestination
    //                                    ↓
    //                          clean output stream → X Spaces WebRTC
    // =========================================================================

    /**
     * Route a MediaStream through the Web Audio API to bypass all browser
     * audio processing. Returns a new clean MediaStream.
     */
    function createCleanBypass(originalStream) {
        const audioTracks = originalStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.log(`${TAG} No audio tracks to bypass`);
            return originalStream;
        }

        try {
            // Create AudioContext at M-Game's native sample rate
            const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });

            // Source: the original mic/device stream
            const source = ctx.createMediaStreamSource(originalStream);

            // Gain node at unity (1.0) — acts as a clean passthrough
            // Also gives us a volume knob if ever needed
            const gain = ctx.createGain();
            gain.gain.value = 1.0;

            // Destination: creates a new MediaStream we'll hand to WebRTC
            const destination = ctx.createMediaStreamDestination();

            // Wire it up: source → gain → destination
            source.connect(gain);
            gain.connect(destination);

            const cleanStream = destination.stream;

            // Set contentHint on the new output tracks
            cleanStream.getAudioTracks().forEach(track => {
                if ('contentHint' in track) {
                    track.contentHint = 'music';
                }
            });

            // Preserve any video tracks from the original stream
            originalStream.getVideoTracks().forEach(vTrack => {
                cleanStream.addTrack(vTrack);
            });

            // If the original stream ends, clean up the AudioContext
            audioTracks.forEach(track => {
                track.addEventListener('ended', () => {
                    console.log(`${TAG} Original track ended, closing AudioContext`);
                    ctx.close().catch(() => {});
                });
            });

            // Store reference for debugging
            if (!window._mgameContexts) window._mgameContexts = [];
            window._mgameContexts.push({ ctx, source, gain, destination, originalStream, cleanStream });

            console.log(`${TAG} ✓ Web Audio bypass created:`, {
                inputTracks: audioTracks.length,
                inputLabel: audioTracks[0].label,
                outputTracks: cleanStream.getAudioTracks().length,
                sampleRate: ctx.sampleRate,
                state: ctx.state,
            });

            // Resume context if suspended (Chrome autoplay policy)
            if (ctx.state === 'suspended') {
                ctx.resume().then(() => {
                    console.log(`${TAG} AudioContext resumed`);
                });
            }

            return cleanStream;

        } catch (err) {
            console.error(`${TAG} Web Audio bypass failed, falling back to constraint-only mode:`, err);
            return originalStream;
        }
    }

    // =========================================================================
    // SECTION 3: Constraint builder
    // =========================================================================

    function buildCleanAudio(existing) {
        const base = (typeof existing === 'object' && existing !== null) ? existing : {};
        const deviceId = base.deviceId;

        const clean = {
            ...W3C_CONSTRAINTS,
            ...OPTIONAL_CONSTRAINTS,
            ...QUALITY_CONSTRAINTS,
            ...GOOG_CONSTRAINTS,
        };

        if (deviceId) clean.deviceId = deviceId;
        return clean;
    }

    // =========================================================================
    // SECTION 4: Track cleaning (belt + suspenders with the bypass)
    // =========================================================================

    function cleanTrack(track) {
        if (track.kind !== 'audio') return;

        console.log(`${TAG} Cleaning track: "${track.label}"`);

        if ('contentHint' in track) {
            track.contentHint = 'music';
        }

        const flat = {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
            ...GOOG_CONSTRAINTS,
        };

        track.applyConstraints(flat)
            .then(() => {
                const s = track.getSettings();
                console.log(`${TAG}   Track settings:`, {
                    echo: s.echoCancellation,
                    agc: s.autoGainControl,
                    noise: s.noiseSuppression,
                    voice: s.voiceIsolation,
                    channels: s.channelCount,
                    rate: s.sampleRate,
                    hint: track.contentHint,
                });
            })
            .catch(err => {
                console.warn(`${TAG}   Constraint fallback:`, err.message);
                track.applyConstraints({
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                }).catch(() => {});
            });
    }

    function cleanStream(stream) {
        if (!stream) return stream;
        stream.getAudioTracks().forEach(cleanTrack);
        stream.addEventListener('addtrack', e => {
            if (e.track.kind === 'audio') cleanTrack(e.track);
        });
        return stream;
    }

    // =========================================================================
    // SECTION 5: Intercepts
    // =========================================================================

    // --- 5a. getUserMedia (main capture point) ---
    const _getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = function (constraints) {
        console.log(`${TAG} getUserMedia intercepted`);

        if (!constraints) constraints = {};
        if (constraints.audio === true) constraints.audio = {};

        if (constraints.audio && typeof constraints.audio === 'object') {
            constraints.audio = buildCleanAudio(constraints.audio);
            console.log(`${TAG}   Constraints modified`);
        }

        return _getUserMedia(constraints).then(originalStream => {
            // Layer 1: Apply constraints to original tracks
            cleanStream(originalStream);

            // Layer 2: Route through Web Audio API bypass
            const cleanedStream = createCleanBypass(originalStream);

            // Store for debugging
            if (!window._mgameStreams) window._mgameStreams = new Set();
            window._mgameStreams.add(cleanedStream);
            window._mgameOriginalStream = originalStream;

            return cleanedStream;
        });
    };

    // --- 5b. applyConstraints (block X from re-enabling processing) ---
    const _applyConstraints = MediaStreamTrack.prototype.applyConstraints;

    MediaStreamTrack.prototype.applyConstraints = function (constraints) {
        if (this.kind === 'audio') {
            console.log(`${TAG} applyConstraints blocked on "${this.label}"`);
            const modified = constraints ? { ...constraints } : {};
            modified.echoCancellation = false;
            modified.autoGainControl = false;
            modified.noiseSuppression = false;
            Object.assign(modified, GOOG_CONSTRAINTS);
            return _applyConstraints.call(this, modified);
        }
        return _applyConstraints.call(this, constraints);
    };

    // --- 5c. RTCPeerConnection.addTrack ---
    if (window.RTCPeerConnection) {
        const _addTrack = RTCPeerConnection.prototype.addTrack;

        RTCPeerConnection.prototype.addTrack = function (track, ...streams) {
            if (track.kind === 'audio') {
                console.log(`${TAG} PeerConnection.addTrack — audio`);
                cleanTrack(track);
            }
            return _addTrack.call(this, track, ...streams);
        };

        // Legacy addStream
        if (RTCPeerConnection.prototype.addStream) {
            const _addStream = RTCPeerConnection.prototype.addStream;
            RTCPeerConnection.prototype.addStream = function (stream) {
                console.log(`${TAG} PeerConnection.addStream`);
                cleanStream(stream);
                return _addStream.call(this, stream);
            };
        }
    }

    // --- 5d. getDisplayMedia ---
    if (navigator.mediaDevices.getDisplayMedia) {
        const _getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia = function (constraints) {
            console.log(`${TAG} getDisplayMedia intercepted`);
            if (constraints?.audio && typeof constraints.audio === 'object') {
                constraints.audio = buildCleanAudio(constraints.audio);
            }
            return _getDisplayMedia(constraints).then(stream => {
                cleanStream(stream);
                return createCleanBypass(stream);
            });
        };
    }

    // =========================================================================
    // SECTION 6: Debug helper — paste mgameStatus() in console anytime
    // =========================================================================
    window.mgameStatus = function () {
        console.group(`${TAG} STATUS REPORT`);

        // Streams
        const streams = window._mgameStreams;
        if (streams && streams.size > 0) {
            streams.forEach(stream => {
                stream.getAudioTracks().forEach(track => {
                    const s = track.getSettings();
                    console.table({
                        label: track.label,
                        hint: track.contentHint,
                        enabled: track.enabled,
                        muted: track.muted,
                        state: track.readyState,
                        echo: s.echoCancellation,
                        agc: s.autoGainControl,
                        noise: s.noiseSuppression,
                        voice: s.voiceIsolation,
                        channels: s.channelCount,
                        rate: s.sampleRate,
                    });
                });
            });
        } else {
            console.log('No active streams');
        }

        // AudioContexts
        const contexts = window._mgameContexts;
        if (contexts && contexts.length > 0) {
            console.log(`AudioContext bypasses: ${contexts.length}`);
            contexts.forEach((c, i) => {
                console.log(`  [${i}] state=${c.ctx.state} rate=${c.ctx.sampleRate}`);
            });
        } else {
            console.log('No Web Audio bypasses active');
        }

        console.groupEnd();
    };

    console.log(`${TAG} All intercepts installed ✓`);
    console.log(`${TAG} Tip: type mgameStatus() in console anytime to check status`);
})();