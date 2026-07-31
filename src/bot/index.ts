import 'dotenv/config';
import { ChannelType, Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { createContext } from '../context.js';
import { TradeAgent } from './agent.js';

// The bot keeps its own cache DB so it never contends with a Claude Code
// session writing cache.db in the same folder.
process.env['SC_TRADE_DB'] ??= 'bot-cache.db';

const COOLDOWN_MS = 30_000;
const DISCORD_MESSAGE_LIMIT = 2_000;

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
export function splitMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
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

client.once(Events.ClientReady, (ready) => {
  console.log(`sc-trade-intel bot logged in as ${ready.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isDm = message.channel.type === ChannelType.DM;
  const mentioned = client.user !== null && message.mentions.has(client.user);
  if (!isDm && !mentioned) return;

  const question = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!question) return;

  const last = cooldowns.get(message.author.id) ?? 0;
  const waitMs = last + COOLDOWN_MS - Date.now();
  if (waitMs > 0) {
    await message.reply(`⏳ Easy there, pilot — try again in ${Math.ceil(waitMs / 1000)}s.`);
    return;
  }
  cooldowns.set(message.author.id, Date.now());

  // Keep the typing indicator alive while the agent works (it expires every ~10s).
  const typing = setInterval(() => {
    if ('sendTyping' in message.channel) message.channel.sendTyping().catch(() => undefined);
  }, 8_000);
  if ('sendTyping' in message.channel) await message.channel.sendTyping().catch(() => undefined);

  try {
    const answer = await agent.answer(question);
    const chunks = splitMessage(answer);
    await message.reply(chunks[0] ?? '…');
    for (const chunk of chunks.slice(1)) {
      if ('send' in message.channel) await message.channel.send(chunk);
    }
  } catch (err) {
    console.error('answer failed:', err);
    await message
      .reply('⚠️ Something went wrong fetching market data — try again in a minute.')
      .catch(() => undefined);
  } finally {
    clearInterval(typing);
  }
});

client.login(token).catch((err) => {
  console.error('Discord login failed:', err);
  process.exit(1);
});
