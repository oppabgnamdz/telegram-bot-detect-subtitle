const { Telegraf, Markup } = require('telegraf');
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

// Định nghĩa emoji và màu sắc cho tin nhắn
const EMOJI = {
	SUCCESS: '✅',
	ERROR: '❌',
	LOADING: '⏳',
	DOWNLOAD: '📥',
	VIDEO: '🎬',
	SUBTITLE: '🗒️',
	TRANSLATE: '🔄',
	SETTINGS: '⚙️',
	START: '🚀',
};

// Hàm format tin nhắn với màu và biểu tượng
function formatMessage(emoji, title, content = '') {
	return `${emoji} <b>${title}</b>\n${content ? content : ''}`;
}

// Xử lý lỗi
bot.catch((err, ctx) => {
	console.error('Bot error:', err);

	// Chỉ ghi log lỗi, không gửi thông báo lên Telegram
	if (err.message.includes('timeout')) {
		console.error(
			'Quá trình xử lý mất quá nhiều thời gian. Video có thể quá dài.'
		);
	} else if (err.message.includes('whisper')) {
		console.error('Không thể trích xuất phụ đề:', err.message);
	} else if (err.message.includes('download')) {
		console.error('Không thể tải video từ URL đã cung cấp.');
	} else {
		console.error('Lỗi không xác định:', err.message);
	}
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
		formatMessage(
			EMOJI.START,
			'Chào mừng đến với Bot Phụ Đề Tự Động!',
			'Hãy chọn một trong các tùy chọn bên dưới để bắt đầu:'
		),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('Tạo phụ đề mới', 'create_subtitle')],
				[Markup.button.callback('Hướng dẫn sử dụng', 'help')],
			]),
		}
	);
});

// Xử lý lệnh /help
bot.help((ctx) => {
	ctx.reply(
		formatMessage(
			'📚',
			'Hướng dẫn sử dụng Bot Phụ Đề Tự Động',
			'Bạn có thể tạo phụ đề cho video bằng cách cung cấp URL video và prompt dịch thuật.'
		),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('Tạo phụ đề mới', 'create_subtitle')],
				[Markup.button.callback('Quay lại menu chính', 'start')],
			]),
		}
	);
});

// Xử lý nút "Quay lại menu chính"
bot.action('start', async (ctx) => {
	await ctx.answerCbQuery();
	ctx.reply(
		formatMessage(
			EMOJI.START,
			'Menu chính',
			'Hãy chọn một trong các tùy chọn bên dưới:'
		),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('Tạo phụ đề mới', 'create_subtitle')],
				[Markup.button.callback('Hướng dẫn sử dụng', 'help')],
			]),
		}
	);
});

// Xử lý nút "Tạo phụ đề mới"
bot.action('create_subtitle', async (ctx) => {
	await ctx.answerCbQuery();
	await ctx.reply(
		formatMessage(
			EMOJI.VIDEO,
			'Nhập URL video hoặc gửi file',
			'Vui lòng gửi URL trực tiếp đến video (bắt đầu bằng http hoặc https) hoặc gửi file video hay file phụ đề (.srt).'
		),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('Hủy', 'cancel_subtitle')],
			]),
		}
	);
	// Lưu trạng thái người dùng đang chờ nhập URL hoặc gửi file
	const userId = ctx.from.id;
	if (!userStates[userId]) {
		userStates[userId] = {};
	}
	userStates[userId].state = 'waiting_for_url_or_file';
});

// Xử lý nút "Hủy" quá trình tạo phụ đề
bot.action('cancel_subtitle', async (ctx) => {
	await ctx.answerCbQuery();
	const userId = ctx.from.id;
	if (userStates[userId]) {
		userStates[userId].state = 'idle';
	}
	await ctx.reply(
		formatMessage(EMOJI.ERROR, 'Đã hủy', 'Quá trình tạo phụ đề đã bị hủy.'),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('Quay lại menu chính', 'start')],
			]),
		}
	);
});

