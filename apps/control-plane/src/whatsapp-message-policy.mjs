/**
 * Return true when a voice note has no caption and the sender did not address
 * the deployed agent. The platform only transcribes addressed voice notes;
 * forwarding an untagged, captionless note would produce an empty callback
 * payload instead of useful retained context.
 */
export function shouldIgnoreUntaggedVoiceMessage({ voiceMessage, content = '', attention = false } = {}) {
  return Boolean(voiceMessage && !String(content || '').trim() && !attention);
}
