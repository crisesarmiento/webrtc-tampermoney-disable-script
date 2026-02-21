// ==UserScript==
// @name         M-Game Clean Audio v2
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Disable all WebRTC audio processing for RØDE M-Game (music/samples passthrough)
// @author       Cris Sarmiento
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[M-Game]';
    console.log(`${TAG} Clean Audio v2 loaded`);

    // =========================================================================
    // Standard W3C constraints (all modern browsers)
    // =========================================================================
    const CLEAN_CONSTRAINTS = {
        echoCancellation: { exact: false }, // {exact:} = mandatory, not just a hint
        autoGainControl: { exact: false },
        noiseSuppression: { exact: false },
    };

    // Optional standard constraints (may not be supported everywhere)
    const OPTIONAL_CONSTRAINTS = {
        voiceIsolation: false, // Chrome 116+, won't break older
    };

    // Quality constraints for music passthrough
    const QUALITY_CONSTRAINTS = {
        channelCount: { ideal: 2 }, // Preserve stereo from M-Game
        sampleRate: { ideal: 48000 }, // M-Game native rate
        sampleSize: { ideal: 24 }, // Higher bit depth
        latency: { ideal: 0.01 }, // Low latency
    };

    // =========================================================================
    // Legacy Chrome-specific constraints (goog* prefixed)
    // Chrome's internal audio pipeline checks these independently.
    // Some processing stages only respect the legacy flags.
    // =========================================================================
    const GOOG_CONSTRAINTS = {
        googEchoCancellation: false,
        googAutoGainControl: false,
        googAutoGainControl2: false,
        googNoiseSuppression: false,
        googNoiseSuppression2: false,
        googHighpassFilter: false, // Cuts bass — kills music
        googTypingNoiseDetection: false,
        googAudioMirroring: false,
        googExperimentalAutoGainControl: false,
        googExperimentalNoiseSuppression: false,
        googExperimentalEchoCancellation: false,
        googDucking: false, // Audio ducking — lowers volume when voice detected
        googNoiseReduction: false,
    };

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Build the full set of audio constraints, preserving deviceId if present.
     */
    function buildCleanAudio(existing) {
        const base = (typeof existing === 'object' && existing !== null) ? existing : {};
        const deviceId = base.deviceId;

        const clean = {
            ...CLEAN_CONSTRAINTS,
            ...OPTIONAL_CONSTRAINTS,
            ...QUALITY_CONSTRAINTS,
            ...GOOG_CONSTRAINTS,
        };

        // Preserve the device selection (important: M-Game must stay selected)
        if (deviceId) {
            clean.deviceId = deviceId;
        }

        return clean;
    }

    /**
     * Apply clean settings to an existing audio track.
     */
    function cleanTrack(track) {
        if (track.kind !== 'audio') return;

        console.log(`${TAG} Cleaning audio track: "${track.label}"`);

        // Set content hint to "music" — tells the encoder to optimize for
        // full-range audio instead of voice (higher bitrate, wider frequency range)
        if ('contentHint' in track) {
            track.contentHint = 'music';
            console.log(`${TAG}   contentHint → "music"`);
        }

        // Apply flat constraints (no {exact:} wrapper for applyConstraints)
        const flat = {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
            channelCount: 2,
            sampleRate: 48000,
            ...GOOG_CONSTRAINTS,
        };

        track.applyConstraints(flat)
            .then(() => {
                const s = track.getSettings();
                console.log(`${TAG}   Settings applied:`, {
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
                // Some constraints may not be supported — that's OK, log and move on
                console.warn(`${TAG}   applyConstraints partial failure:`, err.message);
                // Retry with just the essentials
                track.applyConstraints({
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                }).catch(() => {});
            });
    }

    /**
     * Process all audio tracks in a stream + watch for new ones.
     */
    function cleanStream(stream) {
        if (!stream) return stream;
        console.log(`${TAG} Processing stream (${stream.getAudioTracks().length} audio tracks)`);

        stream.getAudioTracks().forEach(cleanTrack);
        stream.addEventListener('addtrack', (e) => {
            if (e.track.kind === 'audio') cleanTrack(e.track);
        });

        return stream;
    }

    // =========================================================================
    // 1. Intercept getUserMedia — the main capture point
    // =========================================================================
    const _getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = function (constraints) {
        console.log(`${TAG} getUserMedia intercepted`);

        if (!constraints) constraints = {};

        // Normalize: audio: true → audio: {}
        if (constraints.audio === true) {
            constraints.audio = {};
        }

        if (constraints.audio && typeof constraints.audio === 'object') {
            constraints.audio = buildCleanAudio(constraints.audio);
            console.log(`${TAG}   Modified audio constraints:`, constraints.audio);
        }

        return _getUserMedia(constraints).then(stream => {
            // Track for monitoring
            if (!window._mgameStreams) window._mgameStreams = new Set();
            window._mgameStreams.add(stream);
            return cleanStream(stream);
        });
    };

    // =========================================================================
    // 2. Intercept applyConstraints — prevent X from re-enabling processing
    // =========================================================================
    const _applyConstraints = MediaStreamTrack.prototype.applyConstraints;

    MediaStreamTrack.prototype.applyConstraints = function (constraints) {
        if (this.kind === 'audio') {
            console.log(`${TAG} applyConstraints intercepted on "${this.label}"`);
            const modified = constraints ? { ...constraints } : {};

            // Force processing OFF regardless of what X tries to set
            modified.echoCancellation = false;
            modified.autoGainControl = false;
            modified.noiseSuppression = false;
            Object.assign(modified, GOOG_CONSTRAINTS);

            return _applyConstraints.call(this, modified);
        }
        return _applyConstraints.call(this, constraints);
    };

    // =========================================================================
    // 3. Intercept RTCPeerConnection — catch processing at the connection level
    //    X Spaces may configure audio processing via RTCRtpSender parameters
    // =========================================================================
    if (window.RTCPeerConnection) {
        const _addTrack = RTCPeerConnection.prototype.addTrack;

        RTCPeerConnection.prototype.addTrack = function (track, ...streams) {
            if (track.kind === 'audio') {
                console.log(`${TAG} RTCPeerConnection.addTrack intercepted for audio`);
                cleanTrack(track);
            }
            return _addTrack.call(this, track, ...streams);
        };

        // Also intercept addStream (legacy API, some sites still use it)
        if (RTCPeerConnection.prototype.addStream) {
            const _addStream = RTCPeerConnection.prototype.addStream;

            RTCPeerConnection.prototype.addStream = function (stream) {
                console.log(`${TAG} RTCPeerConnection.addStream intercepted`);
                cleanStream(stream);
                return _addStream.call(this, stream);
            };
        }
    }

    // =========================================================================
    // 4. Intercept getDisplayMedia — in case screen/tab audio capture is used
    // =========================================================================
    if (navigator.mediaDevices.getDisplayMedia) {
        const _getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

        navigator.mediaDevices.getDisplayMedia = function (constraints) {
            console.log(`${TAG} getDisplayMedia intercepted`);
            if (constraints?.audio && typeof constraints.audio === 'object') {
                constraints.audio = buildCleanAudio(constraints.audio);
            }
            return _getDisplayMedia(constraints).then(cleanStream);
        };
    }

    // =========================================================================
    // 5. Periodic check — catch tracks that slip through (race conditions)
    // =========================================================================
    let monitorInterval = null;
    const processedTracks = new WeakSet();

    function monitorTracks() {
        // Look for any audio elements or tracks that might have been created
        // outside our intercepts
        if (window._mgameStreams) {
            window._mgameStreams.forEach(stream => {
                stream.getAudioTracks().forEach(track => {
                    if (!processedTracks.has(track)) {
                        console.log(`${TAG} Monitor caught unprocessed track: "${track.label}"`);
                        cleanTrack(track);
                        processedTracks.add(track);
                    }
                });
            });
        }
    }

    // Start monitor after page load
    window.addEventListener('load', () => {
        monitorInterval = setInterval(monitorTracks, 3000);
        console.log(`${TAG} Track monitor started (every 3s)`);
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        if (monitorInterval) clearInterval(monitorInterval);
    });

    console.log(`${TAG} All intercepts installed — audio processing blocker ready ✓`);
})();