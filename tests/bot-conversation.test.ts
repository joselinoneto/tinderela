import { describe, expect, it } from 'vitest';
import { buildConversation, cleanContent, threadNameFor } from '../src/bot/conversation.js';
import type { RawMessage } from '../src/bot/conversation.js';

const BOT_ID = 'bot-1';

let seq = 0;
function msg(authorId: string, content: string, at = ++seq): RawMessage {
  return {
    id: `m${at}`,
    authorId,
    authorIsBot: authorId === BOT_ID || authorId.startsWith('bot'),
    content,
    createdTimestamp: at,
  };
}

describe('cleanContent', () => {
  it('strips mentions and collapses whitespace', () => {
    expect(cleanContent('<@!123>   qual o preço  da\nlaranita?')).toBe('qual o preço da laranita?');
  });
});

describe('buildConversation', () => {
  it('orders by timestamp and labels our own messages as assistant', () => {
    const turns = buildConversation(
      [msg('user-1', 'e com a Caterpillar?', 3), msg('user-1', '<@bot> melhor rota?', 1), msg(BOT_ID, 'Três opções: …', 2)],
      BOT_ID,
    );
    expect(turns).toEqual([
      { role: 'user', content: 'melhor rota?' },
      { role: 'assistant', content: 'Três opções: …' },
      { role: 'user', content: 'e com a Caterpillar?' },
    ]);
  });

  it('merges consecutive same-role messages (chunked answers, rapid follow-ups)', () => {
    const turns = buildConversation(
      [msg('user-1', 'rota?', 1), msg(BOT_ID, 'parte 1', 2), msg(BOT_ID, 'parte 2', 3)],
      BOT_ID,
    );
    expect(turns).toHaveLength(2);
    expect(turns[1]).toEqual({ role: 'assistant', content: 'parte 1\nparte 2' });
  });

  it('drops our transient notices, other bots and empty messages', () => {
    const turns = buildConversation(
      [
        msg(BOT_ID, '⏳ Easy there, pilot — try again in 12s.', 1),
        msg('user-1', 'rota?', 2),
        msg(BOT_ID, '⚠️ Something went wrong fetching market data', 3),
        msg('bot-other', 'unrelated bot chatter', 4),
        msg('user-1', '<@bot>', 5),
        msg('user-1', 'e agora?', 6),
      ],
      BOT_ID,
    );
    expect(turns).toEqual([{ role: 'user', content: 'rota?\ne agora?' }]);
  });

  it('deduplicates the same message id', () => {
    const first = msg('user-1', 'rota?', 1);
    expect(buildConversation([first, { ...first }], BOT_ID)).toHaveLength(1);
  });

  it('never starts the stack with an assistant turn once trimmed', () => {
    // Trimming to 3 would cut mid-exchange, leaving the bot's answer first.
    const turns = buildConversation(
      [msg('user-1', 'a', 1), msg(BOT_ID, 'b', 2), msg('user-1', 'c', 3), msg(BOT_ID, 'd', 4)],
      BOT_ID,
      3,
    );
    expect(turns).toEqual([
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ]);
  });

  it('caps at maxTurns keeping the newest', () => {
    const turns = buildConversation(
      [
        msg('user-1', 'old question', 1),
        msg(BOT_ID, 'old answer', 2),
        msg('user-1', 'new question', 3),
      ],
      BOT_ID,
      1,
    );
    expect(turns).toEqual([{ role: 'user', content: 'new question' }]);
  });
});

describe('threadNameFor', () => {
  it('truncates to Discord’s 100-character limit', () => {
    const name = threadNameFor('x'.repeat(200));
    expect(name).toHaveLength(100);
    expect(name.endsWith('…')).toBe(true);
  });

  it('falls back when the question is only a mention', () => {
    expect(threadNameFor('<@123>')).toBe('SC Trade Intel');
  });
});
