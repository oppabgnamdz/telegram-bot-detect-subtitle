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
const {
	checkUserPermission,
	incrementUserCommand,
} = require('../utils/userPermission');

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB trong byte

/**
 * Tạo tên file an toàn
 * @param {string} fileName - Tên file gốc
 * @param {boolean} isDocument - Có phải là document không
 * @returns {string} Tên file an toàn
 */
function createSafeFileName(fileName, isDocument) {
	const randomHash = crypto.randomBytes(8).toString('hex');
	const fileExt = path.extname(fileName) || (isDocument ? '.txt' : '.mp4');
	return `file_${randomHash}${fileExt}`;
}

/**
 * Kiểm tra kích thước file
 * @param {number} fileSize - Kích thước file
 * @returns {boolean} File có hợp lệ không
 */
async function validateFileSize(ctx, fileSize) {
	if (fileSize > MAX_FILE_SIZE) {
		await ctx.reply(
			formatMessage(
				EMOJI.ERROR,
				'File quá lớn',
				`Telegram chỉ cho phép bot tải xuống file tối đa 20MB. File của bạn có kích thước ${(fileSize / (1024 * 1024)).toFixed(2)}MB. Vui lòng sử dụng URL trực tiếp đến video hoặc gửi file nhỏ hơn.`
			),
			{ parse_mode: 'HTML' }
		);
		return false;
	}
	return true;
}

/**
 * Tải file từ Telegram
 * @param {object} ctx - Context Telegraf
 * @param {string} fileId - ID của file trên Telegram
 * @param {string} filePath - Đường dẫn lưu file
 * @returns {Promise<boolean>} Kết quả tải file
 */
async function downloadFileFromTelegram(ctx, fileId, filePath) {
	const downloadMsg = await ctx.reply(
		formatMessage(
			EMOJI.DOWNLOAD,
			'Đang tải file',
			'Vui lòng đợi trong giây lát...'
		),
		{ parse_mode: 'HTML' }
	);

	try {
		const fileLink = await ctx.telegram.getFileLink(fileId);
		const response = await fetch(fileLink.href);

		if (!response.ok) {
			throw new Error(`Không thể tải file: ${response.statusText}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
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

		return true;
	} catch (error) {
		console.error('Lỗi tải file từ Telegram:', error);
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
		return false;
	}
}

/**
 * Xử lý sau khi tải file thành công
 * @param {object} ctx - Context Telegraf
 * @param {string} userId - ID của người dùng
 * @param {string} filePath - Đường dẫn file đã tải
 * @param {string} fileExt - Phần mở rộng của file
 */
async function handleSuccessfulUpload(ctx, userId, filePath, fileExt) {
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

		const isSrtFile = fileExt.toLowerCase() === '.srt';
		const stateData = isSrtFile
			? { srtPath: filePath }
			: { videoPath: filePath };

		// Chuyển sang trạng thái chờ chọn kiểu xuất kết quả thay vì chờ prompt
		updateUserState(userId, 'waiting_for_output_option', {
			...stateData,
			prompt: null, // Prompt sẽ được yêu cầu sau nếu cần
		});

		const fileType = isSrtFile ? 'file phụ đề .srt' : 'file video';
		await ctx.reply(
			formatMessage(
				EMOJI.OPTIONS,
				`Đã nhận ${fileType}`,
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

		// Xóa file nếu đã tải về nhưng xử lý thất bại
		if (filePath && fs.existsSync(filePath)) {
			try {
				await fs.unlink(filePath);
				console.log('Đã xóa file upload do lỗi:', filePath);
			} catch (unlinkError) {
				console.error('Lỗi khi xóa file:', unlinkError);
			}
		}
	}
}

/**
 * Xử lý tải lên file (document hoặc video)
 * @param {object} ctx - Context Telegraf
 */
async function handleFileUpload(ctx) {
	try {
		// Kiểm tra quyền người dùng
		const hasPermission = await checkUserPermission(ctx);
		if (!hasPermission) {
			await ctx.reply(
				'🔒 Bạn đã sử dụng hết lượt dùng trong ngày hôm nay. Vui lòng thử lại vào ngày mai hoặc nâng cấp tài khoản.'
			);
			return;
		}

		const userId = ctx.from.id;
		const userState = getUserState(userId);

		if (
			userState.state !== 'waiting_for_url_or_file' &&
			userState.state !== 'idle'
		) {
			return;
		}

		let filePath;
		const isDocument = !!ctx.message.document;
		const fileId = isDocument
			? ctx.message.document.file_id
			: ctx.message.video.file_id;
		const fileName = isDocument
			? ctx.message.document.file_name
			: `video_${Date.now()}.mp4`;
		const fileSize = isDocument
			? ctx.message.document.file_size
			: ctx.message.video.file_size;

		if (!(await validateFileSize(ctx, fileSize))) {
			return;
		}

		const safeFileName = createSafeFileName(fileName, isDocument);
		filePath = path.join(config.uploadPath, safeFileName);

		if (await downloadFileFromTelegram(ctx, fileId, filePath)) {
			await handleSuccessfulUpload(
				ctx,
				userId,
				filePath,
				path.extname(safeFileName)
			);
			await incrementUserCommand(ctx);
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

		// Xóa file nếu đã tải về nhưng xử lý thất bại
		if (filePath && fs.existsSync(filePath)) {
			try {
				await fs.unlink(filePath);
				console.log('Đã xóa file upload do lỗi:', filePath);
			} catch (unlinkError) {
				console.error('Lỗi khi xóa file:', unlinkError);
			}
		}
	}
}

module.exports = {
	handleFileUpload,
};
