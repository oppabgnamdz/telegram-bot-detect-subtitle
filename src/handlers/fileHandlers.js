/**
 * Xử lý tải lên file
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { formatMessage, EMOJI } = require('../utils/messageFormatter');
const { getUserState, updateUserState } = require('../utils/userState');
const { Markup } = require('telegraf');

/**
 * Xử lý tải lên file (document hoặc video)
 * @param {object} ctx - Context Telegraf
 */
async function handleFileUpload(ctx) {
	const userId = ctx.from.id;

	// Lấy trạng thái người dùng
	const userState = getUserState(userId);

	// Chỉ xử lý file khi đang chờ URL/file hoặc người dùng đang ở trạng thái mặc định
	if (
		userState.state !== 'waiting_for_url_or_file' &&
		userState.state !== 'idle'
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
				updateUserState(userId, 'waiting_for_prompt', { srtPath: filePath });

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
				updateUserState(userId, 'waiting_for_prompt', { videoPath: filePath });

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
		updateUserState(userId, 'idle');
	}
}

module.exports = {
	handleFileUpload,
};
