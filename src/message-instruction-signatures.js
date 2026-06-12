import { nip19 } from 'nostr-tools';
import { signNostrEvent } from './auth/nostr.js';

export const AGENT_INSTRUCTION_SIGNATURE_METADATA_KEY = 'agent_instruction_signature';
export const AGENT_INSTRUCTION_SIGNATURE_PROTOCOL = 'flightdeck_pg_message_instruction';
export const AGENT_INSTRUCTION_SIGNATURE_KIND = 33358;

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(value) {
  const input = new TextEncoder().encode(String(value ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return bytesToHex(new Uint8Array(digest));
}

export async function buildAgentInstructionSignature(input, signEvent = signNostrEvent) {
  const body = String(input?.body ?? '');
  const workspaceId = String(input?.workspaceId ?? '').trim();
  const channelId = String(input?.channelId ?? '').trim();
  const threadId = String(input?.threadId ?? '').trim();
  const bodySha256 = await sha256Hex(body);
  const tags = [
    ['protocol', AGENT_INSTRUCTION_SIGNATURE_PROTOCOL],
    ['body_sha256', bodySha256],
  ];
  if (workspaceId) tags.push(['workspace_id', workspaceId]);
  if (channelId) tags.push(['channel_id', channelId]);
  if (threadId) tags.push(['thread_id', threadId]);

  const event = await signEvent({
    kind: AGENT_INSTRUCTION_SIGNATURE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: body,
  });

  return {
    version: 1,
    protocol: AGENT_INSTRUCTION_SIGNATURE_PROTOCOL,
    kind: AGENT_INSTRUCTION_SIGNATURE_KIND,
    signer_npub: nip19.npubEncode(event.pubkey),
    body_sha256: bodySha256,
    nostr_event: event,
  };
}
