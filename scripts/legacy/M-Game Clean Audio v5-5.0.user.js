// ==UserScript==
// @name         M-Game Clean Audio v5
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Disable all audio processing + optimize Opus for music passthrough
// @author       Cris Sarmiento
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const TAG = '[M-Game v5]';
    console.log(`${TAG} Script loaded`);

    // =========================================================================
    // CONSTRAINT SETS — separated because they work at different levels
    // =========================================================================

    // W3C standard constraints — work with both getUserMedia AND applyConstraints
    const W3C_AUDIO = {
        echoCancellation: false,   // Master switch: should disable all processing
        autoGainControl: false,    // Prevents volume compression/pumping
        noiseSuppression: false,   // Prevents gating/muffling of music
    };

    // Chrome-specific constraints — ONLY work at getUserMedia() capture time
    // applyConstraints() silently ignores these, so they must NOT be relied on there
    //
    // Why both W3C + goog?
    // Per Chromium engineers: echoCancellation:false SHOULD disable everything.
    // Per real-world reports (SO#29936416, W3C#457): it doesn't always.
    // The goog flags give us explicit control over each processing stage.
    const GOOG_AUDIO = {
        googEchoCancellation: false,     // Chrome's internal AEC
        googAutoGainControl: false,      // Primary AGC
        googAutoGainControl2: false,     // Secondary AGC (dynamics compression)
        googNoiseSuppression: false,     // Primary noise gate
        googNoiseSuppression2: false,    // Secondary noise gate (muffles audio)
        googHighpassFilter: false,       // Cuts below ~300Hz — kills bass
        googTypingNoiseDetection: false, // Keyboard noise filter
        googDucking: false,              // Lowers audio when voice is detected
    };

    // =========================================================================
    // 1. Track processing — applied AFTER stream is captured
    //    Only uses W3C params (goog* don't work in applyConstraints)
    // =========================================================================

    function disableProcessing(track) {
        if (track.kind !== 'audio') return;
        console.log(`${TAG} Processing audio track: ${track.label}`);

        // contentHint='music' tells the encoder to optimize for full-range audio
        // In Chrome, this signals preference for CELT mode over SILK (voice) mode
        if ('contentHint' in track) {
            track.contentHint = 'music';
            console.log(`${TAG} contentHint set to 'music'`);
        }

        // Apply W3C-only constraints (blocks X from re-enabling processing)
        track.applyConstraints(W3C_AUDIO).then(() => {
            const s = track.getSettings();
            console.log(`${TAG} Track settings after apply:`, {
                echo: s.echoCancellation,
                agc: s.autoGainControl,
                noise: s.noiseSuppression,
                rate: s.sampleRate,
                channels: s.channelCount,
            });
        }).catch(err => {
            console.warn(`${TAG} applyConstraints error:`, err.message);
        });
    }

    function processStream(stream) {
        if (!stream) return stream;
        stream.getAudioTracks().forEach(disableProcessing);
        stream.addEventListener('addtrack', e => {
            if (e.track.kind === 'audio') disableProcessing(e.track);
        });
        return stream;
    }

    // =========================================================================
    // 2. getUserMedia interception — where goog* flags ACTUALLY work
    //    Both W3C + goog are set here at capture time
    // =========================================================================

    function modifyConstraints(constraints) {
        if (!constraints) return constraints;

        if (constraints.audio === true) {
            constraints.audio = {};
        }

        if (constraints.audio && typeof constraints.audio === 'object') {
            // Preserve deviceId (M-Game device selection)
            const deviceId = constraints.audio.deviceId;

            // Apply ALL constraints at capture time
            Object.assign(constraints.audio, W3C_AUDIO, GOOG_AUDIO);

            // Restore deviceId if it existed
            if (deviceId) constraints.audio.deviceId = deviceId;

            console.log(`${TAG} getUserMedia constraints:`, JSON.stringify(constraints.audio, null, 2));
        }

        return constraints;
    }

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function(constraints) {
        console.log(`${TAG} getUserMedia intercepted`);
        const modified = modifyConstraints(constraints);
        return originalGetUserMedia(modified).then(processStream);
    };

    // =========================================================================
    // 3. applyConstraints interception — blocks X from re-enabling processing
    //    ONLY uses W3C params (goog* would be silently ignored here anyway)
    // =========================================================================

    const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = function(constraints) {
        if (this.kind === 'audio') {
            const modified = constraints ? { ...constraints } : {};
            Object.assign(modified, W3C_AUDIO);
            console.log(`${TAG} applyConstraints intercepted — forced W3C audio off`);
            return originalApplyConstraints.call(this, modified);
        }
        return originalApplyConstraints.call(this, constraints);
    };

    // =========================================================================
    // 4. SDP munging — optimize Opus codec for music
    //
    // What each parameter does:
    //   usedtx=0      — Disables Discontinuous Transmission. DTX uses VAD
    //                    (Voice Activity Detection) to stop sending packets when
    //                    it doesn't detect voice patterns. Music triggers this
    //                    constantly because it lacks speech characteristics.
    //                    BONUS: usedtx=1 forces SILK mode (voice). usedtx=0
    //                    allows CELT mode (music), which handles full-range
    //                    audio much better.
    //
    //   stereo=1       — Tells the decoder it can receive stereo. Without this,
    //                    Chrome mono-downmixes the audio, which causes phase
    //                    cancellation artifacts (the "two phones" sound).
    //
    //   sprop-stereo=1 — Tells the encoder to SEND stereo. Both stereo params
    //                    must be in both local and remote SDP for stereo to work
    //                    (confirmed in WebRTC bug tracker issues/41481053).
    //
    //   maxaveragebitrate=128000 — 128kbps is good quality for music.
    //                    Default voice bitrate is ~32kbps. We tried 510kbps in
    //                    v3 and X Spaces rejected it. 128k is safe and sounds
    //                    noticeably better than default.
    // =========================================================================

    const OPUS_MUSIC_PARAMS = {
        usedtx: '0',
        stereo: '1',
        'sprop-stereo': '1',
        maxaveragebitrate: '128000',
    };

    function optimizeOpusSDP(sdp) {
        if (!sdp) return sdp;

        return sdp.replace(
            /a=fmtp:(\d+)\s+([^\r\n]+)/g,
            (match, pt, params) => {
                // Only modify Opus codec lines
                if (!sdp.includes(`a=rtpmap:${pt} opus/`)) return match;

                console.log(`${TAG} SDP original fmtp: ${params}`);

                // Parse existing params into a map
                const paramMap = {};
                params.split(';').forEach(p => {
                    const [key, ...rest] = p.trim().split('=');
                    if (key) paramMap[key.trim()] = rest.join('=').trim();
                });

                // Override with our music params
                Object.assign(paramMap, OPUS_MUSIC_PARAMS);

                // Rebuild the fmtp line
                const newParams = Object.entries(paramMap)
                    .map(([k, v]) => v !== '' ? `${k}=${v}` : k)
                    .join(';');

                console.log(`${TAG} SDP munged  fmtp: ${newParams}`);
                return `a=fmtp:${pt} ${newParams}`;
            }
        );
    }

    // =========================================================================
    // 5. RTCPeerConnection SDP interception
    // =========================================================================

    if (window.RTCPeerConnection) {
        const _setLocalDesc = RTCPeerConnection.prototype.setLocalDescription;
        RTCPeerConnection.prototype.setLocalDescription = function(desc) {
            if (desc && desc.sdp) {
                desc = { ...desc, sdp: optimizeOpusSDP(desc.sdp) };
            }
            return _setLocalDesc.call(this, desc);
        };

        const _setRemoteDesc = RTCPeerConnection.prototype.setRemoteDescription;
        RTCPeerConnection.prototype.setRemoteDescription = function(desc) {
            if (desc && desc.sdp) {
                desc = { ...desc, sdp: optimizeOpusSDP(desc.sdp) };
            }
            return _setRemoteDesc.call(this, desc);
        };

        const _createOffer = RTCPeerConnection.prototype.createOffer;
        RTCPeerConnection.prototype.createOffer = function(options) {
            return _createOffer.call(this, options).then(offer => {
                if (offer && offer.sdp) offer.sdp = optimizeOpusSDP(offer.sdp);
                return offer;
            });
        };

        const _createAnswer = RTCPeerConnection.prototype.createAnswer;
        RTCPeerConnection.prototype.createAnswer = function(options) {
            return _createAnswer.call(this, options).then(answer => {
                if (answer && answer.sdp) answer.sdp = optimizeOpusSDP(answer.sdp);
                return answer;
            });
        };

        console.log(`${TAG} SDP interception ready`);
    }

    // =========================================================================
    // 6. Debug helper — run mgameStatus() in console to check state
    // =========================================================================

    window.mgameStatus = function() {
        console.log(`\n${TAG} === STATUS ===`);

        // Check active audio tracks
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices.enumerateDevices().then(devices => {
                const audioInputs = devices.filter(d => d.kind === 'audioinput');
                console.log(`${TAG} Audio inputs:`, audioInputs.map(d => d.label || d.deviceId));
            });
        }

        console.log(`${TAG} W3C constraints:`, W3C_AUDIO);
        console.log(`${TAG} Goog constraints:`, GOOG_AUDIO);
        console.log(`${TAG} SDP music params:`, OPUS_MUSIC_PARAMS);
        console.log(`${TAG} ===============\n`);
    };

    console.log(`${TAG} Ready — all processing disabled + Opus optimized for music`);
    console.log(`${TAG} Run mgameStatus() in console for diagnostics`);
})();