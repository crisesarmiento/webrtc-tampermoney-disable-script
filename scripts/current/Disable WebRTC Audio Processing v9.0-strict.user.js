// ==UserScript==
// @name         Disable WebRTC Audio Processing v9.0 Strict Blocker
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  Standalone strict blocker that disables browser-side WebRTC voice processing in getUserMedia/applyConstraints paths.
// @author       Cris Sarmiento
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[WebRTC Blocker v9.0]';
  const W3C_AUDIO_FLAGS = {
    autoGainControl: false,
    echoCancellation: false,
    noiseSuppression: false,
  };
  const GOOG_AUDIO_FLAGS = {
    googAutoGainControl: false,
    googAutoGainControl2: false,
    googEchoCancellation: false,
    googExperimentalAutoGainControl: false,
    googExperimentalEchoCancellation: false,
    googExperimentalNoiseSuppression: false,
    googHighpassFilter: false,
    googNoiseSuppression: false,
    googNoiseSuppression2: false,
    googNoiseReduction: false,
    googTypingNoiseDetection: false,
  };

  const log = (...args) => console.log(TAG, ...args);
  const warn = (...args) => console.warn(TAG, ...args);

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    warn('navigator.mediaDevices.getUserMedia is unavailable; strict blocker not installed.');
    return;
  }

  const safeClone = (value) => {
    try {
      return structuredClone(value);
    } catch {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return value;
      }
    }
  };

  const supports = (() => {
    try {
      return navigator.mediaDevices.getSupportedConstraints?.() || {};
    } catch {
      return {};
    }
  })();

  function normalizeAudioRequest(audio) {
    if (audio === true) return {};
    if (audio === false || audio == null) return null;
    if (typeof audio !== 'object') return {};
    return audio;
  }

  function applyStrictAudioFlags(audioConfig) {
    const next = { ...audioConfig, ...W3C_AUDIO_FLAGS, ...GOOG_AUDIO_FLAGS };
    if (supports.voiceIsolation) next.voiceIsolation = false;
    return next;
  }

  function hardenConstraints(constraints) {
    const next = safeClone(constraints) || {};
    const audio = normalizeAudioRequest(next.audio);
    if (audio === null) return next;
    next.audio = applyStrictAudioFlags(audio);
    return next;
  }

  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = function patchedGetUserMedia(constraints) {
    const hardened = hardenConstraints(constraints);
    log('getUserMedia intercepted.', { requested: constraints, hardened });
    return originalGetUserMedia(hardened);
  };

  const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
  MediaStreamTrack.prototype.applyConstraints = function patchedApplyConstraints(constraints) {
    if (this?.kind !== 'audio') {
      return originalApplyConstraints.call(this, constraints);
    }

    const hardened = applyStrictAudioFlags(safeClone(constraints) || {});
    log('applyConstraints intercepted for audio track.', { requested: constraints, hardened });
    return originalApplyConstraints.call(this, hardened);
  };

  window.webrtcBlockerV9Status = () => ({
    installed: true,
    version: '9.0',
    tag: TAG,
    audioFlags: { ...W3C_AUDIO_FLAGS, ...GOOG_AUDIO_FLAGS, voiceIsolation: supports.voiceIsolation ? false : 'unsupported' },
  });

  log('Installed strict blocker globally.');
})();
