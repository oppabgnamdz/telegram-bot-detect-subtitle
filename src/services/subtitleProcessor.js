/**
 * Dịch vụ xử lý phụ đề
 */

const fs = require('fs-extra');
const path = require('path');
const pTimeout = require('p-timeout');
const { Markup } = require('telegraf');
const { extractSubtitles } = require('./whisperService');
const { translateSubtitles } = require('./translationService');
const { downloadVideo } = require('../utils/downloader');
const { EMOJI, formatMessage, OPTIONS } = require('../utils/messageFormatter');
const config = require('../config');
const { uploadToStreamtape } = require('./streamtapeService');
const { isAdmin } = require('../utils/userPermission');
const { checkUserPermission } = require('../utils/userPermission');
const {
	detectLanguage,
	suggestTranslationPrompt,
} = require('./languageDetectionService');

// Cấu hình thời gian chờ lâu hơn cho các Promise
const BOT_TIMEOUT = 7200000; // 2 giờ (7,200,000 ms)

/**
 * Kiểm tra cài đặt faster-whisper khi khởi động
 * @returns {Promise<boolean>} - Trả về true nếu faster-whisper đã được cài đặt
 */
async function checkWhisperInstallation() {
	try {
		const { exec } = require('child_process');
		const checkPromise = new Promise((resolve, reject) => {
			// Kiểm tra faster-whisper thông qua pip list
			exec(
				'pip list | grep -q faster-whisper && echo "found" || echo "not found"',
				(error, stdout, stderr) => {
					const fasterWhisperStatus = stdout.trim();
					if (fasterWhisperStatus === 'not found') {
						console.warn(
							'CẢNH BÁO: Faster-Whisper không được tìm thấy. Bot có thể không hoạt động đúng.'
						);
						resolve(false);
					} else {
						// Kiểm tra phiên bản faster-whisper
						exec(
							'pip show faster-whisper | grep Version',
							(error, stdout, stderr) => {
								if (error) {
									console.log(
										'Faster-Whisper đã được cài đặt nhưng không thể xác định phiên bản.'
									);
									resolve(true);
								} else {
									const versionLine = stdout.trim();
									console.log(`Faster-Whisper đã được cài đặt: ${versionLine}`);
									resolve(true);
								}
							}
						);
					}
				}
			);
		});

		// Áp dụng timeout dài hơn
		return pTimeout(
			checkPromise,
			BOT_TIMEOUT,
			`Quá thời gian khi kiểm tra cài đặt Faster-Whisper`
		);
	} catch (error) {
		console.error('Không thể kiểm tra cài đặt Faster-Whisper:', error.message);
		return false;
	}
}

/**
 * Xử lý file SRT đã tải lên
 * @param {object} ctx - Context Telegraf
 * @param {string} srtPath - Đường dẫn đến file SRT
 * @param {string} prompt - Prompt dịch thuật
 * @param {number} option - Tùy chọn xuất kết quả
 */