// Xử lý nút "Hướng dẫn sử dụng"
bot.action('help', async (ctx) => {
	await ctx.answerCbQuery();
	await ctx.reply(
		formatMessage(
			'📚',
			'Hướng dẫn sử dụng Bot Phụ Đề Tự Động',
			`Các bước để tạo phụ đề tự động:\n
1. Nhấn nút <b>Tạo phụ đề mới</b>
2. Nhập URL video (phải là URL trực tiếp)
3. Nhập prompt dịch (mô tả cách bạn muốn dịch phụ đề)
4. Đợi bot xử lý và tải về phụ đề`
		),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('Quay lại menu chính', 'start')],
			]),
		}
	);
});

// Xử lý lệnh /subtitle (command version)
bot.command('subtitle', async (ctx) => {
	const message = ctx.message.text;
	const parts = message.split(' ');

	if (parts.length < 3) {
		return ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'Định dạng không đúng',
				'Vui lòng sử dụng: /subtitle [URL video] [prompt dịch]'
			),
			{ parse_mode: 'HTML' }
		);
	}

	const videoUrl = parts[1];
	const prompt = parts.slice(2).join(' ');

	if (!videoUrl.startsWith('http')) {
		return ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'URL không hợp lệ',
				'Vui lòng cung cấp một URL hợp lệ bắt đầu bằng http hoặc https.'
			),
			{ parse_mode: 'HTML' }
		);
	}

	await processSubtitle(ctx, videoUrl, prompt);
});

// Thiết lập trạng thái người dùng
const userStates = {};

// Xử lý tin nhắn văn bản
bot.on('text', async (ctx) => {
	// Lấy ID của người dùng
	const userId = ctx.from.id;

	// Kiểm tra trạng thái hiện tại của người dùng
	if (!userStates[userId]) {
		userStates[userId] = { state: 'idle' };
	}

	// Nếu người dùng đã gửi lệnh /subtitle truyền thống, chuyển hướng sang flow mới
	if (ctx.message.text.startsWith('/subtitle')) {
		const parts = ctx.message.text.split(' ');
		if (parts.length >= 3) {
			userStates[userId] = {
				state: 'processing',
				videoUrl: parts[1],
				prompt: parts.slice(2).join(' '),
			};
			await processSubtitle(
				ctx,
				userStates[userId].videoUrl,
				userStates[userId].prompt
			);
			userStates[userId].state = 'idle';
			return;
		} else {
			ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'Định dạng không đúng',
					'Vui lòng sử dụng định dạng: /subtitle [URL video] [prompt dịch]'
				),
				{ parse_mode: 'HTML' }
			);
			return;
		}
	}

	// Xử lý theo trạng thái
	switch (userStates[userId].state) {
		case 'waiting_for_url_or_file':
		case 'waiting_for_url':
			// Người dùng đang nhập URL video
			const videoUrl = ctx.message.text.trim();

			if (!videoUrl.startsWith('http')) {
				ctx.reply(
					formatMessage(
						EMOJI.ERROR,
						'URL không hợp lệ',
						'Vui lòng cung cấp một URL hợp lệ bắt đầu bằng http hoặc https hoặc gửi file trực tiếp.'
					),
					{
						parse_mode: 'HTML',
						...Markup.inlineKeyboard([
							[Markup.button.callback('Hủy', 'cancel_subtitle')],
						]),
					}
				);
				return;
			}

			// Lưu URL và chuyển sang trạng thái chờ nhập prompt
			userStates[userId].videoUrl = videoUrl;
			userStates[userId].state = 'waiting_for_prompt';

			ctx.reply(
				formatMessage(
					EMOJI.TRANSLATE,
					'Nhập prompt dịch',
					'Vui lòng nhập nội dung hướng dẫn cách dịch phụ đề (ví dụ: "Dịch sang tiếng Việt, giữ nguyên nghĩa gốc").'
				),
				{
					parse_mode: 'HTML',
					...Markup.inlineKeyboard([
						[Markup.button.callback('Dùng prompt mặc định', 'default_prompt')],
						[Markup.button.callback('Hủy', 'cancel_subtitle')],
					]),
				}
			);
			break;

		case 'waiting_for_prompt':
			// Người dùng đang nhập prompt dịch
			const prompt = ctx.message.text.trim();

			// Lưu prompt và bắt đầu xử lý
			userStates[userId].prompt = prompt;
			userStates[userId].state = 'processing';

			await processSubtitle(
				ctx,
				userStates[userId].videoUrl,
				userStates[userId].prompt
			);

			// Đặt lại trạng thái
			userStates[userId].state = 'idle';
			break;

		default:
			// Trạng thái mặc định - hiển thị menu chính
			ctx.reply(
				formatMessage(
					EMOJI.START,
					'Menu chính',
					'Hãy chọn một trong các tùy chọn bên dưới:'
				),
				{
					parse_mode: 'HTML',
					...Markup.inlineKeyboard([
						[Markup.button.callback('Tạo phụ đề mới', 'create_subtitle')],
						[Markup.button.callback('Hướng dẫn sử dụng', 'help')],
					]),
				}
			);
			break;
	}
});

