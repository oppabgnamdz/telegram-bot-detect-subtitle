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
const { DEFAULT_PROMPTS } = require('../utils/constants');

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
					[Markup.button.callback('Dùng prompt 18+', 'use_prompt_adult')],
					[Markup.button.callback('Dùng prompt phim', 'use_prompt_movie')],
					[Markup.button.callback('Dùng prompt anime', 'use_prompt_anime')],
					[
						Markup.button.callback(
							'Dùng prompt hội thoại',
							'use_prompt_conversation'
						),
					],
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

/**
 * Xử lý action tạo phụ đề mới
 * @param {object} ctx - Context Telegraf
 */
const handleCreateSubtitleActionNew = async (ctx) => {
	try {
		await ctx.answerCbQuery();

		const userId = ctx.from.id.toString();
		resetUserState(userId); // Reset trạng thái người dùng

		// Cập nhật trạng thái người dùng
		updateUserState(userId, 'waiting_for_url');

		await ctx.editMessageText(
			formatMessage(
				EMOJI.URL,
				'Tạo phụ đề mới',
				'Vui lòng gửi URL video hoặc tải lên file video trực tiếp.\n\nBot hỗ trợ:\n• URL video trực tiếp (.mp4, .webm, ...)\n• YouTube (youtube.com, youtu.be)\n• Stream HLS (m3u8)\n• Magnet link (magnet:...)\n• Torrent file (.torrent)'
			),
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([
					[Markup.button.callback('Hủy', 'cancel_subtitle')],
				]),
			}
		);
	} catch (error) {
		console.error('Error in handleCreateSubtitleAction:', error);
	}
};

/**
 * Xử lý action hủy quá trình tạo phụ đề
 * @param {object} ctx - Context Telegraf
 */
const handleCancelSubtitleActionNew = async (ctx) => {
	try {
		await ctx.answerCbQuery();

		const userId = ctx.from.id.toString();
		resetUserState(userId); // Reset trạng thái người dùng

		await ctx.editMessageText(
			formatMessage(EMOJI.CANCEL, 'Đã hủy', 'Quá trình tạo phụ đề đã bị hủy.'),
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([
					[Markup.button.callback('Quay lại menu chính', 'start')],
				]),
			}
		);
	} catch (error) {
		console.error('Error in handleCancelSubtitleAction:', error);
	}
};

/**
 * Xử lý action chọn prompt mặc định
 * @param {object} ctx - Context Telegraf
 */
const handleDefaultPromptActionNew = async (ctx) => {
	try {
		await ctx.answerCbQuery();

		const userId = ctx.from.id.toString();
		const userState = getUserState(userId);

		if (!userState) {
			// Nếu không có trạng thái người dùng, quay về màn hình chính
			await ctx.editMessageText(
				formatMessage(
					EMOJI.ERROR,
					'Lỗi',
					'Phiên làm việc của bạn đã hết hạn. Vui lòng bắt đầu lại.'
				),
				{
					parse_mode: 'HTML',
					...Markup.inlineKeyboard([
						[Markup.button.callback('Quay lại menu chính', 'start')],
					]),
				}
			);
			return;
		}

		// Hiển thị danh sách prompt mặc định
		await ctx.editMessageText(
			formatMessage(
				EMOJI.PROMPT,
				'Chọn prompt mặc định',
				'Vui lòng chọn một trong các prompt mẫu dưới đây hoặc tự nhập prompt của riêng bạn:'
			),
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([
					[
						Markup.button.callback(
							'Tự động phát hiện ngôn ngữ',
							'auto_detect_language'
						),
					],
					[Markup.button.callback('Dịch thông thường', 'use_prompt_normal')],
					[Markup.button.callback('Dịch phim/phụ đề', 'use_prompt_movie')],
					[Markup.button.callback('Dịch anime/manga', 'use_prompt_anime')],
					[
						Markup.button.callback(
							'Dịch hội thoại tự nhiên',
							'use_prompt_conversation'
						),
					],
					[Markup.button.callback('Dịch phụ đề 18+', 'use_prompt_adult')],
					[Markup.button.callback('Tự nhập prompt', 'custom_prompt')],
					[Markup.button.callback('Hủy', 'cancel_subtitle')],
				]),
			}
		);
	} catch (error) {
		console.error('Error in handleDefaultPromptAction:', error);
	}
};

/**
 * Xử lý action chọn tùy chọn xuất kết quả 1 (xuất file phụ đề)
 * @param {object} ctx - Context Telegraf
 */
const handleOutputOption1Action = async (ctx) => {
	await handleOutputOption(ctx, OPTIONS.DEFAULT);
};

/**
 * Xử lý action chọn tùy chọn xuất kết quả 2 (ghép phụ đề gốc vào video)
 * @param {object} ctx - Context Telegraf
 */
const handleOutputOption2Action = async (ctx) => {
	await handleOutputOption(ctx, OPTIONS.MUXED_ORIGINAL);
};

