Based on M-Game Clean Audio v6.3 (X Spaces + Atlas) - Compressor/Limiter - Script for TamperMonkey

Technical Knowledge Base
What the script does (4 interception layers)
Layer 1 — getUserMedia constraints: When X Spaces requests microphone access, the script injects both W3C standard constraints (echoCancellation, autoGainControl, noiseSuppression = false) AND Chrome-specific goog* constraints (8 flags including googHighpassFilter, googDucking, etc.). The goog* flags ONLY work at getUserMedia capture time — they are silently ignored by applyConstraints().
Layer 2 — applyConstraints blocking: X Spaces periodically calls applyConstraints() to re-enable processing. The script intercepts these calls and forces W3C audio constraints back to false. Only W3C constraints are set here because Chrome ignores goog* in applyConstraints.
Layer 3 — SDP munging: Modifies the Session Description Protocol negotiation to force Opus into fullband music mode. This is where the biggest quality wins happen.
Layer 4 — GainNode: A Web Audio API gain control inserted between capture and WebRTC encoder, allowing manual volume adjustment without AGC. Use mgameGain(n) in the browser console.
Critical SDP Parameters (what each does)
ParameterValueWhymaxplaybackrate48000Tells remote encoder "I can play fullband". Without this, X may set it to 8000-16000 (narrowband/wideband) and the encoder strips all high frequencies → "tin can" soundsprop-maxcapturerate48000Tells remote "I'm capturing fullband". Without it, remote decoder may discard high-frequency contentmaxaveragebitrate128000128kbps target. Default WebRTC voice is ~32kbps. More bits = more frequency detail. 510kbps was rejected by X Spaces in testingstereo1Tells decoder it can receive stereo. Both stereo=1 AND sprop-stereo=1 must be in BOTH local and remote SDPsprop-stereo1Tells encoder to SEND stereo. Without both params, Chrome mono-downmixes causing phase cancellationusedtx0Disables Discontinuous Transmission. DTX forces SILK mode (voice) via OPUS_SIGNAL_VOICE. usedtx=0 allows CELT mode (music)useinbandfec1Forward Error Correction for packet loss recoverycbrDELETEDCBR starves complex musical passages of bits, causing perceived volume ducking. VBR allocates bits dynamically for consistent perceived quality
Opus Codec Modes (critical understanding)

SILK mode: Speech codec, 0-8kHz, narrowband. Sounds like a telephone. Triggered by: usedtx=1, low bitrate, OPUS_SIGNAL_VOICE
CELT mode: Music codec, 0-20kHz, fullband. What we want. Triggered by: usedtx=0, higher bitrate, contentHint='music' (maps to OPUS_APPLICATION_AUDIO), maxplaybackrate=48000
Hybrid mode: SILK for <8kHz + CELT for 8-20kHz. Acceptable fallback.

Chrome goog* Constraints (all 8)
These ONLY work at getUserMedia() time. applyConstraints() silently ignores them.
FlagWhat it does to musicgoogEchoCancellationInternal AEC, causes phase artifactsgoogAutoGainControlPrimary AGC, pumps volume up/downgoogAutoGainControl2Secondary AGC, dynamics compressiongoogNoiseSuppressionPrimary noise gate, muffles audiogoogNoiseSuppression2Secondary noise gategoogHighpassFilterKills bass — cuts everything below ~300HzgoogTypingNoiseDetectionKeyboard noise filter, triggers on percussiongoogDuckingLowers audio when voice detected — deadly for music+voice
What contentHint='music' does
Sets OPUS_APPLICATION_AUDIO instead of OPUS_APPLICATION_VOIP in Chrome's encoder configuration. This biases the encoder toward CELT mode and disables some voice-specific optimizations.
Version History

v1-v3: Early attempts. v3 tried maxaveragebitrate=510000 which X Spaces rejected.
v4: Fixed DTX cutting (audio dropping to silence). Had a bug where goog* constraints were passed to applyConstraints (silently ignored). SDP only set usedtx=0.
v5: Proper separation of W3C vs goog* constraints. Added stereo and bitrate SDP params.
v5.1: Added maxplaybackrate=48000 and sprop-maxcapturerate=48000 — fixed "tin can" telephone sound by forcing fullband Opus. Added cbr=1.
v5.2 (CURRENT): Removed cbr=1 (was causing volume compression/squashing of dynamic passages). Added GainNode for manual volume control via mgameGain(n).

Known Constraints & Gotchas

X Spaces may reject SDP params — If something breaks, the SDP params are the first suspects. They can be commented out individually to isolate.
510kbps bitrate was rejected by X Spaces (v3 testing). 128kbps is the tested safe maximum.
Stereo AEC doesn't exist in Chrome — Echo cancellation MUST be disabled for stereo to work. This is fine since we're streaming music, not doing voice chat.
The script does NOT bypass or wrap RTCPeerConnection constructor — it only hooks prototype methods. This is the safe approach that doesn't break X Spaces' internal WebRTC setup.
chrome://webrtc-internals is the debugging tool — shows actual codec mode, bitrate, sample rate being used during a session.

Console Commands

mgameStatus() — Show current config
mgameGain(1.0) — Default volume
mgameGain(1.5) — Boost 50%
mgameGain(0.7) — Reduce 30%

How to Help Me
When I ask for changes:

Always preserve the 4-layer interception architecture
Never re-enable any audio processing flags
Never wrap RTCPeerConnection constructor (breaks X Spaces)
Test SDP param changes conservatively (X Spaces can reject unknown/extreme values)
Keep the script as a single self-contained Tampermonkey userscript
Explain WHY each change works at the WebRTC/Opus level

Key References

RFC 7587: RTP Payload Format for Opus (defines all SDP fmtp parameters)
StackOverflow #29936416: "WebRTC disable all audio processing"
Chromium WebRTC bug #41481053: Stereo requires both stereo=1 AND sprop-stereo=1 in both SDPs
W3C mediacapture-main Issue #457: echoCancellation:false insufficient in practice
Hydrogenaudio Opus wiki: CBR needs 8% more bitrate than VBR for same quality
