// ==UserScript==
// @name         Disable WebRTC Audio Processing Globally
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Forces noiseSuppression, echoCancellation, autoGainControl to false
// @author       Chesmar-Engineer
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;

    function disableAudioProcessing(constraints) {
        if (!constraints) return constraints;

        if (constraints.audio === true) {
            constraints.audio = {};
        }

        if (constraints.audio && typeof constraints.audio === 'object') {
            // Use ideal instead of exact to avoid OverconstrainedError
            constraints.audio.autoGainControl = false;
            constraints.audio.echoCancellation = false;
            constraints.audio.noiseSuppression = false;

            // Only set these if supported and you really need them
            if (navigator.mediaDevices.getSupportedConstraints().voiceIsolation) {
                constraints.audio.voiceIsolation = false;
            }

            console.log("[Audio Override] Modified constraints:", constraints.audio);
        }

        return constraints;
    }

    navigator.mediaDevices.getUserMedia = function(constraints) {
        console.log("[Audio Override] Original constraints:", JSON.stringify(constraints));
        constraints = disableAudioProcessing(constraints);
        return originalGetUserMedia(constraints);
    };

    MediaStreamTrack.prototype.applyConstraints = function(constraints) {
        console.log("[Audio Override] applyConstraints intercepted");
        if (constraints) {
            constraints.autoGainControl = false;
            constraints.echoCancellation = false;
            constraints.noiseSuppression = false;
        }
        return originalApplyConstraints.call(this, constraints);
    };

    console.log('[Audio Override] WebRTC audio processing disabled');
})();