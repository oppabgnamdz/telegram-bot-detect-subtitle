require('dotenv').config();

module.exports = {
	telegramToken: process.env.TELEGRAM_BOT_TOKEN,
	openaiApiKey: process.env.OPENAI_API_KEY,
	whisperModel: process.env.WHISPER_MODEL || 'tiny',
	uploadPath: process.env.UPLOAD_PATH || './uploads',
};
