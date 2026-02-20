// ==UserScript==
// @name         M-Game Clean Audio v6.3 (X Spaces + Atlas) - Comp/Limiter
// @namespace    http://tampermonkey.net/
// @version      6.3
// @description  Disable capture processing + robust WebAudio chain (HPF->Comp->Limiter) + OPUS SDP params + sender bitrate hints + diagnostics (Atlas-friendly)
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

  // Output gain after processing (keep small; let compressor do the work)
  let currentGain = 1.0; // 0.0 - 2.5

  // Processing toggles
  let ENABLE_WEB_AUDIO_CHAIN = true;   // HPF + Compressor + Limiter-ish
  let ENABLE_HPF = true;
  let ENABLE_COMPRESSOR = true;
  let ENABLE_LIMITER = true;

  // HPF (voice clarity / rumble removal)
  let HPF_HZ = 90; // 70-120 typical

  // Compressor (levels the signal, reduces harsh peaks)
  // NOTE: WebAudio compressor is not a true broadcast compressor but works well as "safety leveling".
  let COMP = {
    threshold: -20, // dB (more negative = compress more often)
    knee: 18,       // dB
    ratio: 4,       // 2-6 typical
    attack: 0.006,  // seconds (fast to catch consonants, but not too fast)
    release: 0.20,  // seconds
    makeup: 1.0,    // linear gain after comp (use 1.0-1.5)
  };

  // Limiter-ish stage: soft clip to catch last peaks (prevents nasty digital clipping)
  // This is NOT a true brickwall limiter (no lookahead), but it’s a strong safety net.
  let LIMIT = {
    drive: 1.25,    // 1.0-2.0 (higher = more limiting)
    mix: 1.0,       // 0.0-1.0 (blend clipped signal)
  };

  // Best-effort bitrate hint (platform may ignore)
  const ENABLE_SENDER_BITRATE_HINT = true;
  const TARGET_AUDIO_MAX_BITRATE_BPS = 128000; // 128 kbps

  // =============================================================================
  // CONSTRAINT SETS (disable browser processing)
  // =============================================================================
  const W3C_AUDIO = {
    echoCancellation: false,
    autoGainControl: false,
    noiseSuppression: false,
  };

  // Legacy-ish Chrome flags (may be ignored)
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
  // INTERNAL STATE
  // =============================================================================
  let audioContext = null;

  // Keep handles for live tuning
  let nodes = {
    source: null,
    hpf: null,
    comp: null,
    compMakeup: null,
    clipper: null,
    clipMix: null,
    outGain: null,
    destination: null,
  };

  // Track protection (avoid re-processing already processed streams)
  const processedTracks = new WeakSet();

  // =============================================================================
  // HELPERS
  // =============================================================================
  function ensureAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      // Many sites require a gesture to start audio; we try to resume on common events.
      const resume = () => audioContext && audioContext.state === 'suspended' && audioContext.resume().catch(() => {});
      window.addEventListener('pointerdown', resume, { passive: true });
      window.addEventListener('keydown', resume, { passive: true });
      window.addEventListener('touchstart', resume, { passive: true });
    }
    return audioContext;
  }

  function setMusicHint(track) {
    try {
      if (track && 'contentHint' in track) track.contentHint = 'music';
    } catch {}
  }

  function disableProcessing(track) {
    try {
      if (!track || track.kind !== 'audio') return;
      setMusicHint(track);
      track.applyConstraints(W3C_AUDIO).catch(() => {});
    } catch {}
  }

  function modifyConstraints(constraints) {
    try {
      if (!constraints) return constraints;
      if (constraints.audio === true) constraints.audio = {};

      if (constraints.audio && typeof constraints.audio === 'object') {
        const deviceId = constraints.audio.deviceId; // preserve
        Object.assign(constraints.audio, W3C_AUDIO, GOOG_AUDIO);
        if (deviceId) constraints.audio.deviceId = deviceId;
      }
      return constraints;
    } catch {
      return constraints;
    }
  }

  // Soft clipper curve (tanh-ish)
  function makeSoftClipCurve(samples = 65536, drive = 1.25) {
    const curve = new Float32Array(samples);
    const k = Math.max(0.5, Math.min(6.0, drive));
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1; // [-1, 1]
      // soft saturation
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }

  function rebuildClipper() {
    try {
      if (!nodes.clipper) return;
      nodes.clipper.curve = makeSoftClipCurve(65536, LIMIT.drive);
      nodes.clipper.oversample = '4x';
    } catch {}
  }

  function applyNodeParams() {
    try {
      if (nodes.hpf) nodes.hpf.frequency.value = HPF_HZ;

      if (nodes.comp) {
        nodes.comp.threshold.value = COMP.threshold;
        nodes.comp.knee.value = COMP.knee;
        nodes.comp.ratio.value = COMP.ratio;
        nodes.comp.attack.value = COMP.attack;
        nodes.comp.release.value = COMP.release;
      }

      if (nodes.compMakeup) nodes.compMakeup.gain.value = Math.max(0.0, Math.min(3.0, COMP.makeup));
      if (nodes.outGain) nodes.outGain.gain.value = currentGain;

      if (nodes.clipMix) nodes.clipMix.gain.value = Math.max(0.0, Math.min(1.0, LIMIT.mix));
      rebuildClipper();
    } catch {}
  }

  // =============================================================================
  // PUBLIC COMMANDS (console)
  // =============================================================================
  window.mgameGain = function (value) {
    if (value === undefined) {
      log('Current gain:', currentGain, 'x');
      return currentGain;
    }
    currentGain = Math.max(0.0, Math.min(2.5, Number(value)));
    if (nodes.outGain) nodes.outGain.gain.value = currentGain;
    log('Gain set to', currentGain, 'x');
    return currentGain;
  };

  window.mgamePreset = function (name = 'voice') {
    // Quick presets you can try live
    if (name === 'voice') {
      HPF_HZ = 90;
      COMP = { threshold: -20, knee: 18, ratio: 4, attack: 0.006, release: 0.20, makeup: 1.15 };
      LIMIT = { drive: 1.25, mix: 1.0 };
      currentGain = 1.0;
    } else if (name === 'music') {
      HPF_HZ = 60;
      COMP = { threshold: -24, knee: 20, ratio: 3, attack: 0.010, release: 0.25, makeup: 1.05 };
      LIMIT = { drive: 1.15, mix: 0.8 };
      currentGain = 1.0;
    } else if (name === 'hard') {
      HPF_HZ = 100;
      COMP = { threshold: -26, knee: 22, ratio: 5, attack: 0.004, release: 0.18, makeup: 1.2 };
      LIMIT = { drive: 1.55, mix: 1.0 };
      currentGain = 0.95;
    }
    applyNodeParams();
    log('Preset applied:', name, { HPF_HZ, COMP, LIMIT, currentGain });
  };

  window.mgameTune = function (opts = {}) {
    // Fine tune on the fly, e.g.
    // mgameTune({ hpf: 95, comp: { threshold: -22, ratio: 4 }, limit: { drive: 1.4 }, gain: 1.0 })
    if (typeof opts.gain === 'number') currentGain = Math.max(0.0, Math.min(2.5, opts.gain));
    if (typeof opts.hpf === 'number') HPF_HZ = Math.max(20, Math.min(400, opts.hpf));

    if (opts.comp && typeof opts.comp === 'object') {
      COMP = { ...COMP, ...opts.comp };
      // clamp a few
      COMP.ratio = Math.max(1, Math.min(20, COMP.ratio));
      COMP.attack = Math.max(0.001, Math.min(0.2, COMP.attack));
      COMP.release = Math.max(0.05, Math.min(1.5, COMP.release));
      COMP.makeup = Math.max(0.0, Math.min(3.0, COMP.makeup));
    }

    if (opts.limit && typeof opts.limit === 'object') {
      LIMIT = { ...LIMIT, ...opts.limit };
      LIMIT.drive = Math.max(0.75, Math.min(6.0, LIMIT.drive));
      LIMIT.mix = Math.max(0.0, Math.min(1.0, LIMIT.mix));
    }

    applyNodeParams();
    log('Tune applied:', { HPF_HZ, COMP, LIMIT, currentGain });
  };

  window.mgameBypass = function (enabled = true) {
    // enabled=true => bypass processing chain (still disables browser processing flags)
    ENABLE_WEB_AUDIO_CHAIN = !enabled;
    log('Bypass set:', enabled, '(reload page to fully re-wire in all apps)');
  };

  window.mgameStatus = function () {
    console.log(`\n${TAG} === STATUS ===`);
    console.log(`${TAG} Version: 6.3`);
    console.log(`${TAG} WebAudio chain: ${ENABLE_WEB_AUDIO_CHAIN ? 'ON' : 'OFF'} (HPF=${ENABLE_HPF} COMP=${ENABLE_COMPRESSOR} LIMIT=${ENABLE_LIMITER})`);
    console.log(`${TAG} Gain: ${currentGain}x`);
    console.log(`${TAG} HPF: ${HPF_HZ} Hz`);
    console.log(`${TAG} COMP:`, COMP);
    console.log(`${TAG} LIMIT:`, LIMIT);
    console.log(`${TAG} Sender bitrate hint: ${ENABLE_SENDER_BITRATE_HINT ? TARGET_AUDIO_MAX_BITRATE_BPS + ' bps' : 'disabled'}`);
    console.log(`${TAG} W3C constraints:`, W3C_AUDIO);
    console.log(`${TAG} Goog constraints:`, GOOG_AUDIO);
    console.log(`${TAG} SDP music params:`, OPUS_MUSIC_PARAMS);
    console.log(`${TAG} WebRTC hook: ${window.__mgamePCs ? 'active' : 'pending'}`);
    console.log(`${TAG} ===============\n`);
  };

  // =============================================================================
  // 2) STREAM PROCESSING (HPF -> COMP -> LIMIT -> GAIN)
  // =============================================================================
  function buildChain(ctx, stream) {
    const source = ctx.createMediaStreamSource(stream);

    // Optional HPF
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = HPF_HZ;
    hpf.Q.value = 0.707;

    // Optional compressor
    const comp = ctx.createDynamicsCompressor();
    // values applied in applyNodeParams()

    // Makeup gain after comp
    const compMakeup = ctx.createGain();

    // Limiter-ish: dry/wet blend
    // We'll run the signal through a soft clipper and blend it back.
    const clipper = ctx.createWaveShaper();
    const clipMix = ctx.createGain();

    // Output gain
    const outGain = ctx.createGain();
    outGain.gain.value = currentGain;

    // Destination stream
    const destination = ctx.createMediaStreamDestination();

    // Wire:
    // source -> (HPF?) -> (COMP?) -> makeup -> [split to dry and clipped] -> sum -> outGain -> destination
    let node = source;

    if (ENABLE_HPF) {
      node.connect(hpf);
      node = hpf;
    }

    if (ENABLE_COMPRESSOR) {
      node.connect(comp);
      node = comp;
    }

    node.connect(compMakeup);

    // dry path
    compMakeup.connect(outGain);

    // clipped path
    if (ENABLE_LIMITER) {
      compMakeup.connect(clipper);
      clipper.connect(clipMix);
      clipMix.connect(outGain);
    }

    outGain.connect(destination);

    // Save nodes for tuning
    nodes = { source, hpf, comp, compMakeup, clipper, clipMix, outGain, destination };
    applyNodeParams();

    return destination;
  }

  function replaceTrackInStream(originalStream, newTrack) {
    try {
      const oldTrack = originalStream.getAudioTracks()[0];
      if (oldTrack) originalStream.removeTrack(oldTrack);
      originalStream.addTrack(newTrack);
    } catch {}
  }

  function processStream(stream) {
    if (!stream) return stream;

    // disable browser processing on original tracks
    stream.getAudioTracks().forEach(disableProcessing);

    // avoid re-processing the same track repeatedly
    const t0 = stream.getAudioTracks()[0];
    if (t0 && processedTracks.has(t0)) return stream;

    if (!ENABLE_WEB_AUDIO_CHAIN) return stream;

    try {
      const tracks = stream.getAudioTracks();
      if (!tracks || !tracks.length) return stream;

      const ctx = ensureAudioContext();

      const destination = buildChain(ctx, stream);
      const processedTrack = destination.stream.getAudioTracks()[0];
      if (!processedTrack) return stream;

      // mark + intent
      processedTracks.add(processedTrack);
      setMusicHint(processedTrack);

      // disable browser processing on processed track too
      disableProcessing(processedTrack);

      // replace track
      replaceTrackInStream(stream, processedTrack);

      // after a tick, re-apply hints (some apps overwrite)
      setTimeout(() => {
        setMusicHint(processedTrack);
        disableProcessing(processedTrack);
      }, 250);

      log('WebAudio chain inserted (HPF->COMP->LIMIT->GAIN). Use mgamePreset("voice") / mgameTune({...})');
      return stream;
    } catch (e) {
      warn('Processing failed, continuing without chain:', e?.message || e);
      return stream;
    }
  }

  // =============================================================================
  // 3) getUserMedia + applyConstraints PATCHES
  // =============================================================================
  if (navigator.mediaDevices?.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      log('getUserMedia intercepted');
      const modified = modifyConstraints(constraints);
      return originalGetUserMedia(modified).then(processStream);
    };
  }

  try {
    const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = function (constraints) {
      if (this.kind === 'audio') {
        const modified = constraints ? { ...constraints } : {};
        Object.assign(modified, W3C_AUDIO);
        return originalApplyConstraints.call(this, modified);
      }
      return originalApplyConstraints.call(this, constraints);
    };
  } catch {}

  // =============================================================================
  // 4) SDP MUNGING (OPUS)
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
  // 5) PEERCONNECTION + SENDER MANAGEMENT
  // =============================================================================
  function trySetSenderBitrate(sender) {
    if (!ENABLE_SENDER_BITRATE_HINT) return;
    if (!sender || sender.track?.kind !== 'audio') return;
    if (!TARGET_AUDIO_MAX_BITRATE_BPS || TARGET_AUDIO_MAX_BITRATE_BPS <= 0) return;

    try {
      setMusicHint(sender.track);

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
    // 6) DIAGNOSTICS (same as your v6.2, kept compact)
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
      if (!list.length) return log('No active PeerConnections found.');

      log(`Tracking ${list.length} PeerConnection(s).`);
      const last = new Map();

      while (true) {
        for (let i = 0; i < list.length; i++) {
          const pc = list[i];
          let stats;
          try { stats = await pc.getStats(); } catch { continue; }

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

          console.log(`${TAG} PC#${i} ssrc=${ssrc} kbps=${kbps.toFixed(1)} bytes=${bytes} packets=${packets} lost=${lost} codec=${opusCodec?.mimeType || 'unknown'}`);
        }

        await new Promise((r) => setTimeout(r, intervalMs));
      }
    };

    log('PeerConnection hook ready. Use: mgameInspect() | mgameStats(2000)');
  })();

  log('Ready — disable processing + WebAudio comp/limiter + diagnostics');
  log('Commands: mgameStatus() | mgamePreset("voice") | mgameTune({...}) | mgameGain(n) | mgameInspect() | mgameStats(2000)');
})();