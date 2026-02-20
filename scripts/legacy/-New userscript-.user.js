// ==UserScript==
// @name         M-Game Clean Audio v4
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Disable audio processing + DTX for M-Game music passthrough
// @author       Cris Sarmiento
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const TAG = '[M-Game v4]';
    console.log(`${TAG} Script loaded`);

    // Audio processing flags — same as your original working script
    const CLEAN_AUDIO = {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false
    };

    // =========================================================================
    // 1. Disable audio processing (your original v1 logic — this was working)
    // =========================================================================

    function disableProcessing(track) {
        if (track.kind !== 'audio') return;
        console.log(`${TAG} Processing track: ${track.label}`);

        if ('contentHint' in track) {
            track.contentHint = 'music';
        }

        track.applyConstraints(CLEAN_AUDIO).then(() => {
            const s = track.getSettings();
            console.log(`${TAG} Settings:`, {
                echo: s.echoCancellation,
                agc: s.autoGainControl,
                noise: s.noiseSuppression,
                rate: s.sampleRate
            });
        }).catch(err => {
            console.warn(`${TAG} Constraint error:`, err.message);
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

    function modifyConstraints(constraints) {
        if (!constraints) return constraints;
        if (constraints.audio === true) {
            constraints.audio = {};
        }
        if (constraints.audio && typeof constraints.audio === 'object') {
            const deviceId = constraints.audio.deviceId;
            Object.assign(constraints.audio, CLEAN_AUDIO);
            if (deviceId) constraints.audio.deviceId = deviceId;
        }
        return constraints;
    }

    // Intercept getUserMedia
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function(constraints) {
        console.log(`${TAG} getUserMedia called`);
        const modified = modifyConstraints(constraints);
        return originalGetUserMedia(modified).then(processStream);
    };

    // Intercept applyConstraints
    const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = function(constraints) {
        if (this.kind === 'audio') {
            const modified = constraints ? { ...constraints } : {};
            Object.assign(modified, CLEAN_AUDIO);
            return originalApplyConstraints.call(this, modified);
        }
        return originalApplyConstraints.call(this, constraints);
    };

    // =========================================================================
    // 2. SDP munging — ONLY change: disable DTX (fixes music cutting)
    //
    // DTX = Discontinuous Transmission. The Opus encoder detects "no voice"
    // in music and stops sending packets. usedtx=0 keeps it always sending.
    // =========================================================================

    function disableDTX(sdp) {
        if (!sdp) return sdp;

        return sdp.replace(
            /a=fmtp:(\d+)\s+([^\r\n]+)/g,
            (match, pt, params) => {
                // Only modify if this payload type is Opus
                if (!sdp.includes(`a=rtpmap:${pt} opus/`)) return match;

                console.log(`${TAG} SDP original fmtp: ${params}`);

                // Remove existing usedtx if present, then add usedtx=0
                let newParams = params
                    .split(';')
                    .filter(p => !p.trim().startsWith('usedtx'))
                    .join(';');

                newParams += ';usedtx=0';

                console.log(`${TAG} SDP munged  fmtp: ${newParams}`);
                return `a=fmtp:${pt} ${newParams}`;
            }
        );
    }

    // Intercept SDP negotiation
    if (window.RTCPeerConnection) {
        const _setLocalDesc = RTCPeerConnection.prototype.setLocalDescription;
        RTCPeerConnection.prototype.setLocalDescription = function(desc) {
            if (desc && desc.sdp) {
                desc = { ...desc, sdp: disableDTX(desc.sdp) };
            }
            return _setLocalDesc.call(this, desc);
        };

        const _setRemoteDesc = RTCPeerConnection.prototype.setRemoteDescription;
        RTCPeerConnection.prototype.setRemoteDescription = function(desc) {
            if (desc && desc.sdp) {
                desc = { ...desc, sdp: disableDTX(desc.sdp) };
            }
            return _setRemoteDesc.call(this, desc);
        };

        const _createOffer = RTCPeerConnection.prototype.createOffer;
        RTCPeerConnection.prototype.createOffer = function(options) {
            return _createOffer.call(this, options).then(offer => {
                if (offer && offer.sdp) offer.sdp = disableDTX(offer.sdp);
                return offer;
            });
        };

        const _createAnswer = RTCPeerConnection.prototype.createAnswer;
        RTCPeerConnection.prototype.createAnswer = function(options) {
            return _createAnswer.call(this, options).then(answer => {
                if (answer && answer.sdp) answer.sdp = disableDTX(answer.sdp);
                return answer;
            });
        };
    }

    console.log(`${TAG} Ready — processing disabled + DTX disabled`);
})();