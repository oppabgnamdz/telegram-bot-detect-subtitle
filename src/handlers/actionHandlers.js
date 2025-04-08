/**
 * Xử lý các action từ nút bấm callback
 */

const { Markup } = require('telegraf');
const { formatMessage, EMOJI, OPTIONS } = require('../utils/messageFormatter');
const {
	getUserState,
	updateUserState,
	resetUserState,
} = require('../utils/userState');
const {
	processSrtFile,
	processLocalVideo,
	processSubtitle,
} = require('../services/subtitleProcessor');

/**
 * Xử lý nút "Tạo phụ đề mới"
 * @param {object} ctx - Context Telegraf
 */
async function handleCreateSubtitleAction(ctx) {
	await ctx.answerCbQuery();
	await ctx.reply(
		formatMessage(
			EMOJI.VIDEO,
			'Nhập URL video hoặc gửi file',
			'Vui lòng gửi một trong các loại sau:\n- URL video trực tiếp\n- URL YouTube\n- URL stream m3u8\n- Magnet link\n- Torrent file (.torrent)\n- Gửi file video\n- Gửi file phụ đề .srt'
		),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('Hủy', 'cancel_subtitle')],
			]),
		}
	);

	// Cập nhật trạng thái người dùng đang chờ nhập URL hoặc gửi file
	const userId = ctx.from.id;
	updateUserState(userId, 'waiting_for_url_or_file');
}

/**
 * Xử lý nút "Hủy" quá trình tạo phụ đề
 * @param {object} ctx - Context Telegraf
 */
async function handleCancelSubtitleAction(ctx) {
	await ctx.answerCbQuery();
	const userId = ctx.from.id;
	resetUserState(userId);

	await ctx.reply(
		formatMessage(EMOJI.ERROR, 'Đã hủy', 'Quá trình tạo phụ đề đã bị hủy.'),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('Quay lại menu chính', 'start')],
			]),
		}
	);
}

/**
 * Xử lý nút "Dùng prompt mặc định"
 * @param {object} ctx - Context Telegraf
 */
async function handleDefaultPromptAction(ctx) {
	await ctx.answerCbQuery();

	const userId = ctx.from.id;
	const userState = getUserState(userId);

	if (
		userState.state === 'waiting_for_prompt' &&
		(userState.videoUrl || userState.videoPath || userState.srtPath)
	) {
		// Sử dụng prompt mặc định
		const defaultPrompt =
			'Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên';

		// Cập nhật trạng thái và hiển thị tùy chọn output
		updateUserState(userId, 'waiting_for_output_option', {
			prompt: defaultPrompt,
		});

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
	} else {
		ctx.reply(
			formatMessage(EMOJI.ERROR, 'Lỗi', 'Vui lòng bắt đầu lại quá trình.'),
			{ parse_mode: 'HTML' }
		);
	}
}

/**
 * Xử lý nút "Xuất file phụ đề (Tùy chọn 1)"
 * @param {object} ctx - Context Telegraf
 */
async function handleOutputOption1Action(ctx) {
	await ctx.answerCbQuery();
	const userId = ctx.from.id;
	const userState = getUserState(userId);

	if (userState.state !== 'waiting_for_output_option') {
		return ctx.reply(
			formatMessage(EMOJI.ERROR, 'Lỗi', 'Vui lòng bắt đầu lại quá trình.'),
			{ parse_mode: 'HTML' }
		);
	}

	updateUserState(userId, 'processing', { outputOption: OPTIONS.DEFAULT });

	// Xử lý theo loại file
	if (userState.srtPath) {
		// Nếu là file SRT, chỉ cần dịch không cần trích xuất
		await processSrtFile(
			ctx,
			userState.srtPath,
			userState.prompt,
			OPTIONS.DEFAULT
		);
	} else if (userState.videoPath) {
		// Nếu là file video đã tải lên
		await processLocalVideo(
			ctx,
			userState.videoPath,
			userState.prompt,
			OPTIONS.DEFAULT
		);
	} else {
		// Nếu là URL video
		await processSubtitle(
			ctx,
			userState.videoUrl,
			userState.prompt,
			OPTIONS.DEFAULT
		);
	}

	// Đặt lại trạng thái
	resetUserState(userId);
}

/**
 * Xử lý nút "Ghép phụ đề gốc vào video (Tùy chọn 2)"
 * @param {object} ctx - Context Telegraf
 */
async function handleOutputOption2Action(ctx) {
	await ctx.answerCbQuery();
	const userId = ctx.from.id;
	const userState = getUserState(userId);

	if (userState.state !== 'waiting_for_output_option') {
		return ctx.reply(
			formatMessage(EMOJI.ERROR, 'Lỗi', 'Vui lòng bắt đầu lại quá trình.'),
			{ parse_mode: 'HTML' }
		);
	}

	updateUserState(userId, 'processing', {
		outputOption: OPTIONS.MUXED_ORIGINAL,
	});

	// Xử lý theo loại file
	if (userState.srtPath) {
		// Nếu là file SRT, cần video để ghép
		await processSrtFile(
			ctx,
			userState.srtPath,
			userState.prompt,
			OPTIONS.MUXED_ORIGINAL
		);
	} else if (userState.videoPath) {
		// Nếu là file video đã tải lên
		await processLocalVideo(
			ctx,
			userState.videoPath,
			userState.prompt,
			OPTIONS.MUXED_ORIGINAL
		);
	} else {
		// Nếu là URL video
		await processSubtitle(
			ctx,
			userState.videoUrl,
			userState.prompt,
			OPTIONS.MUXED_ORIGINAL
		);
	}

	// Đặt lại trạng thái
	resetUserState(userId);
}

/**
 * Xử lý nút "Ghép phụ đề tiếng Việt vào video (Tùy chọn 3)"
 * @param {object} ctx - Context Telegraf
 */
async function handleOutputOption3Action(ctx) {
	await ctx.answerCbQuery();
	const userId = ctx.from.id;
	const userState = getUserState(userId);

	if (userState.state !== 'waiting_for_output_option') {
		return ctx.reply(
			formatMessage(EMOJI.ERROR, 'Lỗi', 'Vui lòng bắt đầu lại quá trình.'),
			{ parse_mode: 'HTML' }
		);
	}

	updateUserState(userId, 'processing', {
		outputOption: OPTIONS.MUXED_TRANSLATED,
	});

	// Xử lý theo loại file
	if (userState.srtPath) {
		// Nếu là file SRT, cần video để ghép
		await processSrtFile(
			ctx,
			userState.srtPath,
			userState.prompt,
			OPTIONS.MUXED_TRANSLATED
		);
	} else if (userState.videoPath) {
		// Nếu là file video đã tải lên
		await processLocalVideo(
			ctx,
			userState.videoPath,
			userState.prompt,
			OPTIONS.MUXED_TRANSLATED
		);
	} else {
		// Nếu là URL video
		await processSubtitle(
			ctx,
			userState.videoUrl,
			userState.prompt,
			OPTIONS.MUXED_TRANSLATED
		);
	}

	// Đặt lại trạng thái
	resetUserState(userId);
}

module.exports = {
	handleCreateSubtitleAction,
	handleCancelSubtitleAction,
	handleDefaultPromptAction,
	handleOutputOption1Action,
	handleOutputOption2Action,
	handleOutputOption3Action,
};