// Xử lý file được gửi đến
bot.on(['document', 'video'], async (ctx) => {
	const userId = ctx.from.id;

	// Khởi tạo trạng thái người dùng nếu chưa có
	if (!userStates[userId]) {
		userStates[userId] = { state: 'idle' };
	}

	// Chỉ xử lý file khi đang chờ URL/file hoặc người dùng đang ở trạng thái mặc định
	if (
		userStates[userId].state !== 'waiting_for_url_or_file' &&
		userStates[userId].state !== 'idle'
	) {
		return;
	}

	try {
		// Lấy thông tin file
		const fileId = ctx.message.document
			? ctx.message.document.file_id
			: ctx.message.video.file_id;

		const fileName = ctx.message.document
			? ctx.message.document.file_name
			: `video_${Date.now()}.mp4`;

		// Kiểm tra kích thước file
		const fileSize = ctx.message.document
			? ctx.message.document.file_size
			: ctx.message.video.file_size;

		// Giới hạn Telegram là 20MB cho bot
		const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB trong byte

		if (fileSize > MAX_FILE_SIZE) {
			await ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'File quá lớn',
					`Telegram chỉ cho phép bot tải xuống file tối đa 20MB. File của bạn có kích thước ${(fileSize / (1024 * 1024)).toFixed(2)}MB. Vui lòng sử dụng URL trực tiếp đến video hoặc gửi file nhỏ hơn.`
				),
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Tạo tên file an toàn
		const randomHash = crypto.randomBytes(8).toString('hex');
		const fileExt =
			path.extname(fileName) || (ctx.message.document ? '.txt' : '.mp4');
		const safeFileName = `file_${randomHash}${fileExt}`;
		const filePath = path.join(config.uploadPath, safeFileName);

		// Thông báo đang tải file
		const downloadMsg = await ctx.reply(
			formatMessage(
				EMOJI.DOWNLOAD,
				'Đang tải file',
				'Vui lòng đợi trong giây lát...'
			),
			{ parse_mode: 'HTML' }
		);

		try {
			// Tải file từ Telegram
			const fileLink = await ctx.telegram.getFileLink(fileId);
			const fileUrl = fileLink.href;

			// Tải xuống file
			const response = await fetch(fileUrl);

			if (!response.ok) {
				throw new Error(`Không thể tải file: ${response.statusText}`);
			}

			// Sử dụng arrayBuffer thay vì buffer (node-fetch v3+)
			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);

			// Ghi file
			await fs.writeFile(filePath, buffer);

			await ctx.telegram.editMessageText(
				ctx.chat.id,
				downloadMsg.message_id,
				null,
				formatMessage(
					EMOJI.SUCCESS,
					'Đã tải xong file',
					`Kích thước: ${(fs.statSync(filePath).size / (1024 * 1024)).toFixed(2)} MB`
				),
				{ parse_mode: 'HTML' }
			);

			// Nếu là file .srt thì chuyển sang trạng thái đợi prompt
			if (fileExt.toLowerCase() === '.srt') {
				userStates[userId].state = 'waiting_for_prompt';
				userStates[userId].srtPath = filePath;

				await ctx.reply(
					formatMessage(
						EMOJI.TRANSLATE,
						'Đã nhận file phụ đề .srt',
						'Vui lòng nhập nội dung hướng dẫn cách dịch phụ đề (ví dụ: "Dịch sang tiếng Việt, giữ nguyên nghĩa gốc").'
					),
					{
						parse_mode: 'HTML',
						...Markup.inlineKeyboard([
							[
								Markup.button.callback(
									'Dùng prompt mặc định',
									'default_prompt'
								),
							],
							[Markup.button.callback('Hủy', 'cancel_subtitle')],
						]),
					}
				);
			} else {
				// Nếu là file video thì xử lý như video URL
				userStates[userId].state = 'waiting_for_prompt';
				userStates[userId].videoPath = filePath;

				await ctx.reply(
					formatMessage(
						EMOJI.TRANSLATE,
						'Đã nhận file video',
						'Vui lòng nhập nội dung hướng dẫn cách dịch phụ đề (ví dụ: "Dịch sang tiếng Việt, giữ nguyên nghĩa gốc").'
					),
					{
						parse_mode: 'HTML',
						...Markup.inlineKeyboard([
							[
								Markup.button.callback(
									'Dùng prompt mặc định',
									'default_prompt'
								),
							],
							[Markup.button.callback('Hủy', 'cancel_subtitle')],
						]),
					}
				);
			}
		} catch (downloadError) {
			console.error('Lỗi tải file từ Telegram:', downloadError);
			await ctx.telegram.editMessageText(
				ctx.chat.id,
				downloadMsg.message_id,
				null,
				formatMessage(
					EMOJI.ERROR,
					'Không thể tải file',
					'Đã xảy ra lỗi khi tải file từ Telegram. Giới hạn tối đa là 20MB. Vui lòng thử lại với URL hoặc file nhỏ hơn.'
				),
				{ parse_mode: 'HTML' }
			);
		}
	} catch (error) {
		console.error('Lỗi khi xử lý file:', error);
		await ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'Không thể tải file',
				'Đã xảy ra lỗi khi xử lý file. Vui lòng thử lại sau hoặc sử dụng URL thay thế.'
			),
			{ parse_mode: 'HTML' }
		);
		userStates[userId].state = 'idle';
	}
});