async function processSrtFile(ctx, srtPath, prompt, option = OPTIONS.DEFAULT) {
	try {
		// Kiểm tra quyền người dùng
		const hasPermission = await checkUserPermission(ctx);
		if (!hasPermission) {
			await ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'Không có quyền truy cập',
					'Bạn đã sử dụng hết lượt dùng trong ngày hôm nay. Vui lòng thử lại vào ngày mai hoặc nâng cấp tài khoản.'
				),
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Thông báo đang xử lý
		await ctx.reply(
			formatMessage(
				EMOJI.LOADING,
				'Đã nhận yêu cầu của bạn',
				'Đang bắt đầu xử lý file SRT...'
			),
			{ parse_mode: 'HTML' }
		);

		// Kiểm tra quyền truy cập OpenAI cho user default
		const isUserAdmin = await isAdmin(ctx);
		if (!isUserAdmin && option === OPTIONS.DEFAULT) {
			// Nếu là user default và chọn option mặc định, chỉ trả về file gốc
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

			// Thông báo hoàn thành
			await ctx.reply(
				formatMessage(
					EMOJI.SUCCESS,
					'Quá trình xử lý đã hoàn tất!',
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
			return;
		}

		// Thông báo đang dịch phụ đề
		const translateMsg = await ctx.reply(
			formatMessage(
				EMOJI.TRANSLATE,
				'Đang dịch phụ đề',
				'Đang sử dụng OpenAI để dịch phụ đề...'
			),
			{ parse_mode: 'HTML' }
		);

		const translatePromise = translateSubtitles(
			srtPath,
			prompt,
			ctx.chat.id,
			ctx
		);
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

		// Xử lý theo tùy chọn đã chọn
		if (option === OPTIONS.DEFAULT) {
			// Tùy chọn mặc định: Trả về 2 file gốc và dịch
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
		} else if (
			option === OPTIONS.MUXED_ORIGINAL ||
			option === OPTIONS.MUXED_TRANSLATED
		) {
			// Cho tùy chọn 2 và 3, cần video để ghép
			await ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'Không thể ghép phụ đề vào video',
					'Bạn đã gửi file phụ đề .srt mà không có file video. Vui lòng gửi file video để sử dụng tùy chọn ghép phụ đề vào video.'
				),
				{ parse_mode: 'HTML' }
			);

			// Gửi file phụ đề gốc và đã dịch dù không thể ghép
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
		}

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
		console.error('Lỗi xử lý file SRT:', error);
		await ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'Lỗi xử lý',
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
		}, 3600000); // Xóa sau 1 giờ
	}
}

/**
 * Xử lý video đã tải lên
 * @param {object} ctx - Context Telegraf
 * @param {string} videoPath - Đường dẫn đến file video
 * @param {string} prompt - Prompt dịch thuật
 * @param {number} option - Tùy chọn xuất kết quả
 */
