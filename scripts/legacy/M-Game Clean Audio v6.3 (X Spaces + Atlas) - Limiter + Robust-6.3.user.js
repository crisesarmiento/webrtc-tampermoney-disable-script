// ==UserScript==
// @name         M-Game Clean Audio v6.3 (X Spaces + Atlas) - Limiter + Robust
// @namespace    http://tampermonkey.net/
// @version      6.3
// @description  Disable capture processing + stabilize music hints + safer sender bitrate hints + Opus SDP tweaks + Gain + Limiter/Leveler + robust stats/inspect for X Spaces (Atlas-friendly)
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
  const MGAME = {
    gain: 1.0, // 0.0 - 3.0

    // Limiter / leveler (DynamicsCompressorNode used as a limiter-ish stage)
    limiterEnabled: true,

    // "Voice + Music" preset (default): keeps voice consistent, tames peaks.
    // Adjust live via mgameLimiter({...})
    limiter: {
      threshold: -16, // dB
      knee: 6,        // dB (soft knee to sound more natural)
      ratio: 8,       // 8:1 feels limiter-like without being too brickwall
      attack: 0.003,  // seconds
      release: 0.25,  // seconds
      makeup: 1.0,    // extra post gain (keep 1.0 unless you know you need it)
    },

    // Best-effort bitrate hint (platform may ignore/clamp)
    senderBitrateHintEnabled: true,
    targetAudioMaxBitrateBps: 128000, // 128kbps

    // Keep processing-disabling constraints enabled
    disableCaptureProcessing: true,

    // If true, sets contentHint='music' on outbound processed track/sender tracks.
    // (It's a hint, not guaranteed.)  [oai_citation:2‡w3c.github.io](https://w3c.github.io/mst-content-hint/)
    setMusicContentHint: true,

    // Debug
    verbose: false,
  };

  // =============================================================================
  // CONSTRAINT SETS
  // =============================================================================
  const W3C_AUDIO = {
    echoCancellation: false,
    autoGainControl: false,
    noiseSuppression: false,
  };

  // Legacy-ish Chrome flags (may be ignored). Only useful at getUserMedia time.
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
  // AUDIO GRAPH STATE
  // =============================================================================
  let audioContext = null;
  let gainNode = null;
  let limiterNode = null;   // DynamicsCompressorNode
  let makeupGainNode = null;

  function ensureAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (MGAME.verbose) log('AudioContext created:', audioContext.state);
    }
    return audioContext;
  }

  async function resumeAudioContextIfNeeded() {
    try {
      const ctx = ensureAudioContext();
      if (ctx.state === 'suspended') {
        // getUserMedia typically happens after a user gesture; resume often succeeds here.
        await ctx.resume();
        if (MGAME.verbose) log('AudioContext resumed');
      }
    } catch (e) {
      // Non-fatal; the graph can still be created but may stay silent until resumed.
      if (MGAME.verbose) warn('AudioContext resume failed:', e?.message || e);
    }
  }

  function setContentHint(track, hint) {
    try {
      if (track && 'contentHint' in track) track.contentHint = hint;
    } catch {}
  }

  function setMusicHint(track) {
    if (!MGAME.setMusicContentHint) return;
    setContentHint(track, 'music');
  }

  function disableProcessing(track) {
    try {
      if (!MGAME.disableCaptureProcessing) return;
      if (!track || track.kind !== 'audio') return;

      // Hint first (best-effort)
      setMusicHint(track);

      // Apply W3C constraints only (goog* are only meaningful at getUserMedia time)
      track.applyConstraints(W3C_AUDIO).catch(() => {});
    } catch {}
  }

  function modifyConstraints(constraints) {
    try {
      if (!constraints) return constraints;

      // Don’t mutate caller object
      const c = typeof constraints === 'object' ? structuredClone(constraints) : constraints;
      if (c.audio === true) c.audio = {};

      if (c.audio && typeof c.audio === 'object') {
        // Preserve deviceId if present (can be string or object with exact/ideal)
        const deviceId = c.audio.deviceId;

        // Preserve other potentially-important fields if set by the app
        const preserved = {
          sampleRate: c.audio.sampleRate,
          sampleSize: c.audio.sampleSize,
          channelCount: c.audio.channelCount,
          latency: c.audio.latency,
        };

        Object.assign(c.audio, W3C_AUDIO, GOOG_AUDIO);

        if (deviceId !== undefined) c.audio.deviceId = deviceId;
        Object.entries(preserved).forEach(([k, v]) => {
          if (v !== undefined) c.audio[k] = v;
        });
      }
      return c;
    } catch {
      return constraints;
    }
  }

  // =============================================================================
  // PUBLIC CONTROLS
  // =============================================================================
  window.mgameGain = function (value) {
    if (value === undefined) {
      log('Current gain:', MGAME.gain, 'x');
      return MGAME.gain;
    }
    MGAME.gain = Math.max(0.0, Math.min(3.0, Number(value)));
    if (gainNode) gainNode.gain.value = MGAME.gain;
    log('Gain set to', MGAME.gain, 'x');
    return MGAME.gain;
  };

  window.mgameLimiterEnabled = function (enabled) {
    if (enabled === undefined) {
      log('Limiter enabled:', MGAME.limiterEnabled);
      return MGAME.limiterEnabled;
    }
    MGAME.limiterEnabled = !!enabled;
    if (limiterNode) limiterNode.threshold.value = MGAME.limiterEnabled ? MGAME.limiter.threshold : 0; // not true bypass, but reduces effect
    log('Limiter enabled set to', MGAME.limiterEnabled);
    return MGAME.limiterEnabled;
  };

  // Update limiter params live
  window.mgameLimiter = function (opts = {}) {
    MGAME.limiter = { ...MGAME.limiter, ...opts };

    if (limiterNode) {
      limiterNode.threshold.value = MGAME.limiter.threshold;
      limiterNode.knee.value = MGAME.limiter.knee;
      limiterNode.ratio.value = MGAME.limiter.ratio;
      limiterNode.attack.value = MGAME.limiter.attack;
      limiterNode.release.value = MGAME.limiter.release;
    }
    if (makeupGainNode) makeupGainNode.gain.value = MGAME.limiter.makeup ?? 1.0;

    log('Limiter updated:', { ...MGAME.limiter });
    return { ...MGAME.limiter };
  };

  // Presets
  window.mgamePreset = function (name) {
    const n = String(name || '').toLowerCase();
    if (n === 'voice') {
      // Stronger leveling for speech-only
      window.mgameLimiter({
        threshold: -20,
        knee: 6,
        ratio: 10,
        attack: 0.002,
        release: 0.20,
        makeup: 1.0,
      });
      log('Preset applied: voice');
      return;
    }
    // default: voice+music
    window.mgameLimiter({
      threshold: -16,
      knee: 6,
      ratio: 8,
      attack: 0.003,
      release: 0.25,
      makeup: 1.0,
    });
    log('Preset applied: voice+music');
  };

  window.mgameStatus = function () {
    console.log(`\n${TAG} === STATUS ===`);
    console.log(`${TAG} Version: 6.3`);
    console.log(`${TAG} Gain: ${MGAME.gain}x (GainNode ${gainNode ? 'active' : 'pending'})`);
    console.log(`${TAG} Limiter: ${MGAME.limiterEnabled ? 'enabled' : 'disabled'} (Node ${limiterNode ? 'active' : 'pending'})`);
    console.log(`${TAG} Limiter params:`, MGAME.limiter);
    console.log(`${TAG} Sender bitrate hint: ${MGAME.senderBitrateHintEnabled ? MGAME.targetAudioMaxBitrateBps + ' bps' : 'disabled'}`);
    console.log(`${TAG} Capture processing disable: ${MGAME.disableCaptureProcessing}`);
    console.log(`${TAG} W3C constraints:`, W3C_AUDIO);
    console.log(`${TAG} Goog constraints:`, GOOG_AUDIO);
    console.log(`${TAG} SDP music params:`, OPUS_MUSIC_PARAMS);
    console.log(`${TAG} WebRTC hook: ${window.__mgamePCs ? 'active' : 'pending'}`);
    console.log(`${TAG} AudioContext: ${audioContext ? audioContext.state : 'not created'}`);
    console.log(`${TAG} ===============\n`);
  };

  // =============================================================================
  // STREAM PROCESSING (GAIN + LIMITER)
  // =============================================================================
  function buildGraph(ctx, sourceNode) {
    // Create nodes (or reuse if already created)
    if (!gainNode) {
      gainNode = ctx.createGain();
      gainNode.gain.value = MGAME.gain;
    } else {
      gainNode.gain.value = MGAME.gain;
    }

    if (!limiterNode) {
      limiterNode = ctx.createDynamicsCompressor();
      // DynamicsCompressorNode is defined by Web Audio; params are standard.  [oai_citation:3‡W3C](https://www.w3.org/TR/2018/CR-webaudio-20180918/?utm_source=chatgpt.com)
    }
    limiterNode.threshold.value = MGAME.limiter.threshold;
    limiterNode.knee.value = MGAME.limiter.knee;
    limiterNode.ratio.value = MGAME.limiter.ratio;
    limiterNode.attack.value = MGAME.limiter.attack;
    limiterNode.release.value = MGAME.limiter.release;

    if (!makeupGainNode) {
      makeupGainNode = ctx.createGain();
    }
    makeupGainNode.gain.value = MGAME.limiter.makeup ?? 1.0;

    // Disconnect safely (avoid connecting twice)
    try { sourceNode.disconnect(); } catch {}
    try { gainNode.disconnect(); } catch {}
    try { limiterNode.disconnect(); } catch {}
    try { makeupGainNode.disconnect(); } catch {}

    // Wire: source -> gain -> (limiter?) -> makeup
    sourceNode.connect(gainNode);

    if (MGAME.limiterEnabled) {
      gainNode.connect(limiterNode);
      limiterNode.connect(makeupGainNode);
    } else {
      gainNode.connect(makeupGainNode);
    }

    return makeupGainNode;
  }

  function processStream(stream) {
    if (!stream) return stream;

    try {
      // Disable processing on current tracks (best-effort)
      stream.getAudioTracks().forEach(disableProcessing);

      const tracks = stream.getAudioTracks();
      if (!tracks || !tracks.length) return stream;

      const ctx = ensureAudioContext();
      // Best-effort: resume. If it fails, graph may be silent until a later resume.
      resumeAudioContextIfNeeded();

      const source = ctx.createMediaStreamSource(stream);
      const tail = buildGraph(ctx, source);
      const destination = ctx.createMediaStreamDestination();
      tail.connect(destination);

      const processedTrack = destination.stream.getAudioTracks()[0];
      const originalTrack = tracks[0];

      // Track intent + processing disable on the outbound track too
      setMusicHint(processedTrack);
      disableProcessing(processedTrack);

      // Ensure stopping processed track also stops original mic
      const _stop = processedTrack.stop.bind(processedTrack);
      processedTrack.stop = function () {
        try { originalTrack.stop?.(); } catch {}
        try { _stop(); } catch {}
      };

      // Replace track in the same stream object (most apps accept this fine)
      stream.removeTrack(originalTrack);
      stream.addTrack(processedTrack);

      // Re-apply after a tick (some apps overwrite hints/constraints)
      setTimeout(() => {
        setMusicHint(processedTrack);
        disableProcessing(processedTrack);
      }, 250);

      log(`Graph inserted: gain(${MGAME.gain}x) + limiter(${MGAME.limiterEnabled ? 'on' : 'off'}) — cmds: mgameGain(n), mgameLimiter({...}), mgamePreset('voice'|'voice+music')`);
      return stream;
    } catch (e) {
      warn('Stream processing failed, continuing without:', e?.message || e);
      return stream;
    }
  }

  // =============================================================================
  // getUserMedia + applyConstraints PATCHES
  // =============================================================================
  if (navigator.mediaDevices?.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      if (MGAME.verbose) log('getUserMedia intercepted');
      const modified = modifyConstraints(constraints);
      return originalGetUserMedia(modified).then(processStream);
    };
  }

  // Keep applyConstraints override, but don’t overreach.
  try {
    const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = function (constraints) {
      if (this.kind === 'audio' && MGAME.disableCaptureProcessing) {
        const modified = constraints ? { ...constraints } : {};
        Object.assign(modified, W3C_AUDIO);
        return originalApplyConstraints.call(this, modified);
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
    maxaveragebitrate: String(MGAME.targetAudioMaxBitrateBps || 128000),
    stereo: '1',
    'sprop-stereo': '1',
    usedtx: '0',
    useinbandfec: '1',
  };

  function optimizeOpusSDP(sdp) {
    if (!sdp) return sdp;
    try {
      return sdp.replace(/a=fmtp:(\d+)\s+([^\r\n]+)/g, (match, pt, params) => {
        // Only touch Opus PTs
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
  // PEERCONNECTION + SENDER MANAGEMENT
  // =============================================================================
  function trySetSenderBitrate(sender) {
    if (!MGAME.senderBitrateHintEnabled) return;
    if (!sender || sender.track?.kind !== 'audio') return;
    if (!MGAME.targetAudioMaxBitrateBps || MGAME.targetAudioMaxBitrateBps <= 0) return;

    try {
      setMusicHint(sender.track);

      const p = sender.getParameters?.();
      if (!p) return;

      if (!p.encodings) p.encodings = [{}];
      if (!p.encodings.length) p.encodings.push({});

      p.encodings[0].maxBitrate = MGAME.targetAudioMaxBitrateBps;

      sender.setParameters(p).catch(() => {});
    } catch {}
  }

  function refreshAudioSenders(pc) {
    try {
      pc.getSenders?.().forEach((s) => {
        if (s.track?.kind === 'audio') {
          setMusicHint(s.track);
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
        if (MGAME.verbose) log('pc.connectionState=', pc.connectionState);
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
            setMusicHint(sender.track);
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
              setMusicHint(trans.sender.track);
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

    // =============================================================================
    // DIAGNOSTICS
    // =============================================================================
    window.mgameInspect = function () {
      const list = [...pcs].filter((pc) => pc && pc.connectionState !== 'closed');
      log('Inspecting PCs:', list.length);

      list.forEach((pc, i) => {
        console.log(`\n${TAG} --- PC #${i} state=${pc.connectionState} ---`);

        try {
          pc.getTransceivers?.().forEach((t) => {
            const hasAudio = t?.sender?.track?.kind === 'audio' || t?.receiver?.track?.kind === 'audio';
            if (!hasAudio) return;
            console.log(`${TAG} transceiver mid=${t.mid} direction=${t.direction} current=${t.currentDirection}`);
            console.log(`${TAG} senderTrack=${t.sender?.track?.label || '(none)'} receiverTrack=${t.receiver?.track?.label || '(none)'}`);
          });
        } catch {}

        try {
          pc.getSenders?.().forEach((s) => {
            if (s.track?.kind !== 'audio') return;
            const p = s.getParameters?.();
            console.log(`${TAG} Audio track label:`, s.track.label);
            console.log(`${TAG} Audio track settings:`, s.track.getSettings?.());
            console.log(`${TAG} Audio track contentHint:`, s.track.contentHint);
            console.log(`${TAG} Sender codec[0]:`, p?.codecs?.[0]);
            console.log(`${TAG} Sender encoding[0]:`, p?.encodings?.[0]);
          });
        } catch {}
      });
    };

    window.mgameStats = async function (intervalMs = 2000) {
      const list = [...pcs].filter((pc) => pc && pc.connectionState !== 'closed');
      if (!list.length) {
        log('No active PeerConnections found.');
        return;
      }

      log(`Tracking ${list.length} PeerConnection(s).`);
      const last = new Map(); // key: pcIndex:ssrc -> {t, bytes}

      while (true) {
        for (let i = 0; i < list.length; i++) {
          const pc = list[i];
          let stats;
          try {
            stats = await pc.getStats();
          } catch {
            continue;
          }

          const outbound = [];
          let opusCodec = null;

          stats.forEach((r) => {
            const isAudio = (r.kind === 'audio' || r.mediaType === 'audio');
            if (r.type === 'outbound-rtp' && isAudio && !r.isRemote) outbound.push(r);
            if (r.type === 'codec' && r.mimeType && r.mimeType.toLowerCase().includes('audio/opus')) opusCodec = r;
          });

          if (!outbound.length) {
            console.log(`${TAG} PC#${i}: no outbound audio RTP yet (not publishing?)`);
            continue;
          }

          outbound.sort((a, b) => (b.bytesSent || 0) - (a.bytesSent || 0));
          const r = outbound[0];

          const now = performance.now();
          const ssrc = r.ssrc ?? 'no-ssrc';
          const bytes = r.bytesSent ?? 0;
          const packets = r.packetsSent ?? 0;
          const lost = r.packetsLost ?? 0;

          const key = `${i}:${ssrc}`;
          const prev = last.get(key) || { t: now, bytes };
          const dt = (now - prev.t) / 1000;
          const db = bytes - prev.bytes;
          const kbps = dt > 0 ? (db * 8) / 1000 / dt : 0;

          last.set(key, { t: now, bytes });

          console.log(`${TAG} PC#${i} ssrc=${ssrc} kbps=${kbps.toFixed(1)} db=${db}B bytes=${bytes} packets=${packets} lost=${lost} codec=${opusCodec?.mimeType || 'unknown'}`);
        }

        await new Promise((r) => setTimeout(r, intervalMs));
      }
    };

    log('PeerConnection hook ready. Use: mgameInspect() | mgameStats(2000)');
  })();

  log('Ready — capture processing off + gain + limiter + SDP/bitrate hints + diagnostics');
  log('Commands: mgameStatus() | mgameGain(n) | mgameLimiter({...}) | mgamePreset("voice"|"voice+music") | mgameInspect() | mgameStats(2000)');
})();