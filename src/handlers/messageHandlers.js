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
 * Xử lý tin nhắn văn bản
 * @param {object} ctx - Context Telegraf
 */
async function handleTextMessage(ctx) {
	// Lấy ID của người dùng
	const userId = ctx.from.id;
	const userState = getUserState(userId);

	// Nếu người dùng đã gửi lệnh /subtitle truyền thống, chuyển hướng sang flow mới
	if (ctx.message.text.startsWith('/subtitle')) {
		const parts = ctx.message.text.split(' ');
		if (parts.length >= 3) {
			updateUserState(userId, 'processing', {
				videoUrl: parts[1],
				prompt: parts.slice(2).join(' '),
				outputOption: OPTIONS.DEFAULT,
			});

			await processSubtitle(
				ctx,
				userState.videoUrl,
				userState.prompt,
				userState.outputOption
			);

			resetUserState(userId);
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
	switch (userState.state) {
		case 'waiting_for_url_or_file':
		case 'waiting_for_url':
			// Người dùng đang nhập URL video
			const videoUrl = ctx.message.text.trim();

			// Kiểm tra các loại URL khác nhau
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

			// Lưu URL và chuyển sang trạng thái chờ nhập prompt
			updateUserState(userId, 'waiting_for_prompt', { videoUrl });

			// Hiển thị thông tin về loại URL đã phát hiện
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

			ctx.reply(
				formatMessage(
					EMOJI.TRANSLATE,
					'Nhập prompt dịch',
					`${urlTypeInfo ? urlTypeInfo + '\n\n' : ''}Vui lòng nhập nội dung hướng dẫn cách dịch phụ đề (ví dụ: "Dịch sang tiếng Việt, giữ nguyên nghĩa gốc").`
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

			// Lưu prompt và hiển thị tùy chọn output
			updateUserState(userId, 'waiting_for_output_option', { prompt });

			// Hiển thị tùy chọn output
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
			break;

		case 'waiting_for_output_option':
			// Người dùng có thể nhập tùy chọn dưới dạng số 1, 2, 3
			const optionText = ctx.message.text.trim();
			let selectedOption = OPTIONS.DEFAULT;

			if (optionText === '1') {
				selectedOption = OPTIONS.DEFAULT;
			} else if (optionText === '2') {
				selectedOption = OPTIONS.MUXED_ORIGINAL;
			} else if (optionText === '3') {
				selectedOption = OPTIONS.MUXED_TRANSLATED;
			} else {
				// Nếu nhập không phải 1, 2, 3 thì dùng mặc định và thông báo
				await ctx.reply(
					formatMessage(
						EMOJI.INFO,
						'Tùy chọn không hợp lệ',
						'Sử dụng tùy chọn mặc định: Xuất file phụ đề'
					),
					{ parse_mode: 'HTML' }
				);
			}

			// Cập nhật trạng thái
			updateUserState(userId, 'processing', { outputOption: selectedOption });

			// Xử lý theo loại file/URL
			if (userState.srtPath) {
				// Nếu là file SRT
				await processSrtFile(
					ctx,
					userState.srtPath,
					userState.prompt,
					selectedOption
				);
			} else if (userState.videoPath) {
				// Nếu là file video đã tải lên
				await processLocalVideo(
					ctx,
					userState.videoPath,
					userState.prompt,
					selectedOption
				);
			} else {
				// Nếu là URL video
				await processSubtitle(
					ctx,
					userState.videoUrl,
					userState.prompt,
					selectedOption
				);
			}

			// Đặt lại trạng thái
			resetUserState(userId);
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
}

module.exports = {
	handleTextMessage,
};
