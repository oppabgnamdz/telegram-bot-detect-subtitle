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
const {
	checkUserPermission,
	incrementUserCommand,
	isAdmin,
} = require('../utils/userPermission');

/**
 * Xử lý nút "Tạo phụ đề mới"
 * @param {object} ctx - Context Telegraf
 */
async function handleCreateSubtitleAction(ctx) {
	try {
		// Kiểm tra quyền người dùng
		const hasPermission = await checkUserPermission(ctx);
		console.log({ hasPermission });
		if (!hasPermission) {
			await ctx.answerCbQuery(
				'Bạn đã sử dụng hết lượt dùng trong ngày hôm nay.'
			);
			await ctx.reply(
				'🔒 Bạn đã sử dụng hết lượt dùng trong ngày hôm nay. Vui lòng thử lại vào ngày mai hoặc nâng cấp tài khoản.'
			);
			return;
		}

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
	} catch (error) {
		// ... existing code ...
	}
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

	// Sử dụng prompt mặc định
	const defaultPrompt =
		'Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên';

	// Nếu đã có lựa chọn output trước đó (từ handleOutputOption)
	if (userState.state === 'waiting_for_prompt' && userState.outputOption) {
		// Chuyển sang xử lý ngay
		updateUserState(userId, 'processing', {
			prompt: defaultPrompt,
		});

		const option = userState.outputOption;

		// Xử lý theo loại file
		if (userState.srtPath) {
			await processSrtFile(ctx, userState.srtPath, defaultPrompt, option);
		} else if (userState.videoPath) {
			await processLocalVideo(ctx, userState.videoPath, defaultPrompt, option);
		} else {
			await processSubtitle(ctx, userState.videoUrl, defaultPrompt, option);
		}

		// Đặt lại trạng thái
		resetUserState(userId);
		return;
	}

	// Ngược lại, hỏi lựa chọn output
	if (
		userState.state === 'waiting_for_prompt' &&
		(userState.videoUrl || userState.videoPath || userState.srtPath)
	) {
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
 * Xử lý các tùy chọn output
 * @param {object} ctx - Context Telegraf
 * @param {string} option - Tùy chọn output (DEFAULT, MUXED_ORIGINAL, MUXED_TRANSLATED)
 */
async function handleOutputOption(ctx, option) {
	await ctx.answerCbQuery();
	const userId = ctx.from.id;
	const userState = getUserState(userId);

	if (userState.state !== 'waiting_for_output_option') {
		return ctx.reply(
			formatMessage(EMOJI.ERROR, 'Lỗi', 'Vui lòng bắt đầu lại quá trình.'),
			{ parse_mode: 'HTML' }
		);
	}

	// Kiểm tra quyền truy cập cho user default
	const isUserAdmin = await isAdmin(ctx);
	if (!isUserAdmin && option !== OPTIONS.DEFAULT) {
		return ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'Không có quyền truy cập',
				'Tài khoản thường chỉ được phép sử dụng tùy chọn mặc định (Xuất file phụ đề).'
			),
			{ parse_mode: 'HTML' }
		);
	}

	// Nếu chọn ghép phụ đề tiếng Việt vào video, yêu cầu prompt
	if (option === OPTIONS.MUXED_TRANSLATED) {
		updateUserState(userId, 'waiting_for_prompt', {
			videoUrl: userState.videoUrl,
			videoPath: userState.videoPath,
			srtPath: userState.srtPath,
			outputOption: option,
		});

		return await ctx.reply(
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
	}

	// Nếu là các lựa chọn khác, sử dụng prompt mặc định hoặc null
	const defaultPrompt =
		option === OPTIONS.DEFAULT
			? null
			: 'Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên';

	updateUserState(userId, 'processing', {
		outputOption: option,
		prompt: userState.prompt || defaultPrompt,
	});

	// Xử lý theo loại file
	if (userState.srtPath) {
		// Nếu là file SRT, chỉ cần dịch không cần trích xuất
		await processSrtFile(
			ctx,
			userState.srtPath,
			userState.prompt || defaultPrompt,
			option
		);
	} else if (userState.videoPath) {
		// Nếu là file video đã tải lên
		await processLocalVideo(
			ctx,
			userState.videoPath,
			userState.prompt || defaultPrompt,
			option
		);
	} else {
		// Nếu là URL video
		await processSubtitle(
			ctx,
			userState.videoUrl,
			userState.prompt || defaultPrompt,
			option
		);
	}

	// Đặt lại trạng thái
	resetUserState(userId);

	// Nếu xử lý thành công, tăng số lệnh đã dùng
	await incrementUserCommand(ctx);
}

module.exports = {
	handleCreateSubtitleAction,
	handleCancelSubtitleAction,
	handleDefaultPromptAction,
	handleOutputOption1Action: (ctx) => handleOutputOption(ctx, OPTIONS.DEFAULT),
	handleOutputOption2Action: (ctx) =>
		handleOutputOption(ctx, OPTIONS.MUXED_ORIGINAL),
	handleOutputOption3Action: (ctx) =>
		handleOutputOption(ctx, OPTIONS.MUXED_TRANSLATED),
};