/**
 * Xử lý action chọn tùy chọn xuất kết quả 3 (ghép phụ đề tiếng Việt vào video)
 * @param {object} ctx - Context Telegraf
 */
const handleOutputOption3Action = async (ctx) => {
	await handleOutputOption(ctx, OPTIONS.MUXED_TRANSLATED);
};

/**
 * Xử lý action chọn tùy chọn xuất kết quả
 * @param {object} ctx - Context Telegraf
 * @param {number} option - Tùy chọn xuất kết quả (OPTIONS.DEFAULT, OPTIONS.MUXED_ORIGINAL, OPTIONS.MUXED_TRANSLATED)
 */
async function handleOutputOptionNew(ctx, option) {
	try {
		await ctx.answerCbQuery();

		const userId = ctx.from.id.toString();
		const userState = getUserState(userId);

		if (!userState) {
			// Nếu không có trạng thái người dùng, quay về màn hình chính
			await ctx.editMessageText(
				formatMessage(
					EMOJI.ERROR,
					'Lỗi',
					'Phiên làm việc của bạn đã hết hạn. Vui lòng bắt đầu lại.'
				),
				{
					parse_mode: 'HTML',
					...Markup.inlineKeyboard([
						[Markup.button.callback('Quay lại menu chính', 'start')],
					]),
				}
			);
			return;
		}

		// Cập nhật lựa chọn xuất kết quả
		updateUserState(userId, userState.state, {
			...userState,
			outputOption: option,
		});

		// Nếu đã có prompt, tiến hành xử lý
		if (userState.prompt) {
			await handleProcess(ctx, userId, option);
			return;
		}

		// Nếu chưa có prompt, yêu cầu nhập prompt
		await ctx.editMessageText(
			formatMessage(
				EMOJI.PROMPT,
				'Nhập prompt dịch thuật',
				'Vui lòng nhập prompt mô tả cách bạn muốn dịch phụ đề sang tiếng Việt.\nVí dụ: "Dịch phụ đề này sang tiếng Việt, giữ nguyên ý nghĩa gốc"'
			),
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([
					[Markup.button.callback('Chọn prompt mẫu', 'default_prompt')],
					[Markup.button.callback('Dùng prompt phim', 'use_prompt_movie')],
					[Markup.button.callback('Dùng prompt anime', 'use_prompt_anime')],
					[
						Markup.button.callback(
							'Dịch hội thoại tự nhiên',
							'use_prompt_conversation'
						),
					],
					[Markup.button.callback('Dùng prompt 18+', 'use_prompt_adult')],
					[Markup.button.callback('Tự nhập prompt', 'custom_prompt')],
					[Markup.button.callback('Hủy', 'cancel_subtitle')],
				]),
			}
		);

		// Cập nhật trạng thái người dùng
		updateUserState(userId, 'waiting_for_prompt');
	} catch (error) {
		console.error('Error in handleOutputOption:', error);
	}
}

/**
 * Xử lý chọn prompt mẫu
 */
const handleUsePromptAction = async (ctx, promptType) => {
	try {
		await ctx.answerCbQuery();

		const userId = ctx.from.id.toString();
		const userState = getUserState(userId);

		if (!userState) {
			// Nếu không có trạng thái người dùng, quay về màn hình chính
			await ctx.editMessageText(
				formatMessage(
					EMOJI.ERROR,
					'Lỗi',
					'Phiên làm việc của bạn đã hết hạn. Vui lòng bắt đầu lại.'
				),
				{
					parse_mode: 'HTML',
					...Markup.inlineKeyboard([
						[Markup.button.callback('Quay lại menu chính', 'start')],
					]),
				}
			);
			return;
		}

		let prompt = DEFAULT_PROMPTS.normal;
		switch (promptType) {
			case 'normal':
				prompt = DEFAULT_PROMPTS.normal;
				break;
			case 'movie':
				prompt = DEFAULT_PROMPTS.movie;
				break;
			case 'anime':
				prompt = DEFAULT_PROMPTS.anime;
				break;
			case 'conversation':
				prompt = DEFAULT_PROMPTS.conversation;
				break;
			case 'adult':
				prompt = DEFAULT_PROMPTS.adult;
				break;
			case 'auto':
				// Sẽ chuyển sang tự động phát hiện ngôn ngữ
				prompt = '';
				break;
			default:
				prompt = DEFAULT_PROMPTS.normal;
		}

		// Cập nhật prompt
		updateUserState(userId, 'processing', {
			...userState,
			prompt,
		});

		// Hiển thị thông báo chờ xử lý
		await ctx.editMessageText(
			formatMessage(
				promptType === 'auto' ? EMOJI.LOADING : EMOJI.PROMPT,
				promptType === 'auto'
					? 'Đang tự động phát hiện ngôn ngữ'
					: 'Đã chọn prompt',
				promptType === 'auto'
					? 'Hệ thống sẽ tự động phát hiện ngôn ngữ của video và đề xuất prompt phù hợp.\nĐang bắt đầu xử lý, vui lòng đợi trong giây lát...'
					: `Đã chọn prompt: "${prompt}"\nĐang bắt đầu xử lý, vui lòng đợi trong giây lát...`
			),
			{
				parse_mode: 'HTML',
			}
		);

		// Tiến hành xử lý
		await handleProcess(ctx, userId, userState.outputOption);
	} catch (error) {
		console.error('Error in handleUsePromptAction:', error);
	}
};