// Xử lý nút "Dùng prompt mặc định"
bot.action('default_prompt', async (ctx) => {
	await ctx.answerCbQuery();

	const userId = ctx.from.id;
	if (!userStates[userId]) {
		userStates[userId] = { state: 'idle' };
		return ctx.reply(
			formatMessage(EMOJI.ERROR, 'Lỗi', 'Vui lòng bắt đầu lại quá trình.'),
			{ parse_mode: 'HTML' }
		);
	}

	if (
		userStates[userId].state === 'waiting_for_prompt' &&
		(userStates[userId].videoUrl ||
			userStates[userId].videoPath ||
			userStates[userId].srtPath)
	) {
		// Sử dụng prompt mặc định
		const defaultPrompt =
			'Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên';
		userStates[userId].prompt = defaultPrompt;
		userStates[userId].state = 'processing';

		if (userStates[userId].srtPath) {
			// Nếu là file SRT, chỉ cần dịch không cần trích xuất
			const srtPath = userStates[userId].srtPath;
			await processSrtFile(ctx, srtPath, defaultPrompt);
		} else if (userStates[userId].videoPath) {
			// Nếu là file video đã tải lên
			await processLocalVideo(ctx, userStates[userId].videoPath, defaultPrompt);
		} else {
			// Nếu là URL video
			await processSubtitle(ctx, userStates[userId].videoUrl, defaultPrompt);
		}

		// Đặt lại trạng thái
		userStates[userId].state = 'idle';
		delete userStates[userId].videoUrl;
		delete userStates[userId].videoPath;
		delete userStates[userId].srtPath;
		delete userStates[userId].prompt;
	} else {
		ctx.reply(
			formatMessage(EMOJI.ERROR, 'Lỗi', 'Vui lòng bắt đầu lại quá trình.'),
			{ parse_mode: 'HTML' }
		);
	}
});

