// ==UserScript==
// @name         M-Game Clean Audio v11 DEBUG (Atlas + X)
// @namespace    http://tampermonkey.net/
// @version      11.0
// @description  Minimal music-first WebRTC hardener: disable browser audio post-processing constraints only
// @author       Cris Sarmiento
// @match        https://x.com/*
// @match        https://*.x.com/*
// @match        https://twitter.com/*
// @match        https://*.twitter.com/*
// @match        https://chatgpt.com/*
// @match        https://twimg.com/*
// @match        https://*.twimg.com/*
// @match        https://pbs.twimg.com/*
// @match        https://video.twimg.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const INSTALL_FLAG = '__mgameV11DebugInstalled';
  const TAG = '[M-Game DEBUG]';

  if (window[INSTALL_FLAG]) {
    return;
  }
  window[INSTALL_FLAG] = true;
  console.log('[M-Game DEBUG] ✅ v11 DEBUG script loaded and active');

  const W3C_DISABLED = Object.freeze({
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  });

  const GOOG_DISABLED = Object.freeze({
    googEchoCancellation: false,
    googEchoCancellation2: false,
    googAutoGainControl: false,
    googAutoGainControl2: false,
    googNoiseSuppression: false,
    googNoiseSuppression2: false,
    googHighpassFilter: false,
    googResidualEchoDetector: false,
    googBeamforming: false,
    googTypingNoiseDetection: false,
    googDucking: false,
    googNoiseReduction: false,
    googAudioMirroring: false,
    googExperimentalAutoGainControl: false,
    googExperimentalNoiseSuppression: false,
    googExperimentalEchoCancellation: false,
  });

  function supportsVoiceIsolation() {
    try {
      return Boolean(navigator.mediaDevices?.getSupportedConstraints?.().voiceIsolation);
    } catch {
      return false;
    }
  }

  const disableVoiceIsolation = supportsVoiceIsolation();

  function hardenConstraintObject(value) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    const hardened = {
      ...value,
      ...W3C_DISABLED,
      ...GOOG_DISABLED,
    };

    if (disableVoiceIsolation) {
      hardened.voiceIsolation = false;
    }

    return hardened;
  }

  function hardenNestedAudioPaths(audioConstraints) {
    if (!audioConstraints || typeof audioConstraints !== 'object') {
      return audioConstraints;
    }

    const hardenedAudio = hardenConstraintObject(audioConstraints);

    if (Array.isArray(audioConstraints.advanced)) {
      hardenedAudio.advanced = audioConstraints.advanced.map((entry) => hardenConstraintObject(entry));
    }

    if (audioConstraints.mandatory && typeof audioConstraints.mandatory === 'object') {
      hardenedAudio.mandatory = hardenConstraintObject(audioConstraints.mandatory);
    }

    if (Array.isArray(audioConstraints.optional)) {
      hardenedAudio.optional = audioConstraints.optional.map((entry) => hardenConstraintObject(entry));
    }

    return hardenedAudio;
  }

  function hardenGetUserMediaConstraints(constraints) {
    if (!constraints || typeof constraints !== 'object') {
      return constraints;
    }

    const hardenedConstraints = { ...constraints };
    const hasAudio = Object.prototype.hasOwnProperty.call(hardenedConstraints, 'audio');

    if (!hasAudio) {
      return hardenedConstraints;
    }

    if (hardenedConstraints.audio === false) {
      return hardenedConstraints;
    }

    if (hardenedConstraints.audio === true || typeof hardenedConstraints.audio === 'undefined') {
      hardenedConstraints.audio = hardenNestedAudioPaths({});
      return hardenedConstraints;
    }

    if (hardenedConstraints.audio && typeof hardenedConstraints.audio === 'object') {
      hardenedConstraints.audio = hardenNestedAudioPaths(hardenedConstraints.audio);
    }

    return hardenedConstraints;
  }

  const mediaDevices = navigator.mediaDevices;
  if (mediaDevices && typeof mediaDevices.getUserMedia === 'function') {
    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);

    try {
      mediaDevices.getUserMedia = function patchedGetUserMedia(constraints) {
        console.log('[M-Game DEBUG] getUserMedia requested constraints:', JSON.stringify(constraints, null, 2));
        const hardenedConstraints = hardenGetUserMediaConstraints(constraints);
        console.log('[M-Game DEBUG] getUserMedia hardened constraints:', JSON.stringify(hardenedConstraints, null, 2));
        return originalGetUserMedia(hardenedConstraints);
      };
    } catch (error) {
      console.warn(TAG, 'Failed to patch getUserMedia:', error);
    }
  }

  if (typeof window.MediaStreamTrack === 'function' && typeof MediaStreamTrack.prototype.applyConstraints === 'function') {
    const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;

    try {
      MediaStreamTrack.prototype.applyConstraints = function patchedApplyConstraints(constraints) {
        if (this && this.kind === 'audio') {
          console.log('[M-Game DEBUG] 🔧 applyConstraints called on audio track - constraints:', JSON.stringify(constraints, null, 2));
          const normalized =
            constraints && typeof constraints === 'object'
              ? hardenNestedAudioPaths(constraints)
              : hardenNestedAudioPaths({});

          return originalApplyConstraints.call(this, normalized);
        }

        return originalApplyConstraints.call(this, constraints);
      };
    } catch (error) {
      console.warn(TAG, 'Failed to patch applyConstraints:', error);
    }
  }

  console.info(TAG, 'Installed minimal WebRTC constraints hardener.');
})();
