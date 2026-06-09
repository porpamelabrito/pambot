require('dotenv').config();
const { Telegraf } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const { GoogleGenAI } = require('@google/genai');
const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const axios = require('axios');

// ── Clientes ──────────────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ── Sessão local (guarda tweet pendente) ──────────────────
bot.use(new LocalSession({ database: 'sessions.json' }).middleware());

// ── OAuth 1.0a para X/Twitter ─────────────────────────────
const oauth = OAuth({
  consumer: {
    key: process.env.TWITTER_API_KEY,
    secret: process.env.TWITTER_API_SECRET,
  },
  signature_method: 'HMAC-SHA1',
  hash_function(base, key) {
    return crypto.createHmac('sha1', key).update(base).digest('base64');
  },
});

const twitterToken = {
  key: process.env.TWITTER_ACCESS_TOKEN,
  secret: process.env.TWITTER_ACCESS_SECRET,
};

// ── Melhora o tweet com Gemini ────────────────────────────
async function melhorarTweet(textoOriginal) {
  const prompt = `Você é especialista em copywriting viral para X/Twitter.

Melhore este tweet para uma fotógrafa e videomaker de casamentos, mantendo a voz dela — poética, confiante, emocionalmente impactante.

Regras:
- Máximo 280 caracteres
- No máximo 2 hashtags (só se fizerem sentido)
- Frases curtas e de impacto
- Mantenha a essência do texto original
- Retorne APENAS o tweet melhorado, sem explicações

Tweet original: "${textoOriginal}"`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
  });

  return response.text.trim();
}

// ── Publica no X/Twitter ──────────────────────────────────
async function publicarTweet(texto) {
  const url = 'https://api.twitter.com/2/tweets';
  const requestData = { url, method: 'POST' };
  const headers = oauth.toHeader(oauth.authorize(requestData, twitterToken));

  const response = await axios.post(url, { text: texto }, {
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    }
  });
  return response.data;
}

// ── Comandos ──────────────────────────────────────────────

// /start
bot.command('start', (ctx) => {
  ctx.reply(
    '👋 Oi! Sou o PamBot.\n\n' +
    'Manda seu texto e eu melhoro com IA antes de tuitar.\n\n' +
    '📝 /tweet <seu texto>\n' +
    '✅ /confirmar — publica o tweet melhorado\n' +
    '❌ /cancelar — descarta e começa de novo'
  );
});

// /tweet
bot.command('tweet', async (ctx) => {
  const texto = ctx.message.text.replace('/tweet', '').trim();

  if (!texto) {
    return ctx.reply('Manda o texto assim:\n\n/tweet seu texto aqui');
  }

  await ctx.reply('✨ Melhorando com IA...');

  try {
    const melhorado = await melhorarTweet(texto);

    ctx.session.pendingTweet = melhorado;

    await ctx.reply(
      `*Tweet melhorado:*\n\n"${melhorado}"\n\n_${melhorado.length}/280 caracteres_\n\nPublicar agora?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Publicar', callback_data: 'confirmar' },
            { text: '❌ Cancelar', callback_data: 'cancelar' },
          ]]
        }
      }
    );
  } catch (err) {
    console.error(err);
    ctx.reply('Erro ao processar. Tente novamente.');
  }
});

// Botões inline
bot.action('confirmar', async (ctx) => {
  const texto = ctx.session?.pendingTweet;

  if (!texto) return ctx.answerCbQuery('Nenhum tweet pendente.');

  try {
    await publicarTweet(texto);
    ctx.session.pendingTweet = null;
    await ctx.editMessageText('✅ Tuitado com sucesso!');
  } catch (err) {
    console.error(err);
    await ctx.editMessageText('❌ Erro ao tuitar. Verifique suas keys do X.');
  }
});

bot.action('cancelar', async (ctx) => {
  ctx.session.pendingTweet = null;
  await ctx.editMessageText('Cancelado. Manda outro quando quiser 👍');
});

// /cancelar (comando de texto também)
bot.command('cancelar', (ctx) => {
  ctx.session.pendingTweet = null;
  ctx.reply('Cancelado. Manda outro quando quiser 👍');
});

// ── Inicia o bot ──────────────────────────────────────────
bot.launch();
console.log('🤖 PamBot rodando...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