/**
 * Xử lý khi người dùng chọn tự nhập prompt
 */
const handleCustomPromptAction = async (ctx) => {
	try {
		await ctx.answerCbQuery();

		const userId = ctx.from.id.toString();
		const userState = getUserState(userId);

		if (!userState) {
			// Nếu không có trạng thái người dùng, quay về màn hình chính
			await ctx.editMessageText(
				formatMessage(
					EMOJI.ERROR,
					'Lỗi',
					'Phiên làm việc của bạn đã hết hạn. Vui lòng bắt đầu lại.'
				),
				{
					parse_mode: 'HTML',
					...Markup.inlineKeyboard([
						[Markup.button.callback('Quay lại menu chính', 'start')],
					]),
				}
			);
			return;
		}

		// Yêu cầu người dùng nhập prompt
		await ctx.editMessageText(
			formatMessage(
				EMOJI.PROMPT,
				'Nhập prompt dịch thuật',
				'Vui lòng nhập prompt mô tả cách bạn muốn dịch phụ đề sang tiếng Việt.\nVí dụ: "Dịch phụ đề này sang tiếng Việt, giữ nguyên ý nghĩa gốc"'
			),
			{
				parse_mode: 'HTML',
				...Markup.inlineKeyboard([
					[Markup.button.callback('Quay lại', 'default_prompt')],
					[Markup.button.callback('Dùng prompt phim', 'use_prompt_movie')],
					[Markup.button.callback('Dùng prompt anime', 'use_prompt_anime')],
					[
						Markup.button.callback(
							'Dịch hội thoại tự nhiên',
							'use_prompt_conversation'
						),
					],
					[Markup.button.callback('Dùng prompt 18+', 'use_prompt_adult')],
					[Markup.button.callback('Hủy', 'cancel_subtitle')],
				]),
			}
		);

		// Cập nhật trạng thái người dùng
		updateUserState(userId, 'waiting_for_prompt');
	} catch (error) {
		console.error('Error in handleCustomPromptAction:', error);
	}
};

/**
 * Xử lý quá trình tạo phụ đề
 * @param {object} ctx - Context Telegraf
 * @param {string} userId - ID của người dùng
 * @param {number} option - Tùy chọn xuất kết quả
 */
async function handleProcess(ctx, userId, option) {
	try {
		const userState = getUserState(userId);

		if (!userState) {
			return;
		}

		// Đánh dấu đang xử lý
		updateUserState(userId, 'processing');

		// Tiến hành xử lý dựa trên loại video
		if (userState.srtPath) {
			// Nếu là file SRT
			await processSrtFile(ctx, userState.srtPath, userState.prompt, option);
		} else if (userState.videoPath) {
			// Nếu là video được tải lên
			await processLocalVideo(
				ctx,
				userState.videoPath,
				userState.prompt,
				option
			);
		} else if (userState.videoUrl) {
			// Nếu là URL video
			await processSubtitle(ctx, userState.videoUrl, userState.prompt, option);
		} else {
			// Nếu không có thông tin video
			await ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'Lỗi',
					'Không có thông tin video được cung cấp. Vui lòng thử lại.'
				),
				{
					parse_mode: 'HTML',
					...Markup.inlineKeyboard([
						[Markup.button.callback('Tạo phụ đề mới', 'create_subtitle')],
						[Markup.button.callback('Quay lại menu chính', 'start')],
					]),
				}
			);
		}

		// Reset trạng thái người dùng sau khi hoàn tất
		resetUserState(userId);
	} catch (error) {
		console.error('Error in handleProcess:', error);
	}
}

// Xuất các hàm xử lý action
module.exports = {
	handleCreateSubtitleAction,
	handleCancelSubtitleAction,
	handleDefaultPromptAction,
	handleOutputOption1Action,
	handleOutputOption2Action,
	handleOutputOption3Action,
	handleUsePromptNormal: (ctx) => handleUsePromptAction(ctx, 'normal'),
	handleUsePromptMovie: (ctx) => handleUsePromptAction(ctx, 'movie'),
	handleUsePromptAnime: (ctx) => handleUsePromptAction(ctx, 'anime'),
	handleUsePromptConversation: (ctx) =>
		handleUsePromptAction(ctx, 'conversation'),
	handleUsePromptAdult: (ctx) => handleUsePromptAction(ctx, 'adult'),
	handleUseAutoDetectLanguage: (ctx) => handleUsePromptAction(ctx, 'auto'),
	handleCustomPromptAction,
};
