// ==UserScript==
// @name         M-Game Clean Audio v7.0 Baseline (Atlas + X Spaces)
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  Baseline capture integrity script: disable WebRTC processing, preserve stereo intent, stabilize sender hints, and expose diagnostics
// @author       Cris Sarmiento
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '7.0-baseline';
  const TAG = '[M-Game v7.0]';
  const log = (...args) => console.log(TAG, ...args);
  const warn = (...args) => console.warn(TAG, ...args);

  if (window.__mgame && window.__mgame.installed) {
    log('Already installed; skipping duplicate injection.');
    return;
  }

  const ENABLE_SENDER_BITRATE_HINT = true;
  const TARGET_AUDIO_MAX_BITRATE_BPS = 128000;

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
    supportedConstraints: {},
    nextPcId: 1,
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
    if (!params.encodings) params.encodings = [{}];
    if (!params.encodings.length) params.encodings.push({});

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

  function installPeerConnectionHook() {
    const OriginalPC = window.RTCPeerConnection;
    if (!OriginalPC) {
      warn('RTCPeerConnection unavailable.');
      return;
    }

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

  window.mgameStatus = function () {
    const supported = safeGetSupportedConstraints();
    state.supportedConstraints = supported;

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
      return null;
    }

    const track = target.sender.track;
    const settings = track.getSettings ? track.getSettings() : {};

    if (!window.AudioContext && !window.webkitAudioContext) {
      warn('mgameStereoProbe: AudioContext unavailable.');
      return { warning: 'AudioContext unavailable', settings };
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
        return {
          channelCount: settings.channelCount ?? null,
          sampleRate: settings.sampleRate ?? null,
          normalizedChannelDifference: null,
          samples: 0,
          warning: 'AudioContext is suspended; perform a user gesture and retry.',
          trackLabel: track.label || null,
        };
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

      const normalizedDiff = totalEnergy > 0 ? diffEnergy / totalEnergy : 0;
      const channelCount = settings.channelCount ?? null;

      const result = {
        channelCount,
        sampleRate: settings.sampleRate ?? null,
        normalizedChannelDifference: Number(normalizedDiff.toFixed(6)),
        samples,
        warning: null,
        trackLabel: track.label || null,
      };

      if (channelCount !== null && channelCount < 2) {
        result.warning = 'Track is not reporting stereo channelCount.';
      } else if (normalizedDiff < 0.02) {
        result.warning = 'Channels look nearly identical (possible dual-mono collapse).';
      }

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

  state.supportedConstraints = safeGetSupportedConstraints();

  installGetUserMediaHook();
  installApplyConstraintsHook();
  installPeerConnectionHook();

  log(
    'Ready. Commands: mgameStatus(), mgameInspect(), mgameStats(ms,duration), mgameDropoutProbe(), mgameCodecProbe(ms,duration), mgameStereoProbe()'
  );
})();