async function processLocalVideo(
	ctx,
	videoPath,
	prompt,
	option = OPTIONS.DEFAULT
) {
	try {
		// Kiểm tra quyền người dùng
		const hasPermission = await checkUserPermission(ctx);
		if (!hasPermission) {
			await ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'Không có quyền truy cập',
					'Bạn đã sử dụng hết lượt dùng trong ngày hôm nay. Vui lòng thử lại vào ngày mai hoặc nâng cấp tài khoản.'
				),
				{ parse_mode: 'HTML' }
			);
			return;
		}

		let srtPath, translatedSrtPath, muxedVideoPath;

		// Kiểm tra faster-whisper
		const whisperPromise = checkWhisperInstallation();
		const whisperInstalled = await pTimeout(
			whisperPromise,
			BOT_TIMEOUT,
			`Quá thời gian khi kiểm tra cài đặt Faster-Whisper`
		);

		if (!whisperInstalled) {
			// Trả về thông báo lỗi
			await ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'Lỗi hệ thống',
					'Faster-Whisper chưa được cài đặt hoặc không có. Vui lòng liên hệ quản trị viên.'
				),
				{ parse_mode: 'HTML' }
			);
			return;
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

		// Nếu không có prompt cụ thể, tự động phát hiện ngôn ngữ
		if (!prompt || prompt.trim() === '') {
			// Thông báo đang phát hiện ngôn ngữ
			const detectingMsg = await ctx.reply(
				formatMessage(
					EMOJI.LOADING,
					'Đang xử lý với tiếng Nhật',
					'Đang phân tích âm thanh tiếng Nhật của video...'
				),
				{ parse_mode: 'HTML' }
			);

			try {
				// Phát hiện ngôn ngữ từ video
				const languageInfo = await detectLanguage(videoPath);

				// Tạo prompt gợi ý dựa trên ngôn ngữ phát hiện được
				const suggestedPrompt = suggestTranslationPrompt(languageInfo);

				// Cập nhật tin nhắn với kết quả phát hiện ngôn ngữ
				await ctx.telegram.editMessageText(
					ctx.chat.id,
					detectingMsg.message_id,
					null,
					formatMessage(
						EMOJI.SUCCESS,
						'Đã chọn tiếng Nhật',
						`Đã tự động chọn ngôn ngữ: ${languageInfo.name}\n\nSử dụng prompt gợi ý: "${suggestedPrompt}"`
					),
					{ parse_mode: 'HTML' }
				);

				// Sử dụng prompt gợi ý
				prompt = suggestedPrompt;
			} catch (error) {
				console.error('Lỗi khi phát hiện ngôn ngữ:', error);
				// Cập nhật tin nhắn thông báo lỗi
				await ctx.telegram.editMessageText(
					ctx.chat.id,
					detectingMsg.message_id,
					null,
					formatMessage(
						EMOJI.WARNING,
						'Không thể phát hiện ngôn ngữ',
						'Không thể tự động xác định ngôn ngữ. Đang sử dụng prompt mặc định.'
					),
					{ parse_mode: 'HTML' }
				);

				// Sử dụng prompt mặc định
				prompt =
					'Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên';
			}
		}

		// Thông báo đang trích xuất phụ đề
		const whisperMsg = await ctx.reply(
			formatMessage(
				EMOJI.LOADING,
				'Đang trích xuất phụ đề',
				`Đang sử dụng Faster-Whisper (model: ${config.whisperModel}, ngôn ngữ: Tiếng Nhật)...\nQuá trình này có thể mất 2-5 phút tùy thuộc vào độ dài video.`
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

		// Gửi file phụ đề gốc ngay sau khi trích xuất thành công
		await ctx.replyWithDocument(
			{
				source: srtPath,
				filename: path.basename(srtPath),
			},
			{
				caption: `${EMOJI.SUBTITLE} Phụ đề gốc đã trích xuất`,
				parse_mode: 'HTML',
			}
		);
		const isUserAdmin = await isAdmin(ctx);
		if (!isUserAdmin) {
			return;
		}

		// Xử lý theo tùy chọn đã chọn
		if (option === OPTIONS.DEFAULT) {
			// Tùy chọn mặc định: Trả về 2 file gốc và dịch
			// Thông báo đang dịch phụ đề
			const translateMsg = await ctx.reply(
				formatMessage(
					EMOJI.TRANSLATE,
					'Đang dịch phụ đề',
					'Đang sử dụng OpenAI để dịch phụ đề...'
				),
				{ parse_mode: 'HTML' }
			);

			const translatePromise = translateSubtitles(
				srtPath,
				prompt,
				ctx.chat.id,
				ctx
			);
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
		} else if (option === OPTIONS.MUXED_ORIGINAL) {
			// Tùy chọn 2: Ghép subtitle gốc vào video
			// Thông báo đang ghép phụ đề gốc vào video
			const muxingOriginalMsg = await ctx.reply(
				formatMessage(
					EMOJI.LOADING,
					'Đang ghép phụ đề gốc vào video',
					'Vui lòng đợi trong giây lát...'
				),
				{ parse_mode: 'HTML' }
			);

			// Import dịch vụ ghép
			const {
				muxSubtitleToVideo,
				getDirectDownloadLink,
			} = require('./muxingService');

			// Ghép phụ đề gốc vào video với các tùy chọn
			const muxedOriginalPath = await muxSubtitleToVideo(videoPath, srtPath, {
				language: 'eng', // Ngôn ngữ gốc
				font: 'Arial',
				fontSize: 18, // Giảm kích thước chữ từ 24 xuống 18
				fontColor: 'white',
				position: 'bottom',
				skipFormatCheck: true, // Bỏ qua kiểm tra định dạng video
				telegramInfo: {
					ctx,
					messageId: muxingOriginalMsg.message_id,
				},
				style: {
					primaryColour: '&H00FFFF', // Màu vàng
					outlineColour: '&H000000', // Màu đen cho viền
					backColour: '&H00000000', // Màu nền trong suốt
					borderStyle: 1, // Kiểu viền (1 = viền mỏng)
					outline: 1, // Độ dày viền
					shadow: 0, // Không có bóng đổ
				},
			});

			// Tạo URL tải trực tiếp
			const directLink = getDirectDownloadLink(muxedOriginalPath);

			await ctx.telegram.editMessageText(
				ctx.chat.id,
				muxingOriginalMsg.message_id,
				null,
				formatMessage(
					EMOJI.SUCCESS,
					'Đã ghép phụ đề gốc vào video thành công!',
					`Kích thước: ${(fs.statSync(muxedOriginalPath).size / (1024 * 1024)).toFixed(2)} MB\n\nLink tải trực tiếp: ${directLink}`
				),
				{ parse_mode: 'HTML' }
			);

			// Lưu đường dẫn để xóa file sau khi hoàn tất
			muxedVideoPath = muxedOriginalPath;
		} else if (option === OPTIONS.MUXED_TRANSLATED) {
			// Tùy chọn 3: Ghép subtitle đã dịch vào video
			// Thông báo đang dịch phụ đề
			const translateMsg = await ctx.reply(
				formatMessage(
					EMOJI.TRANSLATE,
					'Đang dịch phụ đề',
					'Đang sử dụng OpenAI để dịch phụ đề...'
				),
				{ parse_mode: 'HTML' }
			);

			const translatePromise = translateSubtitles(
				srtPath,
				prompt,
				ctx.chat.id,
				ctx
			);
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

			// Thông báo đang ghép phụ đề đã dịch vào video
			const muxingTranslatedMsg = await ctx.reply(
				formatMessage(
					EMOJI.LOADING,
					'Đang ghép phụ đề tiếng Việt vào video',
					'Vui lòng đợi trong giây lát...'
				),
				{ parse_mode: 'HTML' }
			);

			// Import dịch vụ ghép
			const {
				muxSubtitleToVideo,
				getDirectDownloadLink,
			} = require('./muxingService');

			// Ghép phụ đề đã dịch vào video với các tùy chọn
			const muxedTranslatedPath = await muxSubtitleToVideo(
				videoPath,
				translatedSrtPath,
				{
					language: 'vie', // Ngôn ngữ tiếng Việt
					font: 'Arial',
					fontSize: 18, // Giảm kích thước chữ từ 24 xuống 18
					fontColor: 'white',
					position: 'bottom',
					skipFormatCheck: true, // Bỏ qua kiểm tra định dạng video
					telegramInfo: {
						ctx,
						messageId: muxingTranslatedMsg.message_id,
					},
					style: {
						primaryColour: '&H00FFFF', // Màu vàng
						outlineColour: '&H000000', // Màu đen cho viền
						backColour: '&H00000000', // Màu nền trong suốt
						borderStyle: 1, // Kiểu viền (1 = viền mỏng)
						outline: 1, // Độ dày viền
						shadow: 0, // Không có bóng đổ
					},
				}
			);

			await ctx.telegram.editMessageText(
				ctx.chat.id,
				muxingTranslatedMsg.message_id,
				null,
				formatMessage(
					EMOJI.SUCCESS,
					'Đã ghép phụ đề tiếng Việt vào video thành công!',
					`Kích thước: ${(fs.statSync(muxedTranslatedPath).size / (1024 * 1024)).toFixed(2)} MB`
				),
				{ parse_mode: 'HTML' }
			);

			// Lưu đường dẫn để xóa file sau khi hoàn tất
			muxedVideoPath = muxedTranslatedPath;
		}

		// Thông báo đang upload lên Streamtape
		const uploadMsg = await ctx.reply(
			formatMessage(
				EMOJI.UPLOAD,
				'Đang upload video lên Streamtape',
				'Vui lòng đợi trong giây lát...'
			),
			{ parse_mode: 'HTML' }
		);

		try {
			// Upload video lên Streamtape
			const streamtapeUrl = await uploadToStreamtape(muxedVideoPath);

			// Cập nhật thông báo với URL Streamtape
			await ctx.telegram.editMessageText(
				ctx.chat.id,
				uploadMsg.message_id,
				null,
				formatMessage(
					EMOJI.SUCCESS,
					'Đã upload video thành công!',
					`Link video: ${streamtapeUrl}`
				),
				{ parse_mode: 'HTML' }
			);

			// Xóa các file tạm sau khi upload thành công
			if (videoPath && fs.existsSync(videoPath)) await fs.unlink(videoPath);
			if (srtPath && fs.existsSync(srtPath)) await fs.unlink(srtPath);
			if (translatedSrtPath && fs.existsSync(translatedSrtPath))
				await fs.unlink(translatedSrtPath);
			if (muxedVideoPath && fs.existsSync(muxedVideoPath))
				await fs.unlink(muxedVideoPath);
			console.log('Đã xóa các file tạm sau khi upload thành công');
		} catch (error) {
			// Xử lý lỗi upload
			console.error('Error processing subtitle:', error);

			// Cập nhật thông báo với lỗi
			await ctx.telegram.editMessageText(
				ctx.chat.id,
				uploadMsg.message_id,
				null,
				formatMessage(
					EMOJI.ERROR,
					'Không thể upload video lên Streamtape',
					`Lỗi: ${error.message}\n\nVui lòng thử lại với video nhỏ hơn hoặc sử dụng tùy chọn xuất file phụ đề.`
				),
				{ parse_mode: 'HTML' }
			);
		}

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
				if (muxedVideoPath && fs.existsSync(muxedVideoPath))
					await fs.unlink(muxedVideoPath);
				console.log('Đã xóa các file tạm');
			} catch (error) {
				console.error('Error cleaning up temporary files:', error);
			}
		}, 3600000); // Xóa sau 1 giờ để người dùng có thời gian tải file
	}
}

