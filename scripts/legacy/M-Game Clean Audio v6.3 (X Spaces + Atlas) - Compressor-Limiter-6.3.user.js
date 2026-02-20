// ==UserScript==
// @name         M-Game Clean Audio v6.3 (X Spaces + Atlas) - Compressor/Limiter
// @namespace    http://tampermonkey.net/
// @version      6.3
// @description  Disable capture processing + stabilize music hints + safer OPUS SDP + sender bitrate hint + add compressor/limiter for mixed voice+music
// @author       Cris Sarmiento
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[M-Game v6.3]';
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // =============================================================================
  // USER SETTINGS / TUNABLES
  // =============================================================================
  let currentGain = 1.0; // 0.0 - 3.0
  let audioContext = null;

  // Dynamics (for the MIXED signal coming from M-Game: voice + music together)
  const ENABLE_DYNAMICS = true;

  // Gentle compressor for intelligibility (doesn't "pump" too much)
  const COMP = {
    threshold: -18,  // dB
    knee: 12,        // dB
    ratio: 3.0,
    attack: 0.006,   // seconds
    release: 0.18,   // seconds
  };

  // Safety limiter (prevents peaks when you talk over music)
  // WebAudio has no true limiter node; we approximate with a hard compressor + optional soft clip.
  const LIMIT = {
    threshold: -3.5, // dB
    knee: 0,         // dB
    ratio: 20.0,
    attack: 0.002,
    release: 0.08,
  };

  // Soft clipper as last resort (very subtle)
  const ENABLE_SOFT_CLIP = true;
  const SOFT_CLIP_AMOUNT = 0.65; // 0..1 (lower = softer)

  // Best-effort: platform may ignore/clamp
  const ENABLE_SENDER_BITRATE_HINT = true;
  const TARGET_AUDIO_MAX_BITRATE_BPS = 128000; // 128 kbps

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
      // Autoplay policies: try to resume on first user gesture
      const resume = () => {
        if (audioContext && audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
        }
        window.removeEventListener('pointerdown', resume, true);
        window.removeEventListener('keydown', resume, true);
      };
      window.addEventListener('pointerdown', resume, true);
      window.addEventListener('keydown', resume, true);
    }
    return audioContext;
  }

  function setMusicHint(track) {
    try {
      if (track && 'contentHint' in track) track.contentHint = 'music';
    } catch {}
  }

  // Apply constraints carefully; not all tracks allow it, and repeated calls can throw in some browsers.
  function disableProcessing(track) {
    try {
      if (!track || track.kind !== 'audio') return;
      setMusicHint(track);
      if (track.applyConstraints) track.applyConstraints(W3C_AUDIO).catch(() => {});
    } catch {}
  }

  function modifyConstraints(constraints) {
    try {
      if (!constraints) return constraints;
      if (constraints.audio === true) constraints.audio = {};

      if (constraints.audio && typeof constraints.audio === 'object') {
        const deviceId = constraints.audio.deviceId;
        Object.assign(constraints.audio, W3C_AUDIO, GOOG_AUDIO);
        if (deviceId) constraints.audio.deviceId = deviceId;
      }
      return constraints;
    } catch {
      return constraints;
    }
  }

  // =============================================================================
  // Console commands
  // =============================================================================
  window.mgameGain = function (value) {
    if (value === undefined) {
      log('Current gain:', currentGain, 'x');
      return currentGain;
    }
    currentGain = Math.max(0.0, Math.min(3.0, Number(value)));
    log('Gain set to', currentGain, 'x');
    return currentGain;
  };

  // =============================================================================
  // 1) AUDIO GRAPH: Gain + Compressor + Limiter + (optional) Soft Clip
  // =============================================================================
  function makeSoftClipper(ctx, amount = 0.65) {
    const ws = ctx.createWaveShaper();
    // Simple tanh-like curve
    const n = 2048;
    const curve = new Float32Array(n);
    const k = Math.max(0.001, Math.min(0.999, amount));
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1; // -1..1
      // softer for small signals, saturate near 1
      curve[i] = Math.tanh(x / k) * k;
    }
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }

  function buildProcessingChain(ctx, sourceNode) {
    // Input gain (your mgameGain)
    const gain = ctx.createGain();
    gain.gain.value = currentGain;

    sourceNode.connect(gain);

    if (!ENABLE_DYNAMICS) return { output: gain, nodes: { gain } };

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

    gain.connect(comp);
    comp.connect(limiter);

    let output = limiter;
    let clipper = null;
    if (ENABLE_SOFT_CLIP) {
      clipper = makeSoftClipper(ctx, SOFT_CLIP_AMOUNT);
      limiter.connect(clipper);
      output = clipper;
    }

    return { output, nodes: { gain, comp, limiter, clipper } };
  }

  function replaceFirstAudioTrackWithProcessed(stream) {
    try {
      if (!stream) return stream;
      const tracks = stream.getAudioTracks();
      if (!tracks || !tracks.length) return stream;

      const ctx = ensureAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const destination = ctx.createMediaStreamDestination();

      const { output } = buildProcessingChain(ctx, source);
      output.connect(destination);

      const processedTrack = destination.stream.getAudioTracks()[0];
      if (!processedTrack) return stream;

      // carry our intent
      setMusicHint(processedTrack);
      disableProcessing(processedTrack);

      // Replace original audio track inside this MediaStream
      const originalTrack = tracks[0];
      stream.removeTrack(originalTrack);
      stream.addTrack(processedTrack);

      // Re-apply hints shortly after (some frameworks overwrite)
      setTimeout(() => {
        setMusicHint(processedTrack);
        disableProcessing(processedTrack);
      }, 250);

      log(`Audio processing inserted: gain(${currentGain}x) + compressor + limiter${ENABLE_SOFT_CLIP ? ' + softclip' : ''}`);
      return stream;
    } catch (e) {
      warn('Audio processing setup failed, continuing without:', e?.message || e);
      return stream;
    }
  }

  function processStream(stream) {
    if (!stream) return stream;

    // Disable processing on current tracks
    stream.getAudioTracks().forEach(disableProcessing);

    // Insert processing pipeline
    stream = replaceFirstAudioTrackWithProcessed(stream);

    // Disable again on final tracks
    stream.getAudioTracks().forEach(disableProcessing);

    return stream;
  }

  // =============================================================================
  // 2) getUserMedia + applyConstraints PATCHES
  // =============================================================================
  if (navigator.mediaDevices?.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      log('getUserMedia intercepted');
      const modified = modifyConstraints(constraints);
      return originalGetUserMedia(modified).then(processStream);
    };
  }

  // Be conservative here: some sites rely on their own applyConstraints calls.
  // We only overlay W3C_AUDIO when audio track is targeted.
  try {
    const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = function (constraints) {
      try {
        if (this.kind === 'audio') {
          const modified = constraints ? { ...constraints } : {};
          Object.assign(modified, W3C_AUDIO);
          return originalApplyConstraints.call(this, modified);
        }
      } catch {}
      return originalApplyConstraints.call(this, constraints);
    };
  } catch {}

  // =============================================================================
  // 3) SDP MUNGING (OPUS)
  // =============================================================================
  const OPUS_MUSIC_PARAMS = {
    maxplaybackrate: '48000',
    'sprop-maxcapturerate': '48000',
    maxaveragebitrate: String(TARGET_AUDIO_MAX_BITRATE_BPS || 128000),
    stereo: '1',
    'sprop-stereo': '1',
    usedtx: '0',
    useinbandfec: '1',
  };

  function optimizeOpusSDP(sdp) {
    if (!sdp) return sdp;
    try {
      return sdp.replace(/a=fmtp:(\d+)\s+([^\r\n]+)/g, (match, pt, params) => {
        if (!sdp.includes(`a=rtpmap:${pt} opus/`)) return match;

        const paramMap = {};
        params.split(';').forEach((p) => {
          const [k, ...rest] = p.trim().split('=');
          if (!k) return;
          paramMap[k.trim()] = rest.join('=').trim();
        });

        // Prefer VBR
        delete paramMap.cbr;

        Object.assign(paramMap, OPUS_MUSIC_PARAMS);

        const newParams = Object.entries(paramMap)
          .map(([k, v]) => (v !== '' ? `${k}=${v}` : k))
          .join(';');

        return `a=fmtp:${pt} ${newParams}`;
      });
    } catch {
      return sdp;
    }
  }

  // =============================================================================
  // 4) PEERCONNECTION + SENDER MANAGEMENT
  // =============================================================================
  function setMusicHintSafe(track) {
    try { setMusicHint(track); } catch {}
  }

  function trySetSenderBitrate(sender) {
    if (!ENABLE_SENDER_BITRATE_HINT) return;
    if (!sender || sender.track?.kind !== 'audio') return;
    if (!TARGET_AUDIO_MAX_BITRATE_BPS || TARGET_AUDIO_MAX_BITRATE_BPS <= 0) return;

    try {
      setMusicHintSafe(sender.track);

      const p = sender.getParameters?.();
      if (!p) return;

      if (!p.encodings) p.encodings = [{}];
      if (!p.encodings.length) p.encodings.push({});

      p.encodings[0].maxBitrate = TARGET_AUDIO_MAX_BITRATE_BPS;
      sender.setParameters(p).catch(() => {});
    } catch {}
  }

  function refreshAudioSenders(pc) {
    try {
      pc.getSenders?.().forEach((s) => {
        if (s.track?.kind === 'audio') {
          setMusicHintSafe(s.track);
          trySetSenderBitrate(s);
        }
      });
    } catch {}
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
      });

      const periodic = setInterval(() => {
        if (pc.connectionState === 'closed') return clearInterval(periodic);
        if (pc.connectionState === 'connected') refreshAudioSenders(pc);
      }, 2000);

      if (pc.addTrack) {
        const _addTrack = pc.addTrack.bind(pc);
        pc.addTrack = function (...targs) {
          const sender = _addTrack(...targs);
          if (sender?.track?.kind === 'audio') {
            setMusicHintSafe(sender.track);
            trySetSenderBitrate(sender);
          }
          return sender;
        };
      }

      if (pc.addTransceiver) {
        const _addTransceiver = pc.addTransceiver.bind(pc);
        pc.addTransceiver = function (...targs) {
          const trans = _addTransceiver(...targs);
          try {
            if (trans?.sender?.track?.kind === 'audio') {
              setMusicHintSafe(trans.sender.track);
              trySetSenderBitrate(trans.sender);
            }
          } catch {}
          return trans;
        };
      }

      return pc;
    };
    window.RTCPeerConnection.prototype = OriginalPC.prototype;

    try {
      const _setLocalDesc = OriginalPC.prototype.setLocalDescription;
      OriginalPC.prototype.setLocalDescription = function (desc) {
        if (desc?.sdp) desc = { ...desc, sdp: optimizeOpusSDP(desc.sdp) };
        return _setLocalDesc.call(this, desc);
      };

      const _setRemoteDesc = OriginalPC.prototype.setRemoteDescription;
      OriginalPC.prototype.setRemoteDescription = function (desc) {
        if (desc?.sdp) desc = { ...desc, sdp: optimizeOpusSDP(desc.sdp) };
        return _setRemoteDesc.call(this, desc);
      };

      const _createOffer = OriginalPC.prototype.createOffer;
      OriginalPC.prototype.createOffer = function (options) {
        return _createOffer.call(this, options).then((offer) => {
          if (offer?.sdp) offer.sdp = optimizeOpusSDP(offer.sdp);
          return offer;
        });
      };

      const _createAnswer = OriginalPC.prototype.createAnswer;
      OriginalPC.prototype.createAnswer = function (options) {
        return _createAnswer.call(this, options).then((answer) => {
          if (answer?.sdp) answer.sdp = optimizeOpusSDP(answer.sdp);
          return answer;
        });
      };

      log('SDP interception ready');
    } catch {}

    log('PeerConnection hook ready');
  })();

  log('Ready — disable processing + stabilize hints + compressor/limiter');
  log('Commands: mgameGain(n)');
})();