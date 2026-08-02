import { BOT } from '../config.js';

/** One turn of the message stack handed to the Anthropic API. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** The only fields of a Discord message this module needs. */
export interface RawMessage {
  id: string;
  authorId: string;
  authorIsBot: boolean;
  content: string;
  createdTimestamp: number;
}

/**
 * Notices the bot posts that are not part of the conversation — replaying them
 * as assistant turns would teach the model to answer with them.
 */
const TRANSIENT_PREFIXES = ['⏳', '⚠️'];

/** Strips mention tokens (`<@123>`, `<@!123>`, `<@&123>`) and extra whitespace. */
export function cleanContent(content: string): string {
  return content
    .replace(/<@[!&]?\d+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drops duplicates by message id, keeping the first occurrence. */
function dedupe(messages: readonly RawMessage[]): RawMessage[] {
  const seen = new Set<string>();
  const unique: RawMessage[] = [];
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    unique.push(message);
  }
  return unique;
}

/**
 * Turns a thread's (or DM's) messages into the alternating message stack the
 * API expects: chronological, mentions stripped, our own posts as `assistant`,
 * everyone else's as `user`, consecutive same-role posts merged.
 *
 * The stack always starts with a user turn — the API rejects a leading
 * assistant turn — and is capped at `maxTurns`, newest kept.
 */
export function buildConversation(
  messages: readonly RawMessage[],
  botId: string,
  maxTurns: number = BOT.maxContextTurns,
): ConversationTurn[] {
  const ordered = dedupe([...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp));

  const turns: ConversationTurn[] = [];
  for (const message of ordered) {
    const isOurs = message.authorId === botId;
    // Other bots are noise; our own transient notices are not conversation.
    if (message.authorIsBot && !isOurs) continue;
    if (isOurs && TRANSIENT_PREFIXES.some((prefix) => message.content.startsWith(prefix))) continue;

    const content = cleanContent(message.content);
    if (!content) continue;

    const role = isOurs ? 'assistant' : 'user';
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n${content}`;
    } else {
      turns.push({ role, content });
    }
  }

  const trimmed = turns.slice(-maxTurns);
  while (trimmed.length > 0 && trimmed[0]?.role === 'assistant') trimmed.shift();
  return trimmed;
}

/** A thread title derived from the question, within Discord's length limit. */
export function threadNameFor(question: string): string {
  const limit = BOT.threadNameCharLimit;
  const oneLine = cleanContent(question);
  if (!oneLine) return 'SC Trade Intel';
  return oneLine.length <= limit ? oneLine : `${oneLine.slice(0, limit - 1)}…`;
}
