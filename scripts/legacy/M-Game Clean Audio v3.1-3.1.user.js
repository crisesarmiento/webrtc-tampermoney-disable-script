// ==UserScript==
// @name         M-Game Clean Audio v3.1
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Bulletproof WebRTC audio for RØDE M-Game — Web Audio bypass + SDP munging (anti-DTX)
// @author       Cris Sarmiento
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[M-Game v3.1]';
    const SAMPLE_RATE = 48000;

    console.log(`${TAG} Clean Audio v3.1 loaded`);

    // =========================================================================
    // SECTION 1: Constraint definitions
    // =========================================================================

    const W3C_CONSTRAINTS = {
        echoCancellation: { exact: false },
        autoGainControl: { exact: false },
        noiseSuppression: { exact: false },
    };

    const QUALITY_CONSTRAINTS = {
        channelCount: { ideal: 2 },
        sampleRate: { ideal: SAMPLE_RATE },
        sampleSize: { ideal: 24 },
        latency: { ideal: 0.01 },
    };

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

    const OPTIONAL_CONSTRAINTS = {
        voiceIsolation: false,
    };

    // =========================================================================
    // SECTION 2: SDP Munging — THE KEY FIX FOR AUDIO CUTTING
    //
    // The Opus encoder inside WebRTC has its own Voice Activity Detection (VAD)
    // that classifies music as "silence" and activates DTX (Discontinuous
    // Transmission), which stops sending packets. This causes the "cutting"
    // that listeners hear.
    //
    // We fix this by modifying the SDP (Session Description Protocol) to:
    //   - usedtx=0      → Disable DTX, always send packets
    //   - stereo=1       → Enable stereo encoding
    //   - sprop-stereo=1 → Signal stereo to the receiver
    //   - maxaveragebitrate=510000 → Max Opus bitrate (music needs bandwidth)
    //   - cbr=1          → Constant bitrate (prevents drops during "quiet" parts)
    //   - maxplaybackrate=48000 → Full frequency range
    //   - ptime=20       → 20ms frames (good balance of latency vs efficiency)
    // =========================================================================

    /**
     * Munge the SDP to configure Opus for music instead of voice.
     */
    function mungeSDPForMusic(sdp) {
        if (!sdp) return sdp;

        const lines = sdp.split('\r\n');
        const mungedLines = [];
        let opusPayloadType = null;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Find the Opus payload type from rtpmap
            // e.g., "a=rtpmap:111 opus/48000/2"
            const rtpmapMatch = line.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2/i);
            if (rtpmapMatch) {
                opusPayloadType = rtpmapMatch[1];
                console.log(`${TAG} SDP: Found Opus payload type: ${opusPayloadType}`);
            }

            // Modify the fmtp line for Opus
            // e.g., "a=fmtp:111 minptime=10;useinbandfec=1"
            if (opusPayloadType && line.startsWith(`a=fmtp:${opusPayloadType} `)) {
                console.log(`${TAG} SDP: Original fmtp: ${line}`);

                // Parameters we want to force for music
                const musicParams = {
                    'usedtx': '0',              // CRITICAL: Disable DTX
                    'stereo': '1',              // Enable stereo
                    'sprop-stereo': '1',        // Signal stereo capability
                    'maxaveragebitrate': '510000', // Max Opus bitrate
                    'cbr': '1',                 // Constant bitrate — no drops
                    'maxplaybackrate': '48000', // Full sample rate
                    'minptime': '10',           // Min packet time
                };

                // Parse existing fmtp params
                const fmtpPrefix = `a=fmtp:${opusPayloadType} `;
                let paramStr = line.substring(fmtpPrefix.length);
                const existingParams = {};

                paramStr.split(';').forEach(p => {
                    const [key, val] = p.split('=');
                    if (key) existingParams[key.trim()] = val ? val.trim() : '';
                });

                // Merge: our music params override existing ones
                const merged = { ...existingParams, ...musicParams };

                // Keep useinbandfec if it was there (good for packet loss recovery)
                if (!merged['useinbandfec']) {
                    merged['useinbandfec'] = '1';
                }

                // Reconstruct the fmtp line
                const newParamStr = Object.entries(merged)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(';');

                line = `${fmtpPrefix}${newParamStr}`;
                console.log(`${TAG} SDP: Munged  fmtp: ${line}`);
            }

            mungedLines.push(line);
        }

        return mungedLines.join('\r\n');
    }

    // =========================================================================
    // SECTION 3: Web Audio API bypass (from v3)
    // =========================================================================

    function createCleanBypass(originalStream) {
        const audioTracks = originalStream.getAudioTracks();
        if (audioTracks.length === 0) return originalStream;

        try {
            const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
            const source = ctx.createMediaStreamSource(originalStream);
            const gain = ctx.createGain();
            gain.gain.value = 1.0;
            const destination = ctx.createMediaStreamDestination();

            source.connect(gain);
            gain.connect(destination);

            const cleanStream = destination.stream;

            cleanStream.getAudioTracks().forEach(track => {
                if ('contentHint' in track) track.contentHint = 'music';
            });

            originalStream.getVideoTracks().forEach(vTrack => {
                cleanStream.addTrack(vTrack);
            });

            audioTracks.forEach(track => {
                track.addEventListener('ended', () => {
                    ctx.close().catch(() => {});
                });
            });

            if (!window._mgameContexts) window._mgameContexts = [];
            window._mgameContexts.push({ ctx, source, gain, destination, originalStream, cleanStream });

            console.log(`${TAG} Web Audio bypass created:`, {
                input: audioTracks[0].label,
                sampleRate: ctx.sampleRate,
                state: ctx.state,
            });

            if (ctx.state === 'suspended') {
                ctx.resume().then(() => console.log(`${TAG} AudioContext resumed`));
            }

            return cleanStream;

        } catch (err) {
            console.error(`${TAG} Web Audio bypass failed:`, err);
            return originalStream;
        }
    }

    // =========================================================================
    // SECTION 4: Constraint helpers
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

    function cleanTrack(track) {
        if (track.kind !== 'audio') return;
        console.log(`${TAG} Cleaning track: "${track.label}"`);
        if ('contentHint' in track) track.contentHint = 'music';

        track.applyConstraints({
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
            ...GOOG_CONSTRAINTS,
        }).catch(err => {
            console.warn(`${TAG} Constraint fallback:`, err.message);
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

    // --- 5a. getUserMedia ---
    const _getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = function (constraints) {
        console.log(`${TAG} getUserMedia intercepted`);
        if (!constraints) constraints = {};
        if (constraints.audio === true) constraints.audio = {};

        if (constraints.audio && typeof constraints.audio === 'object') {
            constraints.audio = buildCleanAudio(constraints.audio);
        }

        return _getUserMedia(constraints).then(originalStream => {
            cleanStream(originalStream);
            const cleanedStream = createCleanBypass(originalStream);
            if (!window._mgameStreams) window._mgameStreams = new Set();
            window._mgameStreams.add(cleanedStream);
            window._mgameOriginalStream = originalStream;
            return cleanedStream;
        });
    };

    // --- 5b. applyConstraints ---
    const _applyConstraints = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = function (constraints) {
        if (this.kind === 'audio') {
            console.log(`${TAG} applyConstraints blocked`);
            const modified = constraints ? { ...constraints } : {};
            modified.echoCancellation = false;
            modified.autoGainControl = false;
            modified.noiseSuppression = false;
            Object.assign(modified, GOOG_CONSTRAINTS);
            return _applyConstraints.call(this, modified);
        }
        return _applyConstraints.call(this, constraints);
    };

    // --- 5c. RTCPeerConnection — SDP munging + track cleaning ---
    if (window.RTCPeerConnection) {

        // Intercept setLocalDescription to munge outgoing SDP
        const _setLocalDescription = RTCPeerConnection.prototype.setLocalDescription;
        RTCPeerConnection.prototype.setLocalDescription = function (desc) {
            if (desc && desc.sdp) {
                console.log(`${TAG} setLocalDescription — munging SDP`);
                desc = { ...desc, sdp: mungeSDPForMusic(desc.sdp) };
            }
            return _setLocalDescription.call(this, desc);
        };

        // Intercept setRemoteDescription to munge incoming SDP
        const _setRemoteDescription = RTCPeerConnection.prototype.setRemoteDescription;
        RTCPeerConnection.prototype.setRemoteDescription = function (desc) {
            if (desc && desc.sdp) {
                console.log(`${TAG} setRemoteDescription — munging SDP`);
                desc = { ...desc, sdp: mungeSDPForMusic(desc.sdp) };
            }
            return _setRemoteDescription.call(this, desc);
        };

        // Intercept createOffer to munge before it's even used
        const _createOffer = RTCPeerConnection.prototype.createOffer;
        RTCPeerConnection.prototype.createOffer = function (options) {
            return _createOffer.call(this, options).then(offer => {
                if (offer && offer.sdp) {
                    console.log(`${TAG} createOffer — munging SDP`);
                    offer.sdp = mungeSDPForMusic(offer.sdp);
                }
                return offer;
            });
        };

        // Intercept createAnswer too
        const _createAnswer = RTCPeerConnection.prototype.createAnswer;
        RTCPeerConnection.prototype.createAnswer = function (options) {
            return _createAnswer.call(this, options).then(answer => {
                if (answer && answer.sdp) {
                    console.log(`${TAG} createAnswer — munging SDP`);
                    answer.sdp = mungeSDPForMusic(answer.sdp);
                }
                return answer;
            });
        };

        // Track cleaning on addTrack
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
    // SECTION 6: Debug helper
    // =========================================================================
    window.mgameStatus = function () {
        console.group(`${TAG} STATUS REPORT`);

        // Streams
        const streams = window._mgameStreams;
        if (streams && streams.size > 0) {
            console.log('--- Active Streams ---');
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
            console.log(`--- AudioContext Bypasses: ${contexts.length} ---`);
            contexts.forEach((c, i) => {
                console.log(`  [${i}] state=${c.ctx.state} rate=${c.ctx.sampleRate}`);
            });
        }

        // SDP check — find active peer connections
        console.log('--- SDP Check ---');
        console.log('To verify SDP munging, open chrome://webrtc-internals');
        console.log('Look for: usedtx=0, stereo=1, cbr=1, maxaveragebitrate=510000');

        console.groupEnd();
    };

    // =========================================================================
    // SECTION 7: SDP verification helper
    // =========================================================================
    window.mgameCheckSDP = function () {
        console.group(`${TAG} SDP VERIFICATION`);
        console.log('Open chrome://webrtc-internals in a new tab');
        console.log('Find the active PeerConnection and expand "SDP"');
        console.log('');
        console.log('In the LOCAL SDP, look for the Opus fmtp line:');
        console.log('  a=fmtp:111 usedtx=0;stereo=1;cbr=1;maxaveragebitrate=510000;...');
        console.log('');
        console.log('If usedtx=1 or is missing → DTX is ON (music will cut)');
        console.log('If usedtx=0 → DTX is OFF (music should flow continuously)');
        console.log('If cbr=1 → Constant bitrate (no drops during quiet parts)');
        console.log('If stereo=1 → Stereo encoding active');
        console.groupEnd();
    };

    console.log(`${TAG} All intercepts installed ✓`);
    console.log(`${TAG} Now includes: constraints + Web Audio bypass + SDP munging`);
    console.log(`${TAG} Tip: mgameStatus() for status, mgameCheckSDP() for SDP verification`);
})();