// Hàm xử lý file SRT đã tải lên
async function processSrtFile(ctx, srtPath, prompt) {
	try {
		// Thông báo đang xử lý
		await ctx.reply(
			formatMessage(
				EMOJI.LOADING,
				'Đã nhận yêu cầu của bạn',
				'Đang bắt đầu xử lý file SRT...'
			),
			{ parse_mode: 'HTML' }
		);

		// Thông báo đang dịch phụ đề
		const translateMsg = await ctx.reply(
			formatMessage(
				EMOJI.TRANSLATE,
				'Đang dịch phụ đề',
				'Đang sử dụng OpenAI để dịch phụ đề...'
			),
			{ parse_mode: 'HTML' }
		);

		const translatePromise = translateSubtitles(srtPath, prompt);
		const translatedSrtPath = await pTimeout(
			translatePromise,
			BOT_TIMEOUT,
			'Quá thời gian khi dịch phụ đề. Vui lòng thử lại sau.'
		);

		await ctx.telegram.editMessageText(
			ctx.chat.id,
			translateMsg.message_id,
			null,
			formatMessage(
				EMOJI.SUCCESS,
				'Đã dịch phụ đề thành công!',
				'Phụ đề đã được dịch theo yêu cầu của bạn.'
			),
			{ parse_mode: 'HTML' }
		);

		// Gửi file phụ đề gốc
		await ctx.replyWithDocument(
			{
				source: srtPath,
				filename: path.basename(srtPath),
			},
			{
				caption: `${EMOJI.SUBTITLE} Phụ đề gốc`,
				parse_mode: 'HTML',
			}
		);

		// Gửi file phụ đề đã dịch
		await ctx.replyWithDocument(
			{
				source: translatedSrtPath,
				filename: path.basename(translatedSrtPath),
			},
			{
				caption: `${EMOJI.TRANSLATE} Phụ đề tiếng Việt`,
				parse_mode: 'HTML',
			}
		);

		// Thông báo hoàn thành
		await ctx.reply(
			formatMessage(
				EMOJI.SUCCESS,
				'Quá trình dịch phụ đề đã hoàn tất!',
				'Bạn có thể bắt đầu tạo phụ đề mới.'
			),
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([
					[Markup.button.callback('Tạo phụ đề mới', 'create_subtitle')],
					[Markup.button.callback('Quay lại menu chính', 'start')],
				]),
			}
		);
	} catch (error) {
		console.error('Error processing SRT file:', error);
		await ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'Lỗi khi xử lý file SRT',
				'Đã xảy ra lỗi khi xử lý file SRT. Vui lòng thử lại sau.'
			),
			{ parse_mode: 'HTML' }
		);
	} finally {
		// Xóa các file tạm sau khi hoàn tất
		setTimeout(async () => {
			try {
				if (srtPath && fs.existsSync(srtPath)) await fs.unlink(srtPath);
				console.log('Đã xóa file SRT tạm');
			} catch (error) {
				console.error('Error cleaning up temporary files:', error);
			}
		}, 60000); // Xóa sau 1 phút
	}
}