/**
 * Xử lý tạo phụ đề từ URL video
 * @param {object} ctx - Context Telegraf
 * @param {string} videoUrl - URL của video
 * @param {string} prompt - Prompt dịch thuật
 * @param {number} option - Tùy chọn xuất kết quả
 */
async function processSubtitle(
	ctx,
	videoUrl,
	prompt,
	option = OPTIONS.DEFAULT
) {
	try {
		// Kiểm tra quyền người dùng
		const hasPermission = await checkUserPermission(ctx);
		if (!hasPermission) {
			await ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'Không có quyền truy cập',
					'Bạn đã sử dụng hết lượt dùng trong ngày hôm nay. Vui lòng thử lại vào ngày mai hoặc nâng cấp tài khoản.'
				),
				{ parse_mode: 'HTML' }
			);
			return;
		}

		let videoPath, srtPath, translatedSrtPath, muxedVideoPath;

		// Kiểm tra faster-whisper
		const whisperPromise = checkWhisperInstallation();
		const whisperInstalled = await pTimeout(
			whisperPromise,
			BOT_TIMEOUT,
			`Quá thời gian khi kiểm tra cài đặt Faster-Whisper`
		);

		if (!whisperInstalled) {
			// Trả về thông báo lỗi
			await ctx.reply(
				formatMessage(
					EMOJI.ERROR,
					'Lỗi hệ thống',
					'Faster-Whisper chưa được cài đặt hoặc không có. Vui lòng liên hệ quản trị viên.'
				),
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Thông báo bắt đầu quá trình
		await ctx.reply(
			formatMessage(
				EMOJI.LOADING,
				'Đã nhận yêu cầu của bạn',
				'Đang bắt đầu tải video...'
			),
			{ parse_mode: 'HTML' }
		);

		// Tải video
		const downloadMsg = await ctx.reply(
			formatMessage(
				EMOJI.DOWNLOAD,
				'Đang tải video',
				'Vui lòng đợi trong giây lát...'
			),
			{ parse_mode: 'HTML' }
		);

		const downloadPromise = downloadVideo(videoUrl);
		videoPath = await pTimeout(
			downloadPromise,
			BOT_TIMEOUT,
			'Quá thời gian khi tải video. Vui lòng thử lại sau.'
		);

		await ctx.telegram.editMessageText(
			ctx.chat.id,
			downloadMsg.message_id,
			null,
			formatMessage(
				EMOJI.SUCCESS,
				'Đã tải video thành công!',
				`Kích thước: ${(fs.statSync(videoPath).size / (1024 * 1024)).toFixed(2)} MB`
			),
			{ parse_mode: 'HTML' }
		);

		// Nếu không có prompt cụ thể, tự động phát hiện ngôn ngữ
		if (!prompt || prompt.trim() === '') {
			// Thông báo đang phát hiện ngôn ngữ
			const detectingMsg = await ctx.reply(
				formatMessage(
					EMOJI.LOADING,
					'Đang xử lý với tiếng Nhật',
					'Đang phân tích âm thanh tiếng Nhật của video...'
				),
				{ parse_mode: 'HTML' }
			);

			try {
				// Phát hiện ngôn ngữ từ video
				const languageInfo = await detectLanguage(videoPath);

				// Tạo prompt gợi ý dựa trên ngôn ngữ phát hiện được
				const suggestedPrompt = suggestTranslationPrompt(languageInfo);

				// Cập nhật tin nhắn với kết quả phát hiện ngôn ngữ
				await ctx.telegram.editMessageText(
					ctx.chat.id,
					detectingMsg.message_id,
					null,
					formatMessage(
						EMOJI.SUCCESS,
						'Đã chọn tiếng Nhật',
						`Đã tự động chọn ngôn ngữ: ${languageInfo.name}\n\nSử dụng prompt gợi ý: "${suggestedPrompt}"`
					),
					{ parse_mode: 'HTML' }
				);

				// Sử dụng prompt gợi ý
				prompt = suggestedPrompt;
			} catch (error) {
				console.error('Lỗi khi phát hiện ngôn ngữ:', error);
				// Cập nhật tin nhắn thông báo lỗi
				await ctx.telegram.editMessageText(
					ctx.chat.id,
					detectingMsg.message_id,
					null,
					formatMessage(
						EMOJI.WARNING,
						'Không thể phát hiện ngôn ngữ',
						'Không thể tự động xác định ngôn ngữ. Đang sử dụng prompt mặc định.'
					),
					{ parse_mode: 'HTML' }
				);

				// Sử dụng prompt mặc định
				prompt =
					'Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên';
			}
		}

		// Thông báo đang trích xuất phụ đề
		const whisperMsg = await ctx.reply(
			formatMessage(
				EMOJI.LOADING,
				'Đang trích xuất phụ đề',
				`Đang sử dụng Faster-Whisper (model: ${config.whisperModel}, ngôn ngữ: Tiếng Nhật)...\nQuá trình này có thể mất 2-5 phút tùy thuộc vào độ dài video.`
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

		// Gửi file phụ đề gốc ngay sau khi trích xuất thành công
		await ctx.replyWithDocument(
			{
				source: srtPath,
				filename: path.basename(srtPath),
			},
			{
				caption: `${EMOJI.SUBTITLE} Phụ đề gốc đã trích xuất`,
				parse_mode: 'HTML',
			}
		);
		const isUserAdmin = await isAdmin(ctx);

		if (!isUserAdmin) {
			return;
		}

		// Xử lý theo tùy chọn đã chọn
		if (option === OPTIONS.DEFAULT && isUserAdmin) {
			// Tùy chọn mặc định: Trả về 2 file gốc và dịch
			// Thông báo đang dịch phụ đề
			const translateMsg = await ctx.reply(
				formatMessage(
					EMOJI.TRANSLATE,
					'Đang dịch phụ đề',
					'Đang sử dụng OpenAI để dịch phụ đề...'
				),
				{ parse_mode: 'HTML' }
			);

			const translatePromise = translateSubtitles(
				srtPath,
				prompt,
				ctx.chat.id,
				ctx
			);
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
			if (option === OPTIONS.DEFAULT) {
				return;
			}

			// đã gửi file rồi

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
		} else if (option === OPTIONS.MUXED_ORIGINAL) {
			// Tùy chọn 2: Ghép subtitle gốc vào video
			// Thông báo đang ghép phụ đề gốc vào video
			const muxingOriginalMsg = await ctx.reply(
				formatMessage(
					EMOJI.LOADING,
					'Đang ghép phụ đề gốc vào video',
					'Vui lòng đợi trong giây lát...'
				),
				{ parse_mode: 'HTML' }
			);

			// Import dịch vụ ghép
			const {
				muxSubtitleToVideo,
				getDirectDownloadLink,
			} = require('./muxingService');

			// Ghép phụ đề gốc vào video với các tùy chọn
			const muxedOriginalPath = await muxSubtitleToVideo(videoPath, srtPath, {
				language: 'eng', // Ngôn ngữ gốc
				font: 'Arial',
				fontSize: 18, // Giảm kích thước chữ từ 24 xuống 18
				fontColor: 'white',
				position: 'bottom',
				skipFormatCheck: true, // Bỏ qua kiểm tra định dạng video
				telegramInfo: {
					ctx,
					messageId: muxingOriginalMsg.message_id,
				},
				style: {
					primaryColour: '&H00FFFF', // Màu vàng
					outlineColour: '&H000000', // Màu đen cho viền
					backColour: '&H00000000', // Màu nền trong suốt
					borderStyle: 1, // Kiểu viền (1 = viền mỏng)
					outline: 1, // Độ dày viền
					shadow: 0, // Không có bóng đổ
				},
			});

			// Tạo URL tải trực tiếp
			const directLink = getDirectDownloadLink(muxedOriginalPath);

			await ctx.telegram.editMessageText(
				ctx.chat.id,
				muxingOriginalMsg.message_id,
				null,
				formatMessage(
					EMOJI.SUCCESS,
					'Đã ghép phụ đề gốc vào video thành công!',
					`Kích thước: ${(fs.statSync(muxedOriginalPath).size / (1024 * 1024)).toFixed(2)} MB\n\nLink tải trực tiếp: ${directLink}`
				),
				{ parse_mode: 'HTML' }
			);

			// Lưu đường dẫn để xóa file sau khi hoàn tất
			muxedVideoPath = muxedOriginalPath;
		} else if (option === OPTIONS.MUXED_TRANSLATED) {
			// Tùy chọn 3: Ghép subtitle đã dịch vào video
			// Thông báo đang dịch phụ đề
			const translateMsg = await ctx.reply(
				formatMessage(
					EMOJI.TRANSLATE,
					'Đang dịch phụ đề',
					'Đang sử dụng OpenAI để dịch phụ đề...'
				),
				{ parse_mode: 'HTML' }
			);

			const translatePromise = translateSubtitles(
				srtPath,
				prompt,
				ctx.chat.id,
				ctx
			);
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

			// Thông báo đang ghép phụ đề đã dịch vào video
			const muxingTranslatedMsg = await ctx.reply(
				formatMessage(
					EMOJI.LOADING,
					'Đang ghép phụ đề tiếng Việt vào video',
					'Vui lòng đợi trong giây lát...'
				),
				{ parse_mode: 'HTML' }
			);

			// Import dịch vụ ghép
			const {
				muxSubtitleToVideo,
				getDirectDownloadLink,
			} = require('./muxingService');

			// Ghép phụ đề đã dịch vào video với các tùy chọn
			const muxedTranslatedPath = await muxSubtitleToVideo(
				videoPath,
				translatedSrtPath,
				{
					language: 'vie', // Ngôn ngữ tiếng Việt
					font: 'Arial',
					fontSize: 18, // Giảm kích thước chữ từ 24 xuống 18
					fontColor: 'white',
					position: 'bottom',
					skipFormatCheck: true, // Bỏ qua kiểm tra định dạng video
					telegramInfo: {
						ctx,
						messageId: muxingTranslatedMsg.message_id,
					},
					style: {
						primaryColour: '&H00FFFF', // Màu vàng
						outlineColour: '&H000000', // Màu đen cho viền
						backColour: '&H00000000', // Màu nền trong suốt
						borderStyle: 1, // Kiểu viền (1 = viền mỏng)
						outline: 1, // Độ dày viền
						shadow: 0, // Không có bóng đổ
					},
				}
			);

			await ctx.telegram.editMessageText(
				ctx.chat.id,
				muxingTranslatedMsg.message_id,
				null,
				formatMessage(
					EMOJI.SUCCESS,
					'Đã ghép phụ đề tiếng Việt vào video thành công!',
					`Kích thước: ${(fs.statSync(muxedTranslatedPath).size / (1024 * 1024)).toFixed(2)} MB`
				),
				{ parse_mode: 'HTML' }
			);

			// Lưu đường dẫn để xóa file sau khi hoàn tất
			muxedVideoPath = muxedTranslatedPath;
		}

		// Thông báo đang upload lên Streamtape
		const uploadMsg = await ctx.reply(
			formatMessage(
				EMOJI.UPLOAD,
				'Đang upload video lên Streamtape',
				'Vui lòng đợi trong giây lát...'
			),
			{ parse_mode: 'HTML' }
		);

		try {
			// Upload video lên Streamtape
			const streamtapeUrl = await uploadToStreamtape(muxedVideoPath);

			// Cập nhật thông báo với URL Streamtape
			await ctx.telegram.editMessageText(
				ctx.chat.id,
				uploadMsg.message_id,
				null,
				formatMessage(
					EMOJI.SUCCESS,
					'Đã upload video thành công!',
					`Link video: ${streamtapeUrl}`
				),
				{ parse_mode: 'HTML' }
			);

			// Xóa các file tạm sau khi upload thành công
			if (videoPath && fs.existsSync(videoPath)) await fs.unlink(videoPath);
			if (srtPath && fs.existsSync(srtPath)) await fs.unlink(srtPath);
			if (translatedSrtPath && fs.existsSync(translatedSrtPath))
				await fs.unlink(translatedSrtPath);
			if (muxedVideoPath && fs.existsSync(muxedVideoPath))
				await fs.unlink(muxedVideoPath);
			console.log('Đã xóa các file tạm sau khi upload thành công');
		} catch (error) {
			// Xử lý lỗi upload
			console.error('Error processing subtitle:', error);

			// Cập nhật thông báo với lỗi
			await ctx.telegram.editMessageText(
				ctx.chat.id,
				uploadMsg.message_id,
				null,
				formatMessage(
					EMOJI.ERROR,
					'Không thể upload video lên Streamtape',
					`Lỗi: ${error.message}\n\nVui lòng thử lại với video nhỏ hơn hoặc sử dụng tùy chọn xuất file phụ đề.`
				),
				{ parse_mode: 'HTML' }
			);
		}

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
		console.error('Error processing subtitle:', error);
		await ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'Lỗi khi xử lý phụ đề',
				'Đã xảy ra lỗi khi xử lý phụ đề. Vui lòng thử lại sau.'
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
				if (muxedVideoPath && fs.existsSync(muxedVideoPath))
					await fs.unlink(muxedVideoPath);
				console.log('Đã xóa các file tạm');
			} catch (error) {
				console.error('Error cleaning up temporary files:', error);
			}
		}, 3600000); // Xóa sau 1 giờ để người dùng có thời gian tải file
	}
}

module.exports = {
	processSrtFile,
	processLocalVideo,
	processSubtitle,
	checkWhisperInstallation,
};
