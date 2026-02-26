// ==UserScript==
// @name         M-Game Clean Audio v8.0 Transport-First (Atlas + X Spaces)
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  Transport-first music stability: enforce Opus music params, strict stereo gates, and v5.2 compatibility profile
// @author       Cris Sarmiento
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '8.0-transport-first';
  const TAG = '[M-Game v8.0]';
  const log = (...args) => console.log(TAG, ...args);
  const warn = (...args) => console.warn(TAG, ...args);
  const errlog = (...args) => console.error(TAG, ...args);

  if (window.__mgame && window.__mgame.installed) {
    log('Already installed; skipping duplicate injection.');
    return;
  }

  const ENABLE_SENDER_BITRATE_HINT = true;
  const TARGET_AUDIO_MAX_BITRATE_BPS = 128000;
  const STEREO_DIFF_THRESHOLD = 0.02;

  const PROFILES = {
    STRICT: 'strict',
    COMPAT_V52: 'compat_v52',
  };

  const OPUS_MUSIC_PARAMS = {
    maxplaybackrate: '48000',
    'sprop-maxcapturerate': '48000',
    maxaveragebitrate: String(TARGET_AUDIO_MAX_BITRATE_BPS),
    stereo: '1',
    'sprop-stereo': '1',
    usedtx: '0',
    useinbandfec: '1',
  };

  const REQUIRED_OPUS_PARAM_KEYS = Object.keys(OPUS_MUSIC_PARAMS);

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
    googNoiseReduction: false,
    googAudioMirroring: false,
    googExperimentalAutoGainControl: false,
    googExperimentalNoiseSuppression: false,
    googExperimentalEchoCancellation: false,
  };

  const QUALITY_HINTS = {
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
    latency: { ideal: 0.01 },
  };

  const state = {
    installed: true,
    version: VERSION,
    profile: PROFILES.STRICT,
    availableProfiles: Object.values(PROFILES),
    currentGain: 1.0,
    startedAt: new Date().toISOString(),
    pcs: new Set(),
    tracks: new Set(),
    lastRequestedConstraints: null,
    lastRequestedApplyConstraints: null,
    captureInputLabel: null,
    captureInputDeviceId: null,
    captureTrackSettings: null,
    senderTrackLabel: null,
    senderTrackDeviceId: null,
    senderTrackSettings: null,
    lastSenderParameters: {},
    lastSenderStats: {},
    lastDropoutProbe: null,
    lastStereoProbe: null,
    stereoGateState: 'unknown',
    stereoGateReason: null,
    lastGateCheck: null,
    lastOpusFmtpApplied: null,
    lastOpusGuardContext: null,
    sdpGuardAppliedCount: 0,
    supportedConstraints: {},
    nextPcId: 1,
    audioContexts: new Set(),
    activeGainNodes: new Set(),
    compatPatchedSenders: new WeakSet(),
    audioContextResumeHandlersInstalled: false,
    monitorTimers: {
      stats: null,
      dropout: null,
      codec: null,
    },
  };

  window.__mgame = state;

  const pcMeta = new WeakMap();
  const senderMeta = new WeakMap();
  let nextSenderId = 1;

  function cloneJSON(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function safeGetSupportedConstraints() {
    try {
      return navigator.mediaDevices?.getSupportedConstraints?.() || {};
    } catch {
      return {};
    }
  }

  function buildW3CWithOptionalVoiceIsolation() {
    const supported = safeGetSupportedConstraints();
    return supported.voiceIsolation
      ? { ...W3C_AUDIO, voiceIsolation: false }
      : { ...W3C_AUDIO };
  }

  function setMusicHint(track) {
    if (!track || track.kind !== 'audio') return;
    try {
      if ('contentHint' in track) track.contentHint = 'music';
    } catch {
      // no-op
    }
  }

  function isSyntheticTrackIdentity(label, deviceId) {
    const normalizedLabel = String(label || '').toLowerCase();
    const normalizedDevice = String(deviceId || '').toLowerCase();
    return (
      normalizedLabel.includes('mediastreamaudiodestinationnode') ||
      normalizedDevice.startsWith('webaudio-') ||
      normalizedDevice.includes('webaudio')
    );
  }

  function safeTrackSettings(track) {
    if (!track || typeof track.getSettings !== 'function') return {};
    try {
      return track.getSettings() || {};
    } catch {
      return {};
    }
  }

  function snapshotCaptureTrack(track) {
    if (!track || track.kind !== 'audio') return;
    try {
      const settings = safeTrackSettings(track);
      state.captureTrackSettings = cloneJSON(settings) || {};
      if (track.label) state.captureInputLabel = track.label;
      if (settings.deviceId) state.captureInputDeviceId = settings.deviceId;
    } catch {
      // no-op
    }
  }

  function snapshotSenderTrack(track) {
    if (!track || track.kind !== 'audio') return;
    try {
      const settings = safeTrackSettings(track);
      state.senderTrackSettings = cloneJSON(settings) || {};
      if (track.label) state.senderTrackLabel = track.label;
      if (settings.deviceId) state.senderTrackDeviceId = settings.deviceId;
    } catch {
      // no-op
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clampGain(value) {
    return Math.max(0.0, Math.min(3.0, value));
  }

  function isCompatProfile() {
    return state.profile === PROFILES.COMPAT_V52;
  }

  function ensureAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;

    let ctx = null;
    for (const candidate of state.audioContexts) {
      if (!candidate || candidate.state === 'closed') {
        state.audioContexts.delete(candidate);
        continue;
      }
      if (!ctx || (ctx.state === 'suspended' && candidate.state === 'running')) {
        ctx = candidate;
      }
      if (candidate.state === 'running') break;
    }

    if (!ctx) {
      ctx = new Ctx();
      state.audioContexts.add(ctx);
    }

    if (!state.audioContextResumeHandlersInstalled) {
      const resume = () => {
        state.audioContexts.forEach((candidate) => {
          if (candidate.state === 'suspended') {
            candidate.resume().catch(() => {
              // no-op
            });
          }
        });
      };

      window.addEventListener('pointerdown', resume, true);
      window.addEventListener('keydown', resume, true);
      state.audioContextResumeHandlersInstalled = true;
    }

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {
        // no-op
      });
    }

    return ctx;
  }

  function maybeAttachCompatGainStage(stream) {
    if (!isCompatProfile()) return stream;
    if (!stream || typeof stream.getAudioTracks !== 'function') return stream;

    const originalTrack = stream.getAudioTracks()[0];
    if (!originalTrack) return stream;

    const ctx = ensureAudioContext();
    if (!ctx) {
      warn('compat_v52: AudioContext unavailable, gain stage skipped.');
      return stream;
    }

    try {
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = state.currentGain;

      const destination = ctx.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(destination);

      const processedTrack = destination.stream.getAudioTracks()[0];
      if (!processedTrack) return stream;

      setMusicHint(processedTrack);

      let removedOriginal = false;
      try {
        stream.removeTrack(originalTrack);
        removedOriginal = true;
      } catch (error) {
        warn('compat_v52: failed to attach gain stage:', error?.message || error);
      }

      if (!removedOriginal) {
        try {
          source.disconnect();
          gain.disconnect();
        } catch {
          // no-op
        }
        return stream;
      }

      stream.addTrack(processedTrack);
      state.activeGainNodes.add(gain);

      processedTrack.addEventListener(
        'ended',
        () => {
          state.activeGainNodes.delete(gain);
        },
        { once: true }
      );

      log(`compat_v52: gain stage active (${state.currentGain.toFixed(2)}x).`);
    } catch (error) {
      warn('compat_v52: failed to attach gain stage:', error?.message || error);
    }

    return stream;
  }

  async function activateCompatFallbackOnActiveSenders() {
    if (!isCompatProfile()) {
      return { attempted: 0, patched: 0, errors: 0 };
    }

    const active = getActiveAudioSenders();
    if (!active.length) {
      return { attempted: 0, patched: 0, errors: 0 };
    }

    const ctx = ensureAudioContext();
    if (!ctx) {
      return { attempted: active.length, patched: 0, errors: active.length };
    }

    let attempted = 0;
    let patched = 0;
    let errors = 0;

    for (const { pcId, sender } of active) {
      if (!sender?.track || sender.track.kind !== 'audio') continue;
      if (state.compatPatchedSenders.has(sender)) continue;
      if (typeof sender.replaceTrack !== 'function') continue;

      attempted += 1;

      try {
        const sourceTrack = sender.track;
        const sourceStream = new MediaStream([sourceTrack]);
        const source = ctx.createMediaStreamSource(sourceStream);
        const gain = ctx.createGain();
        gain.gain.value = state.currentGain;
        const destination = ctx.createMediaStreamDestination();

        source.connect(gain);
        gain.connect(destination);

        const processedTrack = destination.stream.getAudioTracks()[0];
        if (!processedTrack) {
          errors += 1;
          continue;
        }

        setMusicHint(processedTrack);
        await sender.replaceTrack(processedTrack);
        state.activeGainNodes.add(gain);
        state.compatPatchedSenders.add(sender);
        processedTrack.addEventListener(
          'ended',
          () => {
            state.activeGainNodes.delete(gain);
            state.compatPatchedSenders.delete(sender);
          },
          { once: true }
        );
        snapshotSenderTrack(processedTrack);
        captureSenderSnapshot(sender, pcId);
        registerTrack(processedTrack);
        patched += 1;
      } catch (error) {
        errors += 1;
        warn('compat_v52: failed live sender fallback:', error?.message || error);
      }
    }

    return { attempted, patched, errors };
  }

  function parseParamMap(paramString) {
    const map = {};
    String(paramString || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const [key, ...rest] = entry.split('=');
        if (!key) return;
        map[key.trim()] = rest.length ? rest.join('=').trim() : '';
      });
    return map;
  }

  function parseOpusFmtpLine(line) {
    if (!line) return {};
    const normalized = String(line).trim();
    const fmtpMatch = normalized.match(/^a=fmtp:\d+\s+(.+)$/);
    if (fmtpMatch) return parseParamMap(fmtpMatch[1]);
    return parseParamMap(normalized);
  }

  function serializeParamMap(paramMap) {
    return Object.entries(paramMap)
      .map(([key, value]) => (value !== '' ? `${key}=${value}` : key))
      .join(';');
  }

  function optimizeOpusSDP(sdp, context = 'unknown') {
    if (!sdp || typeof sdp !== 'string') return sdp;

    const hadTrailingCrlf = sdp.endsWith('\r\n');
    const lines = sdp.split('\r\n');
    const sections = [];
    let currentSection = [];

    for (const line of lines) {
      if (line.startsWith('m=') && currentSection.length > 0) {
        sections.push(currentSection);
        currentSection = [line];
      } else {
        currentSection.push(line);
      }
    }
    if (currentSection.length > 0) sections.push(currentSection);

    let replaced = 0;
    let lastAppliedLine = null;

    const rewrittenSections = sections.map((sectionLines) => {
      if (!sectionLines.length) return sectionLines;
      if (!sectionLines[0].startsWith('m=')) return sectionLines;

      const opusPayloadTypes = new Set();
      sectionLines.forEach((line) => {
        const match = line.match(/^a=rtpmap:(\d+)\s+opus\/\d+/i);
        if (match) opusPayloadTypes.add(match[1]);
      });

      if (!opusPayloadTypes.size) return sectionLines;

      return sectionLines.map((line) => {
        const match = line.match(/^a=fmtp:(\d+)\s+(.+)$/);
        if (!match) return line;

        const payloadType = match[1];
        const rawParams = match[2];
        if (!opusPayloadTypes.has(payloadType)) return line;

        const paramMap = parseParamMap(rawParams);
        delete paramMap.cbr;
        Object.assign(paramMap, OPUS_MUSIC_PARAMS);
        const rewritten = serializeParamMap(paramMap);
        const rewrittenLine = `a=fmtp:${payloadType} ${rewritten}`;
        if (rewrittenLine === line) return line;
        replaced += 1;
        lastAppliedLine = rewrittenLine;
        return rewrittenLine;
      });
    });

    let nextSdp = rewrittenSections.flat().join('\r\n');
    if (hadTrailingCrlf && !nextSdp.endsWith('\r\n')) {
      nextSdp += '\r\n';
    }

    if (replaced > 0) {
      state.lastOpusFmtpApplied = lastAppliedLine;
      state.lastOpusGuardContext = context;
      state.sdpGuardAppliedCount += replaced;
    }

    return nextSdp;
  }

  function evaluateOpusGuardState() {
    const line = state.lastOpusFmtpApplied;
    if (!line) {
      return {
        pass: false,
        reason: 'No Opus fmtp line has been observed by the SDP guard yet.',
        parsed: {},
      };
    }

    const parsed = parseOpusFmtpLine(line);
    for (const key of REQUIRED_OPUS_PARAM_KEYS) {
      if (String(parsed[key] || '') !== String(OPUS_MUSIC_PARAMS[key])) {
        return {
          pass: false,
          reason: `Opus fmtp missing expected ${key}=${OPUS_MUSIC_PARAMS[key]}.`,
          parsed,
        };
      }
    }

    if (Object.prototype.hasOwnProperty.call(parsed, 'cbr')) {
      return {
        pass: false,
        reason: 'Opus fmtp still includes cbr parameter.',
        parsed,
      };
    }

    return {
      pass: true,
      reason: null,
      parsed,
    };
  }

  function setStereoGate(stateName, reason, probe = null) {
    state.stereoGateState = stateName;
    state.stereoGateReason = reason || null;
    if (probe) state.lastStereoProbe = cloneJSON(probe) || probe;
  }

  function evaluateStereoGate(probe) {
    if (!probe) {
      setStereoGate('fail_no_probe', 'Stereo probe unavailable.', null);
      return { pass: false, state: state.stereoGateState, reason: state.stereoGateReason };
    }

    if (probe.channelCount !== null && probe.channelCount < 2) {
      setStereoGate(
        'fail_mono_track',
        `Track reports channelCount=${probe.channelCount}; expected stereo.`,
        probe
      );
    } else if (
      typeof probe.normalizedChannelDifference === 'number' &&
      probe.normalizedChannelDifference < STEREO_DIFF_THRESHOLD
    ) {
      setStereoGate(
        'fail_dual_mono',
        `Channel difference ${probe.normalizedChannelDifference} is below threshold ${STEREO_DIFF_THRESHOLD}.`,
        probe
      );
    } else if (probe.warning) {
      setStereoGate('unknown', probe.warning, probe);
    } else {
      setStereoGate('pass', null, probe);
    }

    const pass = state.stereoGateState === 'pass';

    if (!pass && state.profile === PROFILES.STRICT) {
      errlog('Strict stereo gate failed.', {
        state: state.stereoGateState,
        reason: state.stereoGateReason,
        action: "Switch profile with mgameProfile('compat_v52') for immediate fallback.",
      });
    }

    return {
      pass,
      state: state.stereoGateState,
      reason: state.stereoGateReason,
    };
  }

  function normalizeAudioConstraints(audioConstraints) {
    if (!audioConstraints || typeof audioConstraints !== 'object') {
      return {
        ...buildW3CWithOptionalVoiceIsolation(),
        ...GOOG_AUDIO,
        ...QUALITY_HINTS,
      };
    }

    const normalized = { ...audioConstraints };
    const preservedDeviceId = normalized.deviceId;

    Object.assign(normalized, buildW3CWithOptionalVoiceIsolation(), GOOG_AUDIO, QUALITY_HINTS);

    if (preservedDeviceId) {
      normalized.deviceId = preservedDeviceId;
    }

    return normalized;
  }

  function normalizeConstraints(constraints) {
    const base = constraints ? { ...constraints } : {};

    if (base.audio === true) {
      base.audio = {};
    }

    if (!base.audio) {
      return base;
    }

    if (typeof base.audio === 'object') {
      base.audio = normalizeAudioConstraints(base.audio);
    }

    return base;
  }

  function disableProcessingOnTrack(track) {
    if (!track || track.kind !== 'audio') return Promise.resolve();

    setMusicHint(track);
    snapshotCaptureTrack(track);

    if (typeof track.applyConstraints !== 'function') {
      return Promise.resolve();
    }

    return track
      .applyConstraints(buildW3CWithOptionalVoiceIsolation())
      .then(() => {
        setMusicHint(track);
        snapshotCaptureTrack(track);
      })
      .catch((err) => {
        warn('Track applyConstraints failed:', err?.message || err);
      });
  }

  function trackSenderKey(sender, pcId) {
    if (!senderMeta.has(sender)) {
      senderMeta.set(sender, `pc${pcId}-sender${nextSenderId++}`);
    }
    return senderMeta.get(sender);
  }

  function captureSenderSnapshot(sender, pcId) {
    if (!sender || sender.track?.kind !== 'audio') return;
    try {
      const key = trackSenderKey(sender, pcId);
      const p = sender.getParameters ? sender.getParameters() : null;
      state.lastSenderParameters[key] = {
        trackId: sender.track?.id || null,
        trackLabel: sender.track?.label || null,
        contentHint: sender.track?.contentHint || null,
        encodings: cloneJSON(p?.encodings || []),
        degradationPreference: p?.degradationPreference || null,
        timestamp: Date.now(),
      };
    } catch {
      // no-op
    }
  }

  async function captureSenderRuntimeSnapshot(sender, pcId, reason = 'runtime') {
    if (!sender || sender.track?.kind !== 'audio' || typeof sender.getStats !== 'function') return null;

    try {
      const report = await sender.getStats();
      let outbound = null;
      let outboundId = null;
      let remoteInbound = null;
      const remoteInboundCandidates = [];

      report.forEach((entry) => {
        const isAudio = entry.kind === 'audio' || entry.mediaType === 'audio';

        if (entry.type === 'outbound-rtp' && isAudio && !entry.isRemote) {
          if (!outbound || (entry.bytesSent || 0) > (outbound.bytesSent || 0)) {
            outbound = entry;
            outboundId = entry.id || null;
          }
          return;
        }

        if (entry.type === 'remote-inbound-rtp' && isAudio) {
          remoteInboundCandidates.push(entry);
        }
      });

      if (!outbound) return null;

      // Prefer canonical linkage from the selected outbound stream.
      if (outbound.remoteId && typeof report.get === 'function') {
        const linkedByRemoteId = report.get(outbound.remoteId);
        if (linkedByRemoteId?.type === 'remote-inbound-rtp') {
          remoteInbound = linkedByRemoteId;
        }
      }

      if (!remoteInbound && outboundId) {
        remoteInbound = remoteInboundCandidates.find((entry) => entry.localId === outboundId) || null;
      }

      // Last resort fallback for browsers that omit both remoteId/localId linkage.
      if (!remoteInbound) {
        remoteInbound =
          remoteInboundCandidates.reduce((best, entry) => {
            if (!best) return entry;
            return (entry.packetsLost || 0) >= (best.packetsLost || 0) ? entry : best;
          }, null) || null;
      }

      let codec = null;
      if (outbound.codecId && typeof report.get === 'function') {
        codec = report.get(outbound.codecId) || null;
      }

      let transport = null;
      if (outbound.transportId && typeof report.get === 'function') {
        transport = report.get(outbound.transportId) || null;
      }

      let selectedPair = null;
      if (transport?.selectedCandidatePairId && typeof report.get === 'function') {
        selectedPair = report.get(transport.selectedCandidatePairId) || null;
      }

      const key = trackSenderKey(sender, pcId);
      const snapshot = {
        reason,
        timestamp: Date.now(),
        bytesSent: outbound.bytesSent || 0,
        packetsSent: outbound.packetsSent || 0,
        retransmittedPacketsSent: outbound.retransmittedPacketsSent ?? null,
        nackCount: outbound.nackCount ?? null,
        roundTripTime: remoteInbound?.roundTripTime ?? null,
        totalRoundTripTime: remoteInbound?.totalRoundTripTime ?? null,
        codec: {
          mimeType: codec?.mimeType || null,
          clockRate: codec?.clockRate || null,
          channels: codec?.channels ?? null,
          payloadType: codec?.payloadType ?? outbound.payloadType ?? null,
          sdpFmtpLine: codec?.sdpFmtpLine || null,
        },
        transport: {
          transportId: outbound.transportId || null,
          selectedCandidatePairId: transport?.selectedCandidatePairId || null,
          currentRoundTripTime: selectedPair?.currentRoundTripTime ?? null,
          availableOutgoingBitrate: selectedPair?.availableOutgoingBitrate ?? null,
        },
      };

      state.lastSenderStats[key] = snapshot;
      return snapshot;
    } catch (err) {
      warn('sender.getStats failed:', err?.message || err);
      return null;
    }
  }

  function trySetSenderBitrate(sender, pcId) {
    if (!ENABLE_SENDER_BITRATE_HINT) return Promise.resolve(false);
    if (!sender || sender.track?.kind !== 'audio') return Promise.resolve(false);

    setMusicHint(sender.track);
    snapshotSenderTrack(sender.track);

    let params;
    try {
      params = sender.getParameters ? sender.getParameters() : null;
    } catch {
      return Promise.resolve(false);
    }

    if (!params) return Promise.resolve(false);
    if (!params.encodings || !params.encodings.length) {
      captureSenderSnapshot(sender, pcId);
      captureSenderRuntimeSnapshot(sender, pcId, 'setParameters-no-encodings');
      return Promise.resolve(false);
    }

    const encoding0 = params.encodings[0];
    let changed = false;

    if (encoding0.maxBitrate !== TARGET_AUDIO_MAX_BITRATE_BPS) {
      encoding0.maxBitrate = TARGET_AUDIO_MAX_BITRATE_BPS;
      changed = true;
    }

    // Apply channels hint only when browser exposes this field in sender encodings.
    if (
      Object.prototype.hasOwnProperty.call(encoding0, 'channels') &&
      encoding0.channels !== 2
    ) {
      encoding0.channels = 2;
      changed = true;
    }

    if (!changed) {
      captureSenderSnapshot(sender, pcId);
      captureSenderRuntimeSnapshot(sender, pcId, 'setParameters-skip');
      return Promise.resolve(false);
    }

    return sender
      .setParameters(params)
      .then(() => {
        captureSenderSnapshot(sender, pcId);
        captureSenderRuntimeSnapshot(sender, pcId, 'setParameters-applied');
        return true;
      })
      .catch((err) => {
        warn('sender.setParameters failed:', err?.message || err);
        return false;
      });
  }

  function refreshAudioSenders(pc, reason) {
    const meta = pcMeta.get(pc);
    const pcId = meta?.id || '?';

    try {
      const senders = pc.getSenders ? pc.getSenders() : [];
      senders.forEach((sender) => {
        if (sender.track?.kind !== 'audio') return;
        setMusicHint(sender.track);
        snapshotSenderTrack(sender.track);
        captureSenderSnapshot(sender, pcId);
        trySetSenderBitrate(sender, pcId);
        captureSenderRuntimeSnapshot(sender, pcId, `refresh:${reason}`);
      });
      log(`Refreshed audio senders for pc#${pcId} via ${reason}`);
    } catch (err) {
      warn(`refreshAudioSenders failed for pc#${pcId}:`, err?.message || err);
    }
  }

  function registerTrack(track) {
    if (!track || track.kind !== 'audio') return;
    state.tracks.add(track);
    setMusicHint(track);
    snapshotCaptureTrack(track);
    disableProcessingOnTrack(track);

    track.addEventListener(
      'ended',
      () => {
        state.tracks.delete(track);
      },
      { once: true }
    );
  }

  function processStream(stream, sourceName) {
    if (!stream) return stream;

    try {
      stream = maybeAttachCompatGainStage(stream);
      stream.getAudioTracks().forEach(registerTrack);

      stream.addEventListener('addtrack', (event) => {
        if (event.track?.kind === 'audio') {
          log(`New audio track detected via ${sourceName}`);
          registerTrack(event.track);
        }
      });
    } catch (err) {
      warn('processStream failed:', err?.message || err);
    }

    return stream;
  }

  function installGetUserMediaHook() {
    if (!navigator.mediaDevices?.getUserMedia) {
      warn('navigator.mediaDevices.getUserMedia unavailable.');
      return;
    }

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = function (constraints) {
      const modified = normalizeConstraints(constraints);
      state.lastRequestedConstraints = cloneJSON(modified);

      return originalGetUserMedia(modified).then((stream) => processStream(stream, 'getUserMedia'));
    };

    log('getUserMedia hook installed.');
  }

  function installApplyConstraintsHook() {
    if (!MediaStreamTrack?.prototype?.applyConstraints) {
      warn('MediaStreamTrack.applyConstraints unavailable.');
      return;
    }

    const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;

    MediaStreamTrack.prototype.applyConstraints = function (constraints) {
      if (this.kind !== 'audio') {
        return originalApplyConstraints.call(this, constraints);
      }

      const modified = constraints && typeof constraints === 'object' ? { ...constraints } : {};
      Object.assign(modified, buildW3CWithOptionalVoiceIsolation());
      state.lastRequestedApplyConstraints = cloneJSON(modified);

      return originalApplyConstraints.call(this, modified).then((result) => {
        setMusicHint(this);
        if (state.tracks.has(this)) {
          snapshotCaptureTrack(this);
        } else {
          snapshotSenderTrack(this);
        }
        return result;
      });
    };

    log('applyConstraints hook installed.');
  }

  function copyPeerConnectionStatics(OriginalPC, WrappedPC) {
    Object.getOwnPropertyNames(OriginalPC).forEach((key) => {
      if (key === 'length' || key === 'name' || key === 'prototype') return;
      if (Object.prototype.hasOwnProperty.call(WrappedPC, key)) return;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(OriginalPC, key);
        if (descriptor) Object.defineProperty(WrappedPC, key, descriptor);
      } catch {
        // no-op
      }
    });
  }

  function installSdpGuardHooks(OriginalPC) {
    if (!OriginalPC?.prototype) return;
    if (OriginalPC.prototype.__mgameSdpGuardInstalled) return;

    const originalSetLocalDescription =
      typeof OriginalPC.prototype.setLocalDescription === 'function'
        ? OriginalPC.prototype.setLocalDescription
        : null;
    const originalCreateOffer =
      typeof OriginalPC.prototype.createOffer === 'function'
        ? OriginalPC.prototype.createOffer
        : null;
    const originalCreateAnswer =
      typeof OriginalPC.prototype.createAnswer === 'function'
        ? OriginalPC.prototype.createAnswer
        : null;

    function optimizeDescriptionSdp(description, context) {
      if (!description?.sdp) return description;
      const optimized = optimizeOpusSDP(description.sdp, context);
      if (optimized === description.sdp) return description;
      return { type: description.type, sdp: optimized };
    }

    if (originalSetLocalDescription) {
      OriginalPC.prototype.setLocalDescription = function (desc) {
        if (desc?.sdp) {
          return originalSetLocalDescription.call(
            this,
            optimizeDescriptionSdp(desc, 'setLocalDescription')
          );
        }

        if (desc === undefined || desc === null) {
          const signalingState = this.signalingState;
          const generator =
            signalingState === 'have-remote-offer' ? originalCreateAnswer : originalCreateOffer;
          const autoContext =
            signalingState === 'have-remote-offer'
              ? 'setLocalDescription-auto-answer'
              : 'setLocalDescription-auto-offer';

          if (typeof generator === 'function') {
            return generator
              .call(this)
              .then((generated) => {
                const guarded = optimizeDescriptionSdp(generated, autoContext);
                if (guarded?.sdp && guarded.sdp !== generated?.sdp) {
                  log('SDP guard applied before setLocalDescription() no-arg path.', {
                    type: guarded.type || null,
                    context: autoContext,
                  });
                }
                return originalSetLocalDescription.call(this, guarded);
              })
              .catch((error) => {
                warn(
                  'SDP guard no-arg generation failed; falling back to browser setLocalDescription():',
                  error?.message || error
                );
                return originalSetLocalDescription.call(this);
              });
          }
        }

        return originalSetLocalDescription.call(this, desc);
      };
    }

    if (originalCreateOffer) {
      OriginalPC.prototype.createOffer = function (...args) {
        return originalCreateOffer.call(this, ...args).then((offer) => {
          return optimizeDescriptionSdp(offer, 'createOffer');
        });
      };
    }

    if (originalCreateAnswer) {
      OriginalPC.prototype.createAnswer = function (...args) {
        return originalCreateAnswer.call(this, ...args).then((answer) => {
          return optimizeDescriptionSdp(answer, 'createAnswer');
        });
      };
    }

    OriginalPC.prototype.__mgameSdpGuardInstalled = true;
    log('SDP guard hooks installed (createOffer/createAnswer/setLocalDescription).');
  }

  function installPeerConnectionHook() {
    const OriginalPC = window.RTCPeerConnection;
    if (!OriginalPC) {
      warn('RTCPeerConnection unavailable.');
      return;
    }

    installSdpGuardHooks(OriginalPC);

    function WrappedPC(...args) {
      const pc = new OriginalPC(...args);
      const id = state.nextPcId++;
      pcMeta.set(pc, { id, createdAt: Date.now() });
      state.pcs.add(pc);

      pc.addEventListener('connectionstatechange', () => {
        const st = pc.connectionState;
        log(`pc#${id}.connectionState=${st}`);
        if (st === 'closed' || st === 'failed') {
          state.pcs.delete(pc);
        }
        if (st === 'connected') {
          refreshAudioSenders(pc, 'connectionstatechange');
        }
      });

      pc.addEventListener('negotiationneeded', () => {
        refreshAudioSenders(pc, 'negotiationneeded');
      });

      pc.addEventListener('track', () => {
        refreshAudioSenders(pc, 'track');
      });

      if (typeof pc.addTrack === 'function') {
        const originalAddTrack = pc.addTrack.bind(pc);
        pc.addTrack = function (...trackArgs) {
          const sender = originalAddTrack(...trackArgs);
          if (sender?.track?.kind === 'audio') {
            setMusicHint(sender.track);
            snapshotSenderTrack(sender.track);
            captureSenderSnapshot(sender, id);
            trySetSenderBitrate(sender, id);
            captureSenderRuntimeSnapshot(sender, id, 'addTrack');
          }
          return sender;
        };
      }

      if (typeof pc.addTransceiver === 'function') {
        const originalAddTransceiver = pc.addTransceiver.bind(pc);
        pc.addTransceiver = function (...transceiverArgs) {
          const transceiver = originalAddTransceiver(...transceiverArgs);
          const sender = transceiver?.sender;
          if (sender?.track?.kind === 'audio') {
            setMusicHint(sender.track);
            snapshotSenderTrack(sender.track);
            captureSenderSnapshot(sender, id);
            trySetSenderBitrate(sender, id);
            captureSenderRuntimeSnapshot(sender, id, 'addTransceiver');
          }
          return transceiver;
        };
      }

      return pc;
    }

    WrappedPC.prototype = OriginalPC.prototype;
    Object.setPrototypeOf(WrappedPC, OriginalPC);
    copyPeerConnectionStatics(OriginalPC, WrappedPC);

    window.RTCPeerConnection = WrappedPC;

    log('PeerConnection hook installed.');
  }

  function getActiveAudioSenders() {
    const list = [];
    for (const pc of state.pcs) {
      const meta = pcMeta.get(pc);
      const pcId = meta?.id || '?';
      if (!pc || pc.connectionState === 'closed') continue;

      try {
        const senders = pc.getSenders ? pc.getSenders() : [];
        senders.forEach((sender) => {
          if (sender.track?.kind === 'audio') {
            list.push({ pc, pcId, sender });
          }
        });
      } catch {
        // no-op
      }
    }
    return list;
  }

  function getSenderStatsSnapshot(sender, pcId) {
    if (!sender || sender.track?.kind !== 'audio') return null;
    const key = trackSenderKey(sender, pcId);
    return cloneJSON(state.lastSenderStats[key] || null);
  }

  function buildPcSummary() {
    const summary = [];
    for (const pc of state.pcs) {
      if (!pc || pc.connectionState === 'closed') continue;
      const meta = pcMeta.get(pc);
      const pcId = meta?.id || '?';
      let senderCount = 0;
      try {
        const senders = pc.getSenders ? pc.getSenders() : [];
        senderCount = senders.filter((sender) => sender.track?.kind === 'audio').length;
      } catch {
        senderCount = 0;
      }

      summary.push({
        pcId,
        connectionState: pc.connectionState || null,
        iceConnectionState: pc.iceConnectionState || null,
        signalingState: pc.signalingState || null,
        audioSenderCount: senderCount,
      });
    }

    return summary;
  }

  window.mgameProfile = function (nextProfile) {
    if (typeof nextProfile === 'undefined') {
      log('Current profile:', state.profile);
      return state.profile;
    }

    if (!state.availableProfiles.includes(nextProfile)) {
      warn(`Unknown profile "${nextProfile}". Available: ${state.availableProfiles.join(', ')}`);
      return state.profile;
    }

    if (nextProfile === state.profile) {
      log('Profile already active:', state.profile);
      return state.profile;
    }

    state.profile = nextProfile;
    state.stereoGateState = 'unknown';
    state.stereoGateReason = null;

    if (state.profile === PROFILES.COMPAT_V52) {
      activateCompatFallbackOnActiveSenders()
        .then((summary) => {
          if (summary.patched > 0) {
            log(`compat_v52 live fallback patched ${summary.patched}/${summary.attempted} active sender(s).`);
          } else if (summary.attempted > 0) {
            warn(
              `compat_v52 live fallback could not patch active senders (${summary.errors}/${summary.attempted} errors). Rejoin/publish may be required.`
            );
          }
        })
        .catch((error) => {
          warn('compat_v52 live fallback failed:', error?.message || error);
        });
    }

    log(
      `Profile switched to "${state.profile}".`,
      state.profile === PROFILES.COMPAT_V52
        ? "compat_v52 enables gain-stage fallback (new captures + best-effort live replaceTrack)."
        : 'strict keeps pure transport-first path on new captures. Existing compat live patches remain until track restart.'
    );
    return state.profile;
  };

  window.mgameGain = function (value) {
    if (typeof value === 'undefined') {
      log('Current gain:', state.currentGain);
      return state.currentGain;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      warn('mgameGain requires a finite number.');
      return state.currentGain;
    }

    state.currentGain = clampGain(numeric);
    state.activeGainNodes.forEach((gainNode) => {
      try {
        gainNode.gain.value = state.currentGain;
      } catch {
        // no-op
      }
    });

    if (state.activeGainNodes.size === 0) {
      log(
        `Gain set to ${state.currentGain.toFixed(2)}x.`,
        isCompatProfile()
          ? 'Will apply when a compat_v52 stream is active.'
          : "Strict profile active. Switch with mgameProfile('compat_v52') for live gain stage."
      );
    } else {
      log(`Gain applied to ${state.activeGainNodes.size} active node(s): ${state.currentGain.toFixed(2)}x`);
    }

    return state.currentGain;
  };

  window.mgameStatus = function () {
    const supported = safeGetSupportedConstraints();
    state.supportedConstraints = supported;
    const opusGuard = evaluateOpusGuardState();

    const senders = getActiveAudioSenders();
    const senderSummary = senders.map(({ pcId, sender }) => {
      let params = null;
      try {
        params = sender.getParameters ? sender.getParameters() : null;
      } catch {
        params = null;
      }

      return {
        pcId,
        trackLabel: sender.track?.label || '(none)',
        trackDeviceId: safeTrackSettings(sender.track).deviceId || null,
        contentHint: sender.track?.contentHint || '(none)',
        encoding0: cloneJSON(params?.encodings?.[0] || null),
        runtimeStats: getSenderStatsSnapshot(sender, pcId),
      };
    });

    const firstSender = senders[0]?.sender || null;
    const firstSenderSettings = safeTrackSettings(firstSender?.track);
    const senderTrackLabel = firstSender?.track?.label || state.senderTrackLabel || '(unknown yet)';
    const senderTrackDeviceId = firstSenderSettings.deviceId || state.senderTrackDeviceId || '(unknown yet)';
    const senderTrackSettings = Object.keys(firstSenderSettings).length
      ? firstSenderSettings
      : state.senderTrackSettings || {};
    const syntheticTrackWarning = isSyntheticTrackIdentity(senderTrackLabel, senderTrackDeviceId)
      ? 'Outbound sender track appears synthetic (WebAudio destination track).'
      : null;

    const pcSummary = buildPcSummary();
    const topologyWarning =
      pcSummary.length > 1 && senderSummary.length === 1
        ? 'Multiple PeerConnections detected but only one active outbound audio sender.'
        : null;

    const status = {
      version: state.version,
      profile: state.profile,
      availableProfiles: state.availableProfiles,
      currentGain: state.currentGain,
      activeGainNodeCount: state.activeGainNodes.size,
      startedAt: state.startedAt,
      captureInputLabel: state.captureInputLabel || '(unknown yet)',
      captureInputDeviceId: state.captureInputDeviceId || '(unknown yet)',
      captureTrackSettings: state.captureTrackSettings || {},
      senderTrackLabel,
      senderTrackDeviceId,
      senderTrackSettings,
      syntheticTrackWarning,
      topologyWarning,
      pcSummary,
      // Backward-compatible aliases.
      selectedInputLabel: state.captureInputLabel || '(unknown yet)',
      selectedInputDeviceId: state.captureInputDeviceId || '(unknown yet)',
      trackSettings: state.captureTrackSettings || {},
      activePeerConnections: state.pcs.size,
      activeTrackedAudioTracks: state.tracks.size,
      senderCount: senderSummary.length,
      senderSummary,
      stereoGateState: state.stereoGateState,
      stereoGateReason: state.stereoGateReason,
      lastStereoProbe: state.lastStereoProbe,
      lastGateCheck: state.lastGateCheck,
      lastOpusFmtpApplied: state.lastOpusFmtpApplied,
      lastOpusGuardContext: state.lastOpusGuardContext,
      sdpGuardAppliedCount: state.sdpGuardAppliedCount,
      opusGuard,
      lastRequestedConstraints: state.lastRequestedConstraints,
      lastRequestedApplyConstraints: state.lastRequestedApplyConstraints,
      supportedConstraints: {
        echoCancellation: !!supported.echoCancellation,
        autoGainControl: !!supported.autoGainControl,
        noiseSuppression: !!supported.noiseSuppression,
        voiceIsolation: !!supported.voiceIsolation,
        channelCount: !!supported.channelCount,
        sampleRate: !!supported.sampleRate,
      },
    };

    console.log(`${TAG} status`, status);
    return status;
  };

  window.mgameInspect = function () {
    const rows = [];

    for (const pc of state.pcs) {
      const meta = pcMeta.get(pc);
      const pcId = meta?.id || '?';

      const base = {
        pcId,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        signalingState: pc.signalingState,
      };

      try {
        const senders = pc.getSenders ? pc.getSenders() : [];
        senders.forEach((sender) => {
          if (sender.track?.kind !== 'audio') return;
          const runtimeStats = getSenderStatsSnapshot(sender, pcId);
          const fmtpLine = runtimeStats?.codec?.sdpFmtpLine || state.lastOpusFmtpApplied || null;
          const fmtp = parseOpusFmtpLine(fmtpLine);
          let params = null;
          try {
            params = sender.getParameters ? sender.getParameters() : null;
          } catch {
            params = null;
          }

          rows.push({
            ...base,
            trackId: sender.track?.id || null,
            trackLabel: sender.track?.label || null,
            contentHint: sender.track?.contentHint || null,
            maxBitrate: params?.encodings?.[0]?.maxBitrate || null,
            channelHint: params?.encodings?.[0]?.channels ?? null,
            active: sender.track?.enabled ?? null,
            codecMimeType: runtimeStats?.codec?.mimeType || null,
            codecClockRate: runtimeStats?.codec?.clockRate || null,
            codecChannels: runtimeStats?.codec?.channels ?? null,
            codecPayloadType: runtimeStats?.codec?.payloadType ?? null,
            codecSdpFmtpLine: fmtpLine,
            opusUsedtx: fmtp.usedtx ?? null,
            opusStereo: fmtp.stereo ?? null,
            opusSpropStereo: fmtp['sprop-stereo'] ?? null,
            opusMaxAverageBitrate: fmtp.maxaveragebitrate ?? null,
            roundTripTime: runtimeStats?.roundTripTime ?? null,
            bytesSent: runtimeStats?.bytesSent ?? null,
            packetsSent: runtimeStats?.packetsSent ?? null,
            runtimeStatsAt: runtimeStats?.timestamp || null,
          });
        });
      } catch {
        rows.push({ ...base, trackId: null, trackLabel: '(sender read failed)' });
      }
    }

    if (!rows.length) {
      log('No active outbound audio senders.');
      return [];
    }

    console.table(rows);
    return rows;
  };

  async function collectOutboundSample(sender) {
    const report = await sender.getStats();
    let outbound = null;

    report.forEach((entry) => {
      const isAudio = entry.kind === 'audio' || entry.mediaType === 'audio';
      if (entry.type === 'outbound-rtp' && isAudio && !entry.isRemote) {
        if (!outbound || (entry.bytesSent || 0) > (outbound.bytesSent || 0)) {
          outbound = entry;
        }
      }
    });

    return outbound;
  }

  async function runStatsLoop({ intervalMs, durationMs, mode }) {
    const results = [];
    const previous = new Map();
    const endAt = Date.now() + durationMs;
    let sawAnySender = false;

    while (Date.now() < endAt) {
      // Re-read active senders each cycle so renegotiation/replacement is tracked.
      const senders = getActiveAudioSenders();
      if (!senders.length) {
        await sleep(intervalMs);
        continue;
      }

      sawAnySender = true;

      for (const { pcId, sender } of senders) {
        if (!sender.track || sender.track.readyState === 'ended') continue;

        let outbound;
        try {
          outbound = await collectOutboundSample(sender);
        } catch (err) {
          warn(`${mode}: getStats failed for pc#${pcId}:`, err?.message || err);
          continue;
        }

        if (!outbound) continue;

        captureSenderRuntimeSnapshot(sender, pcId, mode);

        const key = `${pcId}:${sender.track?.id || 'unknown'}`;
        const now = Date.now();
        const bytes = outbound.bytesSent || 0;
        const packets = outbound.packetsSent || 0;

        const prev = previous.get(key);
        let kbps = 0;
        let dropped = false;

        if (prev) {
          const dt = (now - prev.t) / 1000;
          const deltaBytes = bytes - prev.bytes;
          const deltaPackets = packets - prev.packets;
          kbps = dt > 0 ? (deltaBytes * 8) / 1000 / dt : 0;
          dropped = deltaBytes <= 0 && deltaPackets <= 0;
        }

        previous.set(key, { t: now, bytes, packets });

        const point = {
          t: now,
          pcId,
          trackId: sender.track?.id || null,
          trackLabel: sender.track?.label || null,
          kbps: Number(kbps.toFixed(2)),
          bytes,
          packets,
          dropped,
        };

        results.push(point);
        console.log(`${TAG} ${mode}`, point);
      }

      await sleep(intervalMs);
    }

    if (!sawAnySender) {
      warn(`${mode}: no active outbound audio senders during probe window.`);
    }

    return results;
  }

  window.mgameStats = async function (intervalMs = 2000, durationMs = 20000) {
    const points = await runStatsLoop({ intervalMs, durationMs, mode: 'stats' });
    log(`mgameStats completed with ${points.length} samples.`);
    return points;
  };

  window.mgameDropoutProbe = async function (intervalMs = 500, durationMs = 12000) {
    const points = await runStatsLoop({ intervalMs, durationMs, mode: 'dropout-probe' });
    const dropouts = points.filter((p) => p.dropped);

    const summary = {
      samples: points.length,
      dropouts: dropouts.length,
      dropoutWindows: dropouts.slice(0, 20),
    };

    state.lastDropoutProbe = summary;

    if (summary.dropouts > 0) {
      warn('Dropout probe detected stalled outbound windows.', summary);
    } else {
      log('Dropout probe found no stalled outbound windows.', summary);
    }

    return summary;
  };

  window.mgameCodecProbe = async function (intervalMs = 1200, durationMs = 12000) {
    const results = [];
    const endAt = Date.now() + durationMs;
    let sawAnySender = false;

    while (Date.now() < endAt) {
      const senders = getActiveAudioSenders();
      if (!senders.length) {
        await sleep(intervalMs);
        continue;
      }

      sawAnySender = true;

      for (const { pcId, sender } of senders) {
        if (!sender.track || sender.track.readyState === 'ended') continue;

        const snapshot = await captureSenderRuntimeSnapshot(sender, pcId, 'codec-probe');
        if (!snapshot) continue;

        const point = {
          t: snapshot.timestamp,
          pcId,
          trackId: sender.track?.id || null,
          trackLabel: sender.track?.label || null,
          codecMimeType: snapshot.codec?.mimeType || null,
          codecClockRate: snapshot.codec?.clockRate || null,
          codecChannels: snapshot.codec?.channels ?? null,
          codecPayloadType: snapshot.codec?.payloadType ?? null,
          roundTripTime: snapshot.roundTripTime ?? null,
          bytesSent: snapshot.bytesSent ?? null,
          packetsSent: snapshot.packetsSent ?? null,
        };

        results.push(point);
        console.log(`${TAG} codec-probe`, point);
      }

      await sleep(intervalMs);
    }

    if (!sawAnySender) {
      warn('codec-probe: no active outbound audio senders during probe window.');
    }

    log(`mgameCodecProbe completed with ${results.length} samples.`);
    return results;
  };

  window.mgameStereoProbe = async function (sampleMs = 1200) {
    const senders = getActiveAudioSenders();
    const target = senders.find((entry) => entry.sender?.track?.kind === 'audio');

    if (!target || !target.sender.track) {
      warn('mgameStereoProbe: no active outbound audio track to inspect.');
      setStereoGate('fail_no_sender', 'No active outbound audio sender.', null);
      return null;
    }

    const track = target.sender.track;
    const settings = track.getSettings ? track.getSettings() : {};

    if (!window.AudioContext && !window.webkitAudioContext) {
      warn('mgameStereoProbe: AudioContext unavailable.');
      const unavailable = { warning: 'AudioContext unavailable', settings };
      evaluateStereoGate(unavailable);
      return unavailable;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    let ctx = null;
    let clone = null;

    try {
      ctx = new Ctx();

      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch (err) {
          warn('mgameStereoProbe: AudioContext resume failed:', err?.message || err);
        }
      }

      if (ctx.state !== 'running') {
        const suspended = {
          channelCount: settings.channelCount ?? null,
          sampleRate: settings.sampleRate ?? null,
          normalizedChannelDifference: null,
          samples: 0,
          warning: 'AudioContext is suspended; perform a user gesture and retry.',
          trackLabel: track.label || null,
        };
        evaluateStereoGate(suspended);
        return suspended;
      }

      clone = track.clone();
      const stream = new MediaStream([clone]);
      const source = ctx.createMediaStreamSource(stream);
      const splitter = ctx.createChannelSplitter(2);

      const left = ctx.createAnalyser();
      const right = ctx.createAnalyser();
      left.fftSize = 2048;
      right.fftSize = 2048;

      source.connect(splitter);
      splitter.connect(left, 0);
      splitter.connect(right, 1);

      const leftData = new Float32Array(left.frequencyBinCount);
      const rightData = new Float32Array(right.frequencyBinCount);

      let diffEnergy = 0;
      let totalEnergy = 0;
      let samples = 0;

      const started = Date.now();
      while (Date.now() - started < sampleMs) {
        left.getFloatFrequencyData(leftData);
        right.getFloatFrequencyData(rightData);

        for (let i = 0; i < leftData.length; i++) {
          const l = Number.isFinite(leftData[i]) ? leftData[i] : -160;
          const r = Number.isFinite(rightData[i]) ? rightData[i] : -160;
          const dl = Math.pow(10, l / 20);
          const dr = Math.pow(10, r / 20);
          diffEnergy += Math.abs(dl - dr);
          totalEnergy += Math.max(dl, dr);
        }

        samples++;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      const hasMeasurableEnergy = totalEnergy > 0;
      const normalizedDiff = hasMeasurableEnergy ? diffEnergy / totalEnergy : null;
      const channelCount = settings.channelCount ?? null;

      const result = {
        channelCount,
        sampleRate: settings.sampleRate ?? null,
        normalizedChannelDifference:
          normalizedDiff === null ? null : Number(normalizedDiff.toFixed(6)),
        samples,
        warning: null,
        trackLabel: track.label || null,
      };

      if (!hasMeasurableEnergy) {
        result.warning = 'No audio energy detected during probe; stereo check inconclusive.';
      } else if (channelCount !== null && channelCount < 2) {
        result.warning = 'Track is not reporting stereo channelCount.';
      } else if (normalizedDiff < STEREO_DIFF_THRESHOLD) {
        result.warning = 'Channels look nearly identical (possible dual-mono collapse).';
      }

      const gate = evaluateStereoGate(result);
      result.stereoGateState = gate.state;
      result.stereoGateReason = gate.reason;

      console.log(`${TAG} stereo-probe`, result);
      return result;
    } finally {
      if (clone) {
        try {
          clone.stop();
        } catch {
          // no-op
        }
      }

      if (ctx) {
        try {
          await ctx.close();
        } catch {
          // no-op
        }
      }
    }
  };

  window.mgameGateCheck = async function (intervalMs = 500, durationMs = 12000) {
    const startedAt = new Date().toISOString();
    const failures = [];

    const dropout = await window.mgameDropoutProbe(intervalMs, durationMs);
    if (!dropout || dropout.samples === 0 || dropout.dropouts > 0) {
      failures.push(
        `Dropout probe failed (${dropout?.dropouts ?? 'n/a'} stalled windows over ${dropout?.samples ?? 0} samples).`
      );
    }

    const stereo = await window.mgameStereoProbe(1500);
    if (state.stereoGateState !== 'pass') {
      failures.push(
        `Stereo gate failed (${state.stereoGateState}${state.stereoGateReason ? `: ${state.stereoGateReason}` : ''}).`
      );
    }

    const codec = await window.mgameCodecProbe(Math.max(1000, intervalMs * 2), Math.min(durationMs, 12000));
    if (!codec.length) {
      failures.push('Codec probe collected no outbound audio samples.');
    }

    const opusGuard = evaluateOpusGuardState();
    if (!opusGuard.pass) {
      failures.push(`Opus SDP guard failed: ${opusGuard.reason}`);
    }

    const result = {
      pass: failures.length === 0,
      startedAt,
      completedAt: new Date().toISOString(),
      profile: state.profile,
      dropoutProbe: dropout,
      stereoProbe: stereo,
      stereoGateState: state.stereoGateState,
      stereoGateReason: state.stereoGateReason,
      codecSamples: codec.length,
      sdpGuard: {
        pass: opusGuard.pass,
        reason: opusGuard.reason,
        parsed: opusGuard.parsed,
        lastOpusFmtpApplied: state.lastOpusFmtpApplied,
        sdpGuardAppliedCount: state.sdpGuardAppliedCount,
      },
      failures,
    };

    state.lastGateCheck = cloneJSON(result) || result;

    if (!result.pass) {
      warn('mgameGateCheck failed.', result);
      if (state.profile === PROFILES.STRICT) {
        warn("Recommended fallback: mgameProfile('compat_v52')");
      }
    } else {
      log('mgameGateCheck passed.', result);
    }

    return result;
  };

  state.supportedConstraints = safeGetSupportedConstraints();

  installGetUserMediaHook();
  installApplyConstraintsHook();
  installPeerConnectionHook();

  log(
    "Ready. Commands: mgameStatus(), mgameInspect(), mgameProfile([name]), mgameGain([value]), mgameStats(ms,duration), mgameDropoutProbe(), mgameCodecProbe(ms,duration), mgameStereoProbe(), mgameGateCheck()"
  );
})();
