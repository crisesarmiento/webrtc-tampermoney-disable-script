// ==UserScript==
// @name         M-Game Clean Audio v6.5 (X Spaces + Atlas) - Compressor/Limiter
// @namespace    http://tampermonkey.net/
// @version      6.5
// @description  Disable capture processing + stabilize music hints + safer OPUS SDP + sender bitrate hint + add compressor/limiter for mixed voice+music
// @author       Cris Sarmiento (with Grok fixes)
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[M-Game v6.5]';
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // =============================================================================
  // USER SETTINGS / TUNABLES
  // =============================================================================
  let currentGain = 1.0; // 0.0 - 3.0
  let audioContext = null;
  let activeGainNode = null; // Store for runtime gain updates

  // Dynamics (milder for mixed voice/music: higher threshold, moderate ratio to preserve dynamics)
  const COMP = {
    threshold: -12, // dB (raised from -18 to avoid over-compressing music, still catches voice peaks)
    knee: 12,
    ratio: 3.0, // Gentle for natural sound, avoids pumping/metallic artifacts
    attack: 0.010, // ms (10ms: preserves transients in music/voice)
    release: 0.150, // seconds (150ms: smooth release for streaming)
  };

  const LIMIT = {
    threshold: -3.5,
    knee: 0,
    ratio: 20.0,
    attack: 0.002,
    release: 0.08,
  };

  // Soft clipper (more transparent: higher threshold to minimize volume loss/distortion)
  const ENABLE_SOFT_CLIP = true;
  const SOFT_CLIP_THRESHOLD = 0.9; // Linear below 0.9, subtle saturation above for peaks only

  const ENABLE_SENDER_BITRATE_HINT = true;
  const TARGET_AUDIO_MAX_BITRATE_BPS = 128000; // VBR target for high quality, reduces metallic artifacts

  // =============================================================================
  // CONSTRAINT SETS
  // =============================================================================
  const W3C_AUDIO = {
    echoCancellation: false,
    autoGainControl: false,
    noiseSuppression: false,
  };

  const GOOG_AUDIO = {
    googEchoCancellation: false,
    googAutoGainControl: false,
    googAutoGainControl2: false,
    googNoiseSuppression: false,
    googNoiseSuppression2: false,
    googHighpassFilter: false,
    googTypingNoiseDetection: false,
    googDucking: false,
  };

  // =============================================================================
  // HELPERS
  // =============================================================================
  function ensureAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const resume = () => {
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        window.removeEventListener('pointerdown', resume, true);
        window.removeEventListener('keydown', resume, true);
      };
      window.addEventListener('pointerdown', resume, true);
      window.addEventListener('keydown', resume, true);
    }
    return audioContext;
  }

  function setMusicHint(track) {
    try { if ('contentHint' in track) track.contentHint = 'music'; } catch {}
  }

  function disableProcessing(track) {
    try {
      if (track.kind !== 'audio') return;
      setMusicHint(track);
      if (track.applyConstraints) track.applyConstraints(W3C_AUDIO).catch(() => {});
    } catch {}
  }

  function modifyConstraints(constraints) {
    if (!constraints || !constraints.audio) return constraints;
    if (constraints.audio === true) constraints.audio = {};
    const deviceId = constraints.audio.deviceId;
    Object.assign(constraints.audio, W3C_AUDIO, GOOG_AUDIO);
    if (deviceId) constraints.audio.deviceId = deviceId;
    return constraints;
  }

  // =============================================================================
  // Console commands
  // =============================================================================
  window.mgameGain = function (value) {
    if (value === undefined) return log('Current gain:', currentGain, 'x'), currentGain;
    currentGain = Math.max(0.0, Math.min(3.0, Number(value)));
    if (activeGainNode) activeGainNode.gain.value = currentGain;
    log('Gain set to', currentGain, 'x');
    return currentGain;
  };

  window.mgameStatus = function () { // For debug
    log('Gain:', currentGain, 'x');
    log('Dynamics: ON (milder settings for music/voice)');
    log('AudioContext state:', audioContext?.state || 'none');
    log('PeerConnections:', window.__mgamePCs?.size || 0);
    // TODO: Add compressor/limiter reduction if needed
  };

  // =============================================================================
  // AUDIO GRAPH
  // =============================================================================
  function makeSoftClipper(ctx) {
    const ws = ctx.createWaveShaper();
    const n = 2048;
    const curve = new Float32Array(n);
    const threshold = SOFT_CLIP_THRESHOLD;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      const absX = Math.abs(x);
      if (absX < threshold) {
        curve[i] = x;
      } else {
        const excess = (absX - threshold) / (1 - threshold);
        const clipped = threshold + (1 - threshold) * Math.tanh(excess * 2);
        curve[i] = Math.sign(x) * clipped;
      }
    }
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }

  function buildProcessingChain(ctx, sourceNode) {
    activeGainNode = ctx.createGain();
    activeGainNode.gain.value = currentGain;
    sourceNode.connect(activeGainNode);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = COMP.threshold;
    comp.knee.value = COMP.knee;
    comp.ratio.value = COMP.ratio;
    comp.attack.value = COMP.attack;
    comp.release.value = COMP.release;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMIT.threshold;
    limiter.knee.value = LIMIT.knee;
    limiter.ratio.value = LIMIT.ratio;
    limiter.attack.value = LIMIT.attack;
    limiter.release.value = LIMIT.release;

    activeGainNode.connect(comp);
    comp.connect(limiter);

    let output = limiter;
    if (ENABLE_SOFT_CLIP) {
      const clipper = makeSoftClipper(ctx);
      limiter.connect(clipper);
      output = clipper;
    }

    return { output };
  }

  function replaceFirstAudioTrackWithProcessed(stream) {
    try {
      const tracks = stream.getAudioTracks();
      if (!tracks.length) return stream;

      const ctx = ensureAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const destination = ctx.createMediaStreamDestination();

      const { output } = buildProcessingChain(ctx, source);
      output.connect(destination);

      const processedTrack = destination.stream.getAudioTracks()[0];
      if (!processedTrack) return stream;

      setMusicHint(processedTrack);
      disableProcessing(processedTrack);

      stream.removeTrack(tracks[0]);
      stream.addTrack(processedTrack);

      setTimeout(() => setMusicHint(processedTrack), 250);

      log(`Processing: gain(${currentGain}x) + comp + limit${ENABLE_SOFT_CLIP ? ' + softclip' : ''}`);
      return stream;
    } catch (e) {
      warn('Processing failed:', e.message);
      return stream;
    }
  }

  function processStream(stream) {
    if (!stream) return stream;
    stream.getAudioTracks().forEach(disableProcessing);
    stream = replaceFirstAudioTrackWithProcessed(stream);
    stream.getAudioTracks().forEach(disableProcessing);
    return stream;
  }

  // =============================================================================
  // getUserMedia + applyConstraints
  // =============================================================================
  if (navigator.mediaDevices?.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      log('getUserMedia intercepted');
      return originalGetUserMedia(modifyConstraints(constraints)).then(processStream);
    };
  }

  try {
    const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = function (constraints) {
      if (this.kind === 'audio') {
        constraints = { ...constraints, ...W3C_AUDIO };
      }
      return originalApplyConstraints.call(this, constraints);
    };
  } catch {}

  // =============================================================================
  // SDP MUNGING (OPUS)
  // =============================================================================
  const OPUS_MUSIC_PARAMS = {
    maxplaybackrate: '48000',
    'sprop-maxcapturerate': '48000',
    maxaveragebitrate: String(TARGET_AUDIO_MAX_BITRATE_BPS),
    stereo: '1',
    'sprop-stereo': '1',
    usedtx: '0', // Critical: Disables DTX to prevent cutting quiet music parts
    useinbandfec: '1',
  };

  function optimizeOpusSDP(sdp) {
    if (!sdp) return sdp;
    return sdp.replace(/a=fmtp:(\d+)\s+([^\r\n]+)/g, (match, pt, params) => {
      if (!sdp.includes(`a=rtpmap:${pt} opus/`)) return match;
      const paramMap = Object.fromEntries(params.split(';').map(p => p.trim().split('=')));
      delete paramMap.cbr;
      Object.assign(paramMap, OPUS_MUSIC_PARAMS);
      const newParams = Object.entries(paramMap).map(([k, v]) => v ? `${k}=${v}` : k).join(';');
      return `a=fmtp:${pt} ${newParams}`;
    });
  }

  // =============================================================================
  // PEERCONNECTION + SENDER MANAGEMENT
  // =============================================================================
  function trySetSenderBitrate(sender) {
    if (!ENABLE_SENDER_BITRATE_HINT || !sender || sender.track?.kind !== 'audio') return;
    setMusicHint(sender.track);
    const p = sender.getParameters();
    if (!p || !p.encodings?.[0]) return;
    if (p.encodings[0].maxBitrate !== TARGET_AUDIO_MAX_BITRATE_BPS) {
      p.encodings[0].maxBitrate = TARGET_AUDIO_MAX_BITRATE_BPS;
      sender.setParameters(p).catch(() => {});
    }
  }

  function refreshAudioSenders(pc) {
    pc.getSenders?.().forEach(s => {
      if (s.track?.kind === 'audio') {
        setMusicHint(s.track);
        trySetSenderBitrate(s);
      }
    });
  }

  (function hookPeerConnections() {
    const OriginalPC = window.RTCPeerConnection;
    if (!OriginalPC) return;

    const pcs = new Set();
    window.__mgamePCs = pcs;

    window.RTCPeerConnection = function (...args) {
      const pc = new OriginalPC(...args);
      pcs.add(pc);

      pc.addEventListener('connectionstatechange', () => {
        log('pc.connectionState=', pc.connectionState);
        if (pc.connectionState === 'closed') pcs.delete(pc);
        if (pc.connectionState === 'connected') refreshAudioSenders(pc);
      });

      // Event-driven refresh (instead of interval): On negotiation/track events
      pc.addEventListener('negotiationneeded', () => refreshAudioSenders(pc));
      pc.addEventListener('track', () => refreshAudioSenders(pc));

      const _addTrack = pc.addTrack.bind(pc);
      pc.addTrack = function (...targs) {
        const sender = _addTrack(...targs);
        if (sender?.track?.kind === 'audio') trySetSenderBitrate(sender);
        return sender;
      };

      const _addTransceiver = pc.addTransceiver.bind(pc);
      pc.addTransceiver = function (...targs) {
        const trans = _addTransceiver(...targs);
        if (trans?.sender?.track?.kind === 'audio') trySetSenderBitrate(trans.sender);
        return trans;
      };

      return pc;
    };
    window.RTCPeerConnection.prototype = OriginalPC.prototype;

    // Copy static methods
    Object.keys(OriginalPC).forEach(k => {
      if (!(k in window.RTCPeerConnection)) window.RTCPeerConnection[k] = OriginalPC[k];
    });

    const _setLocalDesc = OriginalPC.prototype.setLocalDescription;
    OriginalPC.prototype.setLocalDescription = function (desc) {
      if (desc?.sdp) desc.sdp = optimizeOpusSDP(desc.sdp);
      return _setLocalDesc.call(this, desc);
    };

    const _setRemoteDesc = OriginalPC.prototype.setRemoteDescription;
    OriginalPC.prototype.setRemoteDescription = function (desc) {
      if (desc?.sdp) desc.sdp = optimizeOpusSDP(desc.sdp);
      return _setRemoteDesc.call(this, desc);
    };

    const _createOffer = OriginalPC.prototype.createOffer;
    OriginalPC.prototype.createOffer = function (options) {
      return _createOffer.call(this, options).then(offer => {
        if (offer?.sdp) offer.sdp = optimizeOpusSDP(offer.sdp);
        return offer;
      });
    };

    const _createAnswer = OriginalPC.prototype.createAnswer;
    OriginalPC.prototype.createAnswer = function (options) {
      return _createAnswer.call(this, options).then(answer => {
        if (answer?.sdp) answer.sdp = optimizeOpusSDP(answer.sdp);
        return answer;
      });
    };

    log('Hooks ready');
  })();

  log('Ready — commands: mgameGain(n), mgameStatus()');
})();