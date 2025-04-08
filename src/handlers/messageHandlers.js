/**
 * Xử lý tin nhắn văn bản
 */

const { Markup } = require('telegraf');
const { formatMessage, EMOJI, OPTIONS } = require('../utils/messageFormatter');
const {
	getUserState,
	updateUserState,
	resetUserState,
} = require('../utils/userState');
const {
	processSubtitle,
	processLocalVideo,
	processSrtFile,
} = require('../services/subtitleProcessor');
const {
	isYouTubeUrl,
	isM3U8Url,
	isMagnetUrl,
	isTorrentUrl,
} = require('../utils/downloader');

/**
 * Xử lý lệnh /subtitle truyền thống
 * @param {object} ctx - Context Telegraf
 * @param {string} userId - ID của người dùng
 * @returns {Promise<boolean>} Đã xử lý thành công hay không
 */
async function handleLegacySubtitleCommand(ctx, userId) {
	const parts = ctx.message.text.split(' ');
	if (parts.length >= 3) {
		updateUserState(userId, 'processing', {
			videoUrl: parts[1],
			prompt: parts.slice(2).join(' '),
			outputOption: OPTIONS.DEFAULT,
		});

		await processSubtitle(
			ctx,
			parts[1],
			parts.slice(2).join(' '),
			OPTIONS.DEFAULT
		);

		resetUserState(userId);
		return true;
	} else {
		ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'Định dạng không đúng',
				'Vui lòng sử dụng định dạng: /subtitle [URL video] [prompt dịch]'
			),
			{ parse_mode: 'HTML' }
		);
		return true;
	}
}

/**
 * Xử lý URL video
 * @param {object} ctx - Context Telegraf
 * @param {string} userId - ID của người dùng
 * @param {string} videoUrl - URL video
 */
async function handleVideoUrl(ctx, userId, videoUrl) {
	if (!videoUrl.startsWith('http') && !videoUrl.startsWith('magnet:')) {
		ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'URL không hợp lệ',
				'Vui lòng cung cấp một URL hợp lệ bắt đầu bằng http, https hoặc magnet:. Bot hỗ trợ URL video trực tiếp, YouTube, stream m3u8, magnet link và file torrent.'
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

	let urlTypeInfo = '';
	if (isYouTubeUrl(videoUrl)) {
		urlTypeInfo =
			'Đã phát hiện URL YouTube. Bot sẽ tự động xử lý video YouTube.';
	} else if (isM3U8Url(videoUrl)) {
		urlTypeInfo =
			'Đã phát hiện URL HLS (m3u8). Bot sẽ tự động xử lý stream HLS.';
	} else if (isMagnetUrl(videoUrl)) {
		urlTypeInfo =
			'Đã phát hiện Magnet link. Bot sẽ tự động tải video từ nguồn P2P.';
	} else if (isTorrentUrl(videoUrl)) {
		urlTypeInfo =
			'Đã phát hiện Torrent URL. Bot sẽ tự động tải video từ torrent.';
	}

	// Cập nhật trạng thái với URL video nhưng trực tiếp yêu cầu chọn kiểu xuất kết quả
	updateUserState(userId, 'waiting_for_output_option', {
		videoUrl,
		prompt: null, // Prompt sẽ được yêu cầu sau nếu cần
	});

	await ctx.reply(
		formatMessage(
			EMOJI.OPTIONS,
			'Chọn kiểu xuất kết quả',
			`${urlTypeInfo ? urlTypeInfo + '\n\n' : ''}Vui lòng chọn cách bạn muốn nhận kết quả:`
		),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[
					Markup.button.callback(
						'1. Xuất file phụ đề (mặc định)',
						'output_option_1'
					),
				],
				[
					Markup.button.callback(
						'2. Ghép phụ đề gốc vào video',
						'output_option_2'
					),
				],
				[
					Markup.button.callback(
						'3. Ghép phụ đề tiếng Việt vào video',
						'output_option_3'
					),
				],
				[Markup.button.callback('Hủy', 'cancel_subtitle')],
			]),
		}
	);
}