// Hàm xử lý video đã tải lên
async function processLocalVideo(ctx, videoPath, prompt) {
	let srtPath, translatedSrtPath;

	try {
		// Kiểm tra whisper
		const whisperPromise = checkWhisperInstallation();
		const whisperInstalled = await pTimeout(
			whisperPromise,
			BOT_TIMEOUT,
			'Quá thời gian khi kiểm tra cài đặt Whisper'
		);

		if (!whisperInstalled) {
			return ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'Lỗi cài đặt',
					'Whisper chưa được cài đặt hoặc không có trong PATH. Vui lòng liên hệ quản trị viên.'
				),
				{ parse_mode: 'HTML' }
			);
		}

		// Thông báo bắt đầu quá trình
		await ctx.reply(
			formatMessage(
				EMOJI.LOADING,
				'Đã nhận yêu cầu của bạn',
				'Đang bắt đầu xử lý video đã tải lên...'
			),
			{ parse_mode: 'HTML' }
		);

		// Thông báo đang trích xuất phụ đề
		const whisperMsg = await ctx.reply(
			formatMessage(
				EMOJI.SUBTITLE,
				'Đang trích xuất phụ đề',
				`Đang sử dụng Whisper (model: ${config.whisperModel})...\nQuá trình này có thể mất vài phút tùy thuộc vào độ dài video.`
			),
			{ parse_mode: 'HTML' }
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
			formatMessage(
				EMOJI.SUCCESS,
				'Đã trích xuất phụ đề thành công!',
				'Đã nhận dạng đầy đủ nội dung âm thanh của video.'
			),
			{ parse_mode: 'HTML' }
		);

		// Thông báo đang dịch phụ đề
		const translateMsg = await ctx.reply(
			formatMessage(
				EMOJI.TRANSLATE,
				'Đang dịch phụ đề',
				'Đang sử dụng OpenAI để dịch phụ đề...'
			),
			{ parse_mode: 'HTML' }
		);

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
			formatMessage(
				EMOJI.SUCCESS,
				'Đã dịch phụ đề thành công!',
				'Phụ đề đã được dịch theo yêu cầu của bạn.'
			),
			{ parse_mode: 'HTML' }
		);

		// Gửi file phụ đề gốc
		await ctx.replyWithDocument(
			{
				source: srtPath,
				filename: path.basename(srtPath),
			},
			{
				caption: `${EMOJI.SUBTITLE} Phụ đề gốc`,
				parse_mode: 'HTML',
			}
		);

		// Gửi file phụ đề đã dịch
		await ctx.replyWithDocument(
			{
				source: translatedSrtPath,
				filename: path.basename(translatedSrtPath),
			},
			{
				caption: `${EMOJI.TRANSLATE} Phụ đề tiếng Việt`,
				parse_mode: 'HTML',
			}
		);

		// Thông báo hoàn thành
		await ctx.reply(
			formatMessage(
				EMOJI.SUCCESS,
				'Quá trình tạo phụ đề đã hoàn tất!',
				'Bạn có thể bắt đầu tạo phụ đề mới.'
			),
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([
					[Markup.button.callback('Tạo phụ đề mới', 'create_subtitle')],
					[Markup.button.callback('Quay lại menu chính', 'start')],
				]),
			}
		);
	} catch (error) {
		console.error('Error processing local video:', error);
		await ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'Lỗi khi xử lý video',
				'Đã xảy ra lỗi khi xử lý video. Vui lòng thử lại sau.'
			),
			{ parse_mode: 'HTML' }
		);
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
}

