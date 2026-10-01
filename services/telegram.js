/**
 * Notificaciones por Telegram Bot API
 * Variables de entorno requeridas:
 *   TELEGRAM_BOT_TOKEN - token del bot
 *   TELEGRAM_CHAT_ID   - chat al que se envían los mensajes
 */

const axios = require('axios');

function isConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Envía un mensaje de texto por Telegram. Nunca lanza error: devuelve true/false.
 * @param {string} message
 * @returns {Promise<boolean>}
 */
async function sendTelegramNotification(message) {
  if (!isConfigured()) {
    return false;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text: message },
      { timeout: 5000 }
    );
    return true;
  } catch (err) {
    const detail = err.response?.data?.description || err.message;
    console.error('[telegram] Error enviando notificación:', detail);
    return false;
  }
}

module.exports = { sendTelegramNotification, isConfigured };