/**
 * Xử lý prompt dịch
 * @param {object} ctx - Context Telegraf
 * @param {string} userId - ID của người dùng
 * @param {string} prompt - Nội dung prompt
 */
async function handleTranslationPrompt(ctx, userId, prompt) {
	const userState = getUserState(userId);

	// Kiểm tra xem đã có lựa chọn output trước đó chưa
	if (userState.outputOption) {
		// Nếu đã có lựa chọn output (từ handleOutputOption), tiến hành xử lý ngay
		updateUserState(userId, 'processing', { prompt });

		const selectedOption = userState.outputOption;

		if (userState.srtPath) {
			await processSrtFile(ctx, userState.srtPath, prompt, selectedOption);
		} else if (userState.videoPath) {
			await processLocalVideo(ctx, userState.videoPath, prompt, selectedOption);
		} else {
			await processSubtitle(ctx, userState.videoUrl, prompt, selectedOption);
		}

		resetUserState(userId);
		return;
	}

	// Nếu chưa có lựa chọn output, hỏi người dùng chọn
	updateUserState(userId, 'waiting_for_output_option', { prompt });

	await ctx.reply(
		formatMessage(
			EMOJI.OPTIONS,
			'Chọn kiểu xuất kết quả',
			'Vui lòng chọn cách bạn muốn nhận kết quả:'
		),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[
					Markup.button.callback(
						'1. Xuất file phụ đề (mặc định)',
						'output_option_1'
					),
				],
				[
					Markup.button.callback(
						'2. Ghép phụ đề gốc vào video',
						'output_option_2'
					),
				],
				[
					Markup.button.callback(
						'3. Ghép phụ đề tiếng Việt vào video',
						'output_option_3'
					),
				],
				[Markup.button.callback('Hủy', 'cancel_subtitle')],
			]),
		}
	);
}

/**
 * Xử lý tùy chọn output
 * @param {object} ctx - Context Telegraf
 * @param {string} userId - ID của người dùng
 * @param {string} optionText - Tùy chọn người dùng nhập
 * @param {object} userState - Trạng thái người dùng
 */
async function handleOutputOption(ctx, userId, optionText, userState) {
	let selectedOption = OPTIONS.DEFAULT;

	if (optionText === '1') {
		selectedOption = OPTIONS.DEFAULT;
	} else if (optionText === '2') {
		selectedOption = OPTIONS.MUXED_ORIGINAL;
	} else if (optionText === '3') {
		selectedOption = OPTIONS.MUXED_TRANSLATED;
	} else {
		await ctx.reply(
			formatMessage(
				EMOJI.INFO,
				'Tùy chọn không hợp lệ',
				'Sử dụng tùy chọn mặc định: Xuất file phụ đề'
			),
			{ parse_mode: 'HTML' }
		);
	}

	updateUserState(userId, 'processing', { outputOption: selectedOption });

	if (userState.srtPath) {
		await processSrtFile(
			ctx,
			userState.srtPath,
			userState.prompt,
			selectedOption
		);
	} else if (userState.videoPath) {
		await processLocalVideo(
			ctx,
			userState.videoPath,
			userState.prompt,
			selectedOption
		);
	} else {
		await processSubtitle(
			ctx,
			userState.videoUrl,
			userState.prompt,
			selectedOption
		);
	}

	resetUserState(userId);
}

/**
 * Xử lý tin nhắn văn bản
 * @param {object} ctx - Context Telegraf
 */
async function handleTextMessage(ctx) {
	const userId = ctx.from.id;
	const userState = getUserState(userId);

	if (ctx.message.text.startsWith('/subtitle')) {
		if (await handleLegacySubtitleCommand(ctx, userId)) {
			return;
		}
	}

	switch (userState.state) {
		case 'waiting_for_url_or_file':
		case 'waiting_for_url':
			await handleVideoUrl(ctx, userId, ctx.message.text.trim());
			break;

		case 'waiting_for_prompt':
			await handleTranslationPrompt(ctx, userId, ctx.message.text.trim());
			break;

		case 'waiting_for_output_option':
			await handleOutputOption(ctx, userId, ctx.message.text.trim(), userState);
			break;

		default:
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
}

module.exports = {
	handleTextMessage,
};
