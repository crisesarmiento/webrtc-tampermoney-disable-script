// ==UserScript==
// @name         WebRTC Strict Blocker (Atlas + X)
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  Strictly disables WebRTC constructors and getUserMedia on selected domains.
// @author       Cris Sarmiento
// @match        https://chatgpt.com/*
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '9.0';
  const TAG = '[WebRTC Blocker v9.0]';
  const BLOCK_REASON = 'WebRTC is disabled by the WebRTC Strict Blocker userscript.';

  if (window.__webrtcBlockerV9 && window.__webrtcBlockerV9.installed) {
    console.info(TAG, 'Already installed. Skipping duplicate injection.');
    return;
  }

  const state = {
    installed: true,
    version: VERSION,
    installedAt: new Date().toISOString(),
    blockedTargets: [],
    failedTargets: [],
  };

  window.__webrtcBlockerV9 = state;

  function cloneState() {
    return {
      installed: state.installed,
      version: state.version,
      installedAt: state.installedAt,
      blockedTargets: state.blockedTargets.slice(),
      failedTargets: state.failedTargets.slice(),
    };
  }

  window.webrtcBlockerStatus = function webrtcBlockerStatus() {
    return cloneState();
  };

  function recordBlocked(name) {
    state.blockedTargets.push(name);
  }

  function recordFailure(name, error) {
    state.failedTargets.push({
      target: name,
      reason: String(error && error.message ? error.message : error),
    });
  }

  function defineBlocked(target, key, value, name) {
    if (!target) return false;

    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: false,
        writable: false,
        value,
      });
      recordBlocked(name);
      return true;
    } catch (defineError) {
      try {
        target[key] = value;
        recordBlocked(name);
        return true;
      } catch (assignError) {
        recordFailure(name, assignError || defineError);
        return false;
      }
    }
  }

  function blockedConstructor() {
    throw new Error(BLOCK_REASON);
  }

  function blockedLegacyGetUserMedia(constraints, onSuccess, onError) {
    const error = new Error(BLOCK_REASON);
    if (typeof onError === 'function') {
      try {
        onError(error);
      } catch {
        // no-op
      }
    }
    return Promise.reject(error);
  }

  function blockedModernGetUserMedia() {
    return Promise.reject(new Error(BLOCK_REASON));
  }

  const constructorTargets = [
    ['RTCPeerConnection', window],
    ['mozRTCPeerConnection', window],
    ['webkitRTCPeerConnection', window],
    ['RTCSessionDescription', window],
    ['mozRTCSessionDescription', window],
    ['webkitRTCSessionDescription', window],
  ];

  constructorTargets.forEach(([name, target]) => {
    defineBlocked(target, name, blockedConstructor, `window.${name}`);
  });

  const legacyNavigatorTargets = [
    'getUserMedia',
    'mozGetUserMedia',
    'webkitGetUserMedia',
  ];

  legacyNavigatorTargets.forEach((name) => {
    defineBlocked(
      navigator,
      name,
      blockedLegacyGetUserMedia,
      `navigator.${name}`
    );
  });

  if (navigator.mediaDevices) {
    const blockedDirect = defineBlocked(
      navigator.mediaDevices,
      'getUserMedia',
      blockedModernGetUserMedia,
      'navigator.mediaDevices.getUserMedia'
    );

    if (!blockedDirect) {
      const mediaDevicesPrototype = Object.getPrototypeOf(navigator.mediaDevices);
      defineBlocked(
        mediaDevicesPrototype,
        'getUserMedia',
        blockedModernGetUserMedia,
        'MediaDevices.prototype.getUserMedia'
      );
    }
  } else {
    recordFailure('navigator.mediaDevices', 'mediaDevices is unavailable.');
  }

  console.info(TAG, 'Strict blocking active.', cloneState());
})();