// Hàm xử lý tạo phụ đề
async function processSubtitle(ctx, videoUrl, prompt) {
	let videoPath, srtPath, translatedSrtPath;

	try {
		// Kiểm tra whisper
		const whisperPromise = checkWhisperInstallation();
		const whisperInstalled = await pTimeout(
			whisperPromise,
			BOT_TIMEOUT,
			'Quá thời gian khi kiểm tra cài đặt Whisper'
		);

		if (!whisperInstalled) {
			return ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'Lỗi cài đặt',
					'Whisper chưa được cài đặt hoặc không có trong PATH. Vui lòng liên hệ quản trị viên.'
				),
				{ parse_mode: 'HTML' }
			);
		}

		// Thông báo bắt đầu quá trình
		await ctx.reply(
			formatMessage(
				EMOJI.LOADING,
				'Đã nhận yêu cầu của bạn',
				'Đang bắt đầu xử lý...'
			),
			{ parse_mode: 'HTML' }
		);

		// Tạo tên file ngẫu nhiên để tránh xung đột
		const randomHash = crypto.randomBytes(8).toString('hex');
		const fileExt = path.extname(videoUrl) || '.mp4';
		const fileName = `video_${randomHash}${fileExt}`;

		// Thông báo đang tải video
		const downloadMsg = await ctx.reply(
			formatMessage(
				EMOJI.DOWNLOAD,
				'Đang tải video',
				'Vui lòng đợi trong giây lát...'
			),
			{ parse_mode: 'HTML' }
		);

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
			formatMessage(
				EMOJI.SUCCESS,
				'Đã tải xong video',
				`Kích thước: ${(fs.statSync(videoPath).size / (1024 * 1024)).toFixed(2)} MB`
			),
			{ parse_mode: 'HTML' }
		);

		// Thông báo đang trích xuất phụ đề
		const whisperMsg = await ctx.reply(
			formatMessage(
				EMOJI.SUBTITLE,
				'Đang trích xuất phụ đề',
				`Đang sử dụng Whisper (model: ${config.whisperModel})...\nQuá trình này có thể mất vài phút tùy thuộc vào độ dài video.`
			),
			{ parse_mode: 'HTML' }
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
			formatMessage(
				EMOJI.SUCCESS,
				'Đã trích xuất phụ đề thành công!',
				'Đã nhận dạng đầy đủ nội dung âm thanh của video.'
			),
			{ parse_mode: 'HTML' }
		);

		// Thông báo đang dịch phụ đề
		const translateMsg = await ctx.reply(
			formatMessage(
				EMOJI.TRANSLATE,
				'Đang dịch phụ đề',
				'Đang sử dụng OpenAI để dịch phụ đề...'
			),
			{ parse_mode: 'HTML' }
		);

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
			formatMessage(
				EMOJI.SUCCESS,
				'Đã dịch phụ đề thành công!',
				'Phụ đề đã được dịch theo yêu cầu của bạn.'
			),
			{ parse_mode: 'HTML' }
		);

		// Gửi file phụ đề gốc
		await ctx.replyWithDocument(
			{
				source: srtPath,
				filename: path.basename(srtPath),
			},
			{
				caption: `${EMOJI.SUBTITLE} Phụ đề gốc`,
				parse_mode: 'HTML',
			}
		);

		// Gửi file phụ đề đã dịch
		await ctx.replyWithDocument(
			{
				source: translatedSrtPath,
				filename: path.basename(translatedSrtPath),
			},
			{
				caption: `${EMOJI.TRANSLATE} Phụ đề tiếng Việt`,
				parse_mode: 'HTML',
			}
		);

		// Thông báo hoàn thành
		await ctx.reply(
			formatMessage(
				EMOJI.SUCCESS,
				'Quá trình tạo phụ đề đã hoàn tất!',
				'Bạn có thể bắt đầu tạo phụ đề mới.'
			),
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([
					[Markup.button.callback('Tạo phụ đề mới', 'create_subtitle')],
					[Markup.button.callback('Quay lại menu chính', 'start')],
				]),
			}
		);
	} catch (error) {
		console.error('Error processing subtitle command:', error);

		// Chỉ ghi log lỗi, không gửi thông báo lên Telegram
		if (error.message.includes('timeout')) {
			console.error(
				'Quá trình xử lý mất quá nhiều thời gian. Video có thể quá dài.'
			);
		} else if (error.message.includes('whisper')) {
			console.error('Không thể trích xuất phụ đề:', error.message);
		} else if (error.message.includes('download')) {
			console.error('Không thể tải video từ URL đã cung cấp.');
		} else {
			console.error('Lỗi không xác định:', error.message);
		}

		// Đặt lại trạng thái người dùng nếu có
		if (ctx && ctx.from && ctx.from.id && userStates[ctx.from.id]) {
			userStates[ctx.from.id].state = 'idle';
		}
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
}

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
