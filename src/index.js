const { Telegraf } = require('telegraf');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const config = require('./config');
const { downloadVideo } = require('./utils/downloader');
const { extractSubtitles } = require('./services/whisperService');
const { translateSubtitles } = require('./services/translationService');
const pTimeout = require('p-timeout');

// Cấu hình thời gian chờ lâu hơn cho các Promise
const BOT_TIMEOUT = 7200000; // 2 giờ (7,200,000 ms)

// Kiểm tra cấu hình
if (!config.telegramToken) {
	console.error(
		'Lỗi: Token Telegram bot không được cấu hình. Vui lòng thêm TELEGRAM_BOT_TOKEN vào file .env.'
	);
	process.exit(1);
}

if (!config.openaiApiKey) {
	console.error(
		'Lỗi: OpenAI API key không được cấu hình. Vui lòng thêm OPENAI_API_KEY vào file .env.'
	);
	process.exit(1);
}

// Khởi tạo bot
const bot = new Telegraf(config.telegramToken);

// Tạo thư mục uploads nếu chưa tồn tại
fs.ensureDirSync(config.uploadPath);

// Xử lý lỗi
bot.catch((err, ctx) => {
	console.error(`Ooops, gặp lỗi cho ${ctx.updateType}:`, err);

	let errorMessage = 'Đã xảy ra lỗi khi xử lý yêu cầu của bạn. ';

	if (err.message.includes('timeout')) {
		errorMessage +=
			'Quá trình xử lý mất quá nhiều thời gian. Vui lòng thử với video ngắn hơn.';
	} else if (err.message.includes('whisper')) {
		errorMessage += 'Không thể trích xuất phụ đề. ' + err.message;
	} else if (err.message.includes('download')) {
		errorMessage += 'Không thể tải video từ URL đã cung cấp.';
	} else {
		errorMessage += 'Vui lòng thử lại sau.';
	}

	ctx.reply(errorMessage);
});

// Kiểm tra cấu hình whisper khi khởi động
async function checkWhisperInstallation() {
	try {
		const { exec } = require('child_process');
		const checkPromise = new Promise((resolve, reject) => {
			exec('which whisper || echo "not found"', (error, stdout, stderr) => {
				const whisperPath = stdout.trim();
				if (whisperPath === 'not found') {
					console.warn(
						'CẢNH BÁO: Whisper không được tìm thấy trong PATH. Bot có thể không hoạt động đúng.'
					);
					resolve(false);
				} else {
					console.log(`Whisper đã được cài đặt tại: ${whisperPath}`);
					resolve(true);
				}
			});
		});

		// Áp dụng timeout dài hơn
		return pTimeout(
			checkPromise,
			BOT_TIMEOUT,
			`Quá thời gian khi kiểm tra cài đặt Whisper`
		);
	} catch (error) {
		console.error('Không thể kiểm tra cài đặt Whisper:', error.message);
		return false;
	}
}

// Xử lý lệnh /start
bot.start((ctx) => {
	ctx.reply(
		'Chào mừng đến với Bot Phụ đề Tự động!\n\n' +
			'Gửi một URL video (direct link hoặc m3u8) và prompt dịch thuật theo định dạng:\n' +
			'/subtitle [URL video] [prompt dịch]\n\n' +
			'Ví dụ:\n/subtitle https://example.com/video.mp4 Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên\n\n' +
			'Hoặc sử dụng định dạng HLS (m3u8):\n/subtitle https://example.com/stream.m3u8 Dịch phụ đề sang tiếng Việt'
	);
});

// Xử lý lệnh /help
bot.help((ctx) => {
	ctx.reply(
		'Cách sử dụng Bot Phụ đề Tự động:\n\n' +
			'Gửi một URL video (direct link hoặc m3u8) và prompt dịch thuật theo định dạng:\n' +
			'/subtitle [URL video] [prompt dịch]\n\n' +
			'Ví dụ:\n/subtitle https://example.com/video.mp4 Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên\n\n' +
			'Hoặc sử dụng định dạng HLS (m3u8):\n/subtitle https://example.com/stream.m3u8 Dịch phụ đề sang tiếng Việt'
	);
});

// Xử lý lệnh /status
bot.command('status', async (ctx) => {
	try {
		const whisperInstalled = await checkWhisperInstallation();
		const statusMessages = [
			`🤖 Bot đang hoạt động`,
			`📂 Thư mục uploads: ${fs.existsSync(config.uploadPath) ? '✅ Tồn tại' : '❌ Không tồn tại'}`,
			`🎯 Model Whisper: ${config.whisperModel}`,
			`🔊 Whisper: ${whisperInstalled ? '✅ Đã cài đặt' : '❌ Chưa cài đặt'}`,
			`🔑 OpenAI API: ${config.openaiApiKey ? '✅ Đã cấu hình' : '❌ Chưa cấu hình'}`,
		];

		ctx.reply(statusMessages.join('\n'));
	} catch (error) {
		console.error('Lỗi khi kiểm tra trạng thái:', error);
		ctx.reply('Đã xảy ra lỗi khi kiểm tra trạng thái hệ thống.');
	}
});

