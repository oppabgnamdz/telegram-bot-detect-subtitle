/**
 * Bot Tự Động Tạo Phụ Đề - Main File
 */

const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const config = require('./config');

// Import các handlers
const commandHandlers = require('./handlers/commandHandlers');
const actionHandlers = require('./handlers/actionHandlers');
const fileHandlers = require('./handlers/fileHandlers');
const messageHandlers = require('./handlers/messageHandlers');

// Import dịch vụ xử lý phụ đề và kết nối DB
const { checkWhisperInstallation } = require('./services/subtitleProcessor');
const { connectDB } = require('./utils/db');
const { updateUserInfo } = require('./utils/userPermission');

// Kiểm tra cấu hình
if (!config.telegramToken || !config.openaiApiKey) {
	console.error('Lỗi: Thiếu thông tin cấu hình cần thiết trong file .env');
	process.exit(1);
}

// Khởi tạo bot
const bot = new Telegraf(config.telegramToken);

// Tạo thư mục uploads nếu chưa tồn tại
fs.ensureDirSync(config.uploadPath);

// Middleware để cập nhật thông tin người dùng
bot.use(async (ctx, next) => {
	if (ctx.from) {
		await updateUserInfo(ctx);
	}
	return next();
});

// Xử lý lỗi
bot.catch((err, ctx) => {
	console.error('Bot error:', err);
	const errorMessages = {
		timeout: 'Quá trình xử lý mất quá nhiều thời gian. Video có thể quá dài.',
		whisper: 'Không thể trích xuất phụ đề:',
		download: 'Không thể tải video từ URL đã cung cấp.',
		default: 'Lỗi không xác định:',
	};

	const errorType =
		Object.keys(errorMessages).find((type) =>
			err.message.toLowerCase().includes(type)
		) || 'default';

	console.error(
		errorMessages[errorType],
		errorType !== 'default' ? '' : err.message
	);
});

// Các lệnh cơ bản
bot.start(commandHandlers.handleStartCommand);
bot.help(commandHandlers.handleHelpCommand);
bot.command('admin', commandHandlers.handleAdminCommand);

// Xử lý các action
const actionMap = {
	start: commandHandlers.handleStartAction,
	help: commandHandlers.handleHelpAction,
	create_subtitle: actionHandlers.handleCreateSubtitleAction,
	cancel_subtitle: actionHandlers.handleCancelSubtitleAction,
	default_prompt: actionHandlers.handleDefaultPromptAction,
	output_option_1: actionHandlers.handleOutputOption1Action,
	output_option_2: actionHandlers.handleOutputOption2Action,
	output_option_3: actionHandlers.handleOutputOption3Action,
};

Object.entries(actionMap).forEach(([action, handler]) => {
	bot.action(action, handler);
});

// Xử lý tin nhắn văn bản
bot.on('text', messageHandlers.handleTextMessage);

// Xử lý file được gửi đến
bot.on(['document', 'video'], fileHandlers.handleFileUpload);

// Khởi động bot
async function startBot() {
	try {
		// Kết nối đến MongoDB
		await connectDB();

		await checkWhisperInstallation();
		await bot.launch();
		console.log('Bot đã khởi động thành công!');
		console.log(`Sử dụng model Whisper: ${config.whisperModel}`);
	} catch (err) {
		console.error('Không thể khởi động bot:', err);
	}
}

startBot();

// Xử lý tắt bot một cách an toàn
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
