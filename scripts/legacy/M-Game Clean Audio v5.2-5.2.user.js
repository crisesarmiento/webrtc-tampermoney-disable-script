// ==UserScript==
// @name         M-Game Clean Audio v5.2
// @namespace    http://tampermonkey.net/
// @version      5.2
// @description  Disable all audio processing + force fullband Opus (CELT mode) for music
// @author       Cris Sarmiento
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const TAG = '[M-Game v5.2]';
    console.log(`${TAG} Script loaded`);

    // =========================================================================
    // GAIN CONTROL — adjustable output volume for listeners
    //
    // Since we disabled all AGC (correct for music quality), the raw M-Game
    // signal level goes through unmodified. This gain lets you fine-tune the
    // output volume without re-enabling any destructive processing.
    //
    // Usage from console:
    //   mgameGain(1.0)  — default, no change
    //   mgameGain(1.5)  — boost 50% (if listeners say it's too quiet)
    //   mgameGain(0.7)  — reduce 30% (if listeners say it's too loud/clipping)
    //   mgameGain()     — show current value
    // =========================================================================

    let currentGain = 1.0;
    let gainNode = null;
    let audioContext = null;

    window.mgameGain = function(value) {
        if (value === undefined) {
            console.log(`${TAG} Current gain: ${currentGain}x`);
            return currentGain;
        }
        currentGain = Math.max(0.0, Math.min(3.0, value)); // clamp 0-3x
        if (gainNode) {
            gainNode.gain.value = currentGain;
            console.log(`${TAG} Gain updated to ${currentGain}x`);
        } else {
            console.log(`${TAG} Gain set to ${currentGain}x (will apply when stream starts)`);
        }
        return currentGain;
    };

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
    // applyConstraints() silently ignores these
    const GOOG_AUDIO = {
        googEchoCancellation: false,     // Chrome's internal AEC
        googAutoGainControl: false,      // Primary AGC
        googAutoGainControl2: false,     // Secondary AGC (dynamics compression)
        googNoiseSuppression: false,     // Primary noise gate
        googNoiseSuppression2: false,    // Secondary noise gate
        googHighpassFilter: false,       // Cuts below ~300Hz — kills bass
        googTypingNoiseDetection: false, // Keyboard noise filter
        googDucking: false,              // Lowers audio when voice detected
    };

    // =========================================================================
    // 1. Track processing — applied AFTER stream is captured
    // =========================================================================

    function disableProcessing(track) {
        if (track.kind !== 'audio') return;
        console.log(`${TAG} Processing audio track: ${track.label}`);

        // contentHint='music' tells Chrome to use OPUS_APPLICATION_AUDIO
        // instead of OPUS_APPLICATION_VOIP, which prefers CELT (fullband)
        // over SILK (narrowband voice)
        if ('contentHint' in track) {
            track.contentHint = 'music';
            console.log(`${TAG} contentHint set to 'music'`);
        }

        track.applyConstraints(W3C_AUDIO).then(() => {
            const s = track.getSettings();
            console.log(`${TAG} Track settings:`, {
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

        // Apply constraint disabling on all audio tracks
        stream.getAudioTracks().forEach(disableProcessing);
        stream.addEventListener('addtrack', e => {
            if (e.track.kind === 'audio') disableProcessing(e.track);
        });

        // Insert GainNode into the audio pipeline if gain != 1.0
        // or always insert it so mgameGain() works live during a session
        try {
            if (!audioContext) {
                audioContext = new AudioContext();
            }
            const source = audioContext.createMediaStreamSource(stream);
            gainNode = audioContext.createGain();
            gainNode.gain.value = currentGain;
            const destination = audioContext.createMediaStreamDestination();

            source.connect(gainNode);
            gainNode.connect(destination);

            // Copy the gain-processed track back, preserving the original stream's ID
            const processedTrack = destination.stream.getAudioTracks()[0];

            // Apply contentHint on the processed track too
            if ('contentHint' in processedTrack) {
                processedTrack.contentHint = 'music';
            }

            // Replace the original audio track with our gain-controlled one
            const originalTrack = stream.getAudioTracks()[0];
            if (originalTrack) {
                stream.removeTrack(originalTrack);
                stream.addTrack(processedTrack);
                console.log(`${TAG} GainNode inserted (${currentGain}x) — use mgameGain(n) to adjust`);
            }
        } catch (err) {
            console.warn(`${TAG} GainNode setup failed, proceeding without:`, err.message);
        }

        return stream;
    }

    // =========================================================================
    // 2. getUserMedia interception — where goog* flags ACTUALLY work
    // =========================================================================

    function modifyConstraints(constraints) {
        if (!constraints) return constraints;

        if (constraints.audio === true) {
            constraints.audio = {};
        }

        if (constraints.audio && typeof constraints.audio === 'object') {
            const deviceId = constraints.audio.deviceId;
            Object.assign(constraints.audio, W3C_AUDIO, GOOG_AUDIO);
            if (deviceId) constraints.audio.deviceId = deviceId;
            console.log(`${TAG} getUserMedia constraints applied`);
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
    // 4. SDP munging — force fullband Opus for music
    //
    //   maxplaybackrate=48000  → fullband playback (anti-tin-can)
    //   sprop-maxcapturerate=48000  → fullband capture
    //   maxaveragebitrate=128000  → 128kbps (4x default ~32kbps)
    //   stereo=1 / sprop-stereo=1  → prevent mono downmix
    //   usedtx=0  → allow CELT mode (music codec)
    //   useinbandfec=1  → packet loss recovery
    //
    // v5.2 CHANGE: REMOVED cbr=1
    //   CBR forces fixed bits per frame. Music has huge dynamic range —
    //   a cymbal crash needs far more bits than a quiet passage.
    //   With CBR at 128kbps, complex passages get starved of bits and
    //   the encoder squashes them → perceived as volume ducking or
    //   "too compressed" sound.
    //   VBR (default, cbr=0) lets the encoder use ~200kbps on loud/complex
    //   parts and ~60kbps on quiet parts, maintaining consistent PERCEIVED
    //   quality. Per Hydrogenaudio: "CBR requires 8% more bitrate for the
    //   same quality" as VBR. For music, VBR is strictly better.
    //
    // =========================================================================

    const OPUS_MUSIC_PARAMS = {
        // Fullband operation (anti-tin-can)
        maxplaybackrate: '48000',
        'sprop-maxcapturerate': '48000',

        // Quality — VBR with 128kbps average target
        maxaveragebitrate: '128000',
        // cbr deliberately NOT set (defaults to 0 = VBR)
        // VBR allocates more bits to complex passages, fewer to quiet ones
        // This preserves dynamic range instead of squashing everything flat

        // Stereo (anti-phase-cancellation)
        stereo: '1',
        'sprop-stereo': '1',

        // Codec mode (allow CELT instead of forcing SILK)
        usedtx: '0',

        // Error recovery
        useinbandfec: '1',
    };

    function optimizeOpusSDP(sdp) {
        if (!sdp) return sdp;

        return sdp.replace(
            /a=fmtp:(\d+)\s+([^\r\n]+)/g,
            (match, pt, params) => {
                // Only modify Opus codec lines
                if (!sdp.includes(`a=rtpmap:${pt} opus/`)) return match;

                console.log(`${TAG} SDP BEFORE: a=fmtp:${pt} ${params}`);

                // Parse existing params into a map
                const paramMap = {};
                params.split(';').forEach(p => {
                    const [key, ...rest] = p.trim().split('=');
                    if (key) paramMap[key.trim()] = rest.join('=').trim();
                });

                // Remove cbr if X Spaces set it (force VBR)
                delete paramMap['cbr'];

                // Override with our music params
                Object.assign(paramMap, OPUS_MUSIC_PARAMS);

                // Rebuild the fmtp line
                const newParams = Object.entries(paramMap)
                    .map(([k, v]) => v !== '' ? `${k}=${v}` : k)
                    .join(';');

                console.log(`${TAG} SDP AFTER:  a=fmtp:${pt} ${newParams}`);
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
    // 6. Debug helpers
    // =========================================================================

    window.mgameStatus = function() {
        console.log(`\n${TAG} === STATUS ===`);
        console.log(`${TAG} Version: 5.2`);
        console.log(`${TAG} Gain: ${currentGain}x (GainNode ${gainNode ? 'active' : 'pending'})`);
        console.log(`${TAG} W3C constraints:`, W3C_AUDIO);
        console.log(`${TAG} Goog constraints:`, GOOG_AUDIO);
        console.log(`${TAG} SDP music params:`, OPUS_MUSIC_PARAMS);
        console.log(`${TAG} CBR: disabled (VBR for better dynamic range)`);
        console.log(`${TAG} ===============\n`);
    };

    console.log(`${TAG} Ready — fullband Opus (VBR) + all processing disabled`);
    console.log(`${TAG} mgameStatus() = config | mgameGain(n) = volume (0.0-3.0)`);
})();