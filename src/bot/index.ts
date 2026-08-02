import 'dotenv/config';
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  ThreadAutoArchiveDuration,
  type Message,
  type ThreadChannel,
} from 'discord.js';
import { BOT } from '../config.js';
import { createContext } from '../context.js';
import { TradeAgent } from './agent.js';
import {
  buildConversation,
  cleanContent,
  threadNameFor,
  type ConversationTurn,
  type RawMessage,
} from './conversation.js';

// The bot keeps its own cache DB so it never contends with a Claude Code
// session writing cache.db in the same folder.
process.env['SC_TRADE_DB'] ??= 'bot-cache.db';

const token = process.env['DISCORD_BOT_TOKEN'];
if (!token) {
  console.error('DISCORD_BOT_TOKEN is not set — add it to .env');
  process.exit(1);
}
if (!process.env['ANTHROPIC_API_KEY']) {
  console.error('ANTHROPIC_API_KEY is not set — add it to .env');
  process.exit(1);
}

const agent = new TradeAgent(createContext());
const cooldowns = new Map<string, number>();

/** Splits on line boundaries so no chunk exceeds Discord's message limit. */
export function splitMessage(text: string, limit = BOT.messageCharLimit): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const piece = line.length > limit ? line.slice(0, limit - 1) : line;
    if (current.length + piece.length + 1 > limit) {
      if (current) chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // required to receive DMs
});

/** The fields we read off a Discord message, whatever its channel generic. */
interface DiscordMessageLike {
  id: string;
  author: { id: string; bot: boolean };
  content: string;
  createdTimestamp: number;
}

function toRawMessage(message: DiscordMessageLike): RawMessage {
  return {
    id: message.id,
    authorId: message.author.id,
    authorIsBot: message.author.bot,
    content: message.content,
    createdTimestamp: message.createdTimestamp,
  };
}

/**
 * The channel this message continues a conversation in: a thread we opened
 * (every message inside one is a follow-up) or a DM. Null anywhere else —
 * a plain channel message is a fresh question.
 */
function historyChannelOf(channel: Message['channel'], botId: string) {
  if (channel.isThread()) return channel.ownerId === botId ? channel : null;
  if (channel.type === ChannelType.DM) return channel;
  return null;
}

/** A channel whose past messages we replay as conversation context. */
type HistoryChannel = NonNullable<ReturnType<typeof historyChannelOf>>;

/**
 * Rebuilds the message stack from the thread (or DM): its own messages plus
 * the message the thread was started from, which is the player's opening
 * question and lives in the parent channel.
 */
async function fetchConversation(
  channel: HistoryChannel,
  latest: DiscordMessageLike,
  botId: string,
): Promise<ConversationTurn[]> {
  const raw: RawMessage[] = [];

  if (channel.isThread()) {
    const history = await channel.messages.fetch({ limit: BOT.historyFetchLimit });
    for (const message of history.values()) raw.push(toRawMessage(message));
    const starter = await channel.fetchStarterMessage().catch(() => null);
    if (starter) raw.push(toRawMessage(starter));
  } else {
    const history = await channel.messages.fetch({ limit: BOT.historyFetchLimit });
    for (const message of history.values()) raw.push(toRawMessage(message));
  }

  raw.push(toRawMessage(latest)); // in case it lands after the fetch
  return buildConversation(raw, botId);
}

/**
 * Opens the thread the answer goes into, so the player's reply lands back in
 * the same thread and becomes context. Returns null when threads are not
 * available here (missing permission, or a channel that cannot hold them) —
 * the caller then answers in place, single-shot as before.
 */
async function openThread(message: Message, question: string): Promise<ThreadChannel | null> {
  if (message.hasThread && message.thread) return message.thread;
  if (!('threads' in message.channel)) return null;
  try {
    return await message.startThread({
      name: threadNameFor(question),
      // Discord only accepts a fixed set of durations; config picks one.
      autoArchiveDuration: BOT.threadAutoArchiveMinutes as ThreadAutoArchiveDuration,
    });
  } catch (err) {
    console.error('could not open a thread, answering in channel:', err);
    return null;
  }
}

/**
 * Posts `text` where the conversation lives: inside a thread we just opened,
 * or as a reply to the message otherwise.
 */
async function deliver(
  message: Message,
  thread: ThreadChannel | null,
  text: string,
): Promise<void> {
  const chunks = splitMessage(text);
  if (thread) {
    for (const chunk of chunks) await thread.send(chunk);
    return;
  }
  await message.reply(chunks[0] ?? '…');
  for (const chunk of chunks.slice(1)) {
    if ('send' in message.channel) await message.channel.send(chunk);
  }
}

client.once(Events.ClientReady, (ready) => {
  console.log(`sc-trade-intel bot logged in as ${ready.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const botId = client.user?.id;
  if (!botId) return;

  // Inside our own thread (or a DM) every message is a follow-up, so no
  // mention is needed; elsewhere the bot only answers when mentioned.
  const history = historyChannelOf(message.channel, botId);
  const mentioned = client.user !== null && message.mentions.has(client.user);
  if (history === null && !mentioned) return;

  const question = cleanContent(message.content);
  if (!question) return;

  // Follow-ups inside a thread we opened are one conversation — a cooldown
  // there would only interrupt it. New questions and DMs still pay it.
  const inOwnThread = history !== null && message.channel.isThread();
  if (!inOwnThread) {
    const last = cooldowns.get(message.author.id) ?? 0;
    const waitMs = last + BOT.cooldownMs - Date.now();
    if (waitMs > 0) {
      await message.reply(`⏳ Easy there, pilot — try again in ${Math.ceil(waitMs / 1000)}s.`);
      return;
    }
    cooldowns.set(message.author.id, Date.now());
  }

  // A fresh question gets its own thread, so the player's reply intuitively
  // lands in it. Follow-ups and DMs are answered where they were asked.
  const thread = history === null ? await openThread(message, question) : null;
  const typingIn = thread ?? message.channel;

  // Keep the typing indicator alive while the agent works (it expires every ~10s).
  const typing = setInterval(() => {
    if ('sendTyping' in typingIn) typingIn.sendTyping().catch(() => undefined);
  }, 8_000);
  if ('sendTyping' in typingIn) await typingIn.sendTyping().catch(() => undefined);

  try {
    // A brand-new thread holds nothing yet, so the question is the whole stack.
    const conversation: ConversationTurn[] =
      history === null
        ? [{ role: 'user', content: question }]
        : await fetchConversation(history, message, botId);
    if (conversation.length === 0) conversation.push({ role: 'user', content: question });

    await deliver(message, thread, await agent.answer(conversation));
  } catch (err) {
    console.error('answer failed:', err);
    await deliver(
      message,
      thread,
      '⚠️ Something went wrong fetching market data — try again in a minute.',
    ).catch(() => undefined);
  } finally {
    clearInterval(typing);
  }
});

client.login(token).catch((err) => {
  console.error('Discord login failed:', err);
  process.exit(1);
});