// Xử lý lệnh /subtitle
bot.command('subtitle', async (ctx) => {
	let videoPath, srtPath, translatedSrtPath;

	try {
		const message = ctx.message.text;
		const parts = message.split(' ');

		if (parts.length < 3) {
			return ctx.reply(
				'Định dạng không đúng. Vui lòng sử dụng: /subtitle [URL video] [prompt dịch]'
			);
		}

		const videoUrl = parts[1];
		const prompt = parts.slice(2).join(' ');

		if (!videoUrl.startsWith('http')) {
			return ctx.reply(
				'URL không hợp lệ. Vui lòng cung cấp một URL hợp lệ bắt đầu bằng http hoặc https.'
			);
		}

		// Kiểm tra whisper
		const whisperPromise = checkWhisperInstallation();
		const whisperInstalled = await pTimeout(
			whisperPromise,
			BOT_TIMEOUT,
			'Quá thời gian khi kiểm tra cài đặt Whisper'
		);

		if (!whisperInstalled) {
			return ctx.reply(
				'Whisper chưa được cài đặt hoặc không có trong PATH. Vui lòng liên hệ quản trị viên.'
			);
		}

		// Thông báo bắt đầu quá trình
		await ctx.reply('Đã nhận yêu cầu của bạn. Đang xử lý...');

		// Tạo tên file ngẫu nhiên để tránh xung đột
		const randomHash = crypto.randomBytes(8).toString('hex');
		const fileExt = path.extname(videoUrl) || '.mp4';
		const fileName = `video_${randomHash}${fileExt}`;

		// Thông báo đang tải video
		const downloadMsg = await ctx.reply('Đang tải video...');
		const downloadPromise = downloadVideo(videoUrl, fileName);
		videoPath = await pTimeout(
			downloadPromise,
			BOT_TIMEOUT,
			'Quá thời gian khi tải video. Vui lòng thử với video ngắn hơn hoặc URL khác.'
		);

		await ctx.telegram.editMessageText(
			ctx.chat.id,
			downloadMsg.message_id,
			null,
			'✅ Đã tải xong video. Kích thước: ' +
				(fs.statSync(videoPath).size / (1024 * 1024)).toFixed(2) +
				' MB'
		);

		// Thông báo đang trích xuất phụ đề
		const whisperMsg = await ctx.reply(
			`Đang trích xuất phụ đề bằng Whisper (model: ${config.whisperModel})...\nQuá trình này có thể mất vài phút tùy thuộc vào độ dài video.`
		);

		const extractPromise = extractSubtitles(videoPath);
		srtPath = await pTimeout(
			extractPromise,
			BOT_TIMEOUT,
			'Quá thời gian khi trích xuất phụ đề. Vui lòng thử với video ngắn hơn.'
		);

		await ctx.telegram.editMessageText(
			ctx.chat.id,
			whisperMsg.message_id,
			null,
			'✅ Đã trích xuất phụ đề thành công!'
		);

		// Thông báo đang dịch phụ đề
		const translateMsg = await ctx.reply('Đang dịch phụ đề sang tiếng Việt...');

		const translatePromise = translateSubtitles(srtPath, prompt);
		translatedSrtPath = await pTimeout(
			translatePromise,
			BOT_TIMEOUT,
			'Quá thời gian khi dịch phụ đề. Vui lòng thử lại sau.'
		);

		await ctx.telegram.editMessageText(
			ctx.chat.id,
			translateMsg.message_id,
			null,
			'✅ Đã dịch phụ đề thành công!'
		);

		// Gửi file phụ đề gốc
		await ctx.replyWithDocument(
			{
				source: srtPath,
				filename: path.basename(srtPath),
			},
			{ caption: 'Phụ đề gốc' }
		);

		// Gửi file phụ đề đã dịch
		await ctx.replyWithDocument(
			{
				source: translatedSrtPath,
				filename: path.basename(translatedSrtPath),
			},
			{ caption: 'Phụ đề tiếng Việt' }
		);

		// Thông báo hoàn thành
		await ctx.reply('✅ Quá trình tạo phụ đề đã hoàn tất!');
	} catch (error) {
		console.error('Error processing subtitle command:', error);

		let errorMessage = 'Đã xảy ra lỗi: ';

		if (error.message.includes('timeout')) {
			errorMessage +=
				'Quá trình xử lý mất quá nhiều thời gian. Vui lòng thử với video ngắn hơn.';
		} else if (error.message.includes('whisper')) {
			errorMessage += 'Không thể trích xuất phụ đề. ' + error.message;
		} else if (error.message.includes('download')) {
			errorMessage += 'Không thể tải video từ URL đã cung cấp.';
		} else {
			errorMessage += error.message;
		}

		ctx.reply(errorMessage);
	} finally {
		// Xóa các file tạm sau khi hoàn tất
		setTimeout(async () => {
			try {
				if (videoPath && fs.existsSync(videoPath)) await fs.unlink(videoPath);
				if (srtPath && fs.existsSync(srtPath)) await fs.unlink(srtPath);
				if (translatedSrtPath && fs.existsSync(translatedSrtPath))
					await fs.unlink(translatedSrtPath);
				console.log('Đã xóa các file tạm');
			} catch (error) {
				console.error('Error cleaning up temporary files:', error);
			}
		}, 60000); // Xóa sau 1 phút
	}
});

// Khởi động bot
async function startBot() {
	try {
		// Kiểm tra cài đặt trước khi khởi động
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
