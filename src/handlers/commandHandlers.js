/**
 * Xử lý các lệnh cơ bản của bot
 */

const { Markup } = require('telegraf');
const { formatMessage, EMOJI } = require('../utils/messageFormatter');
const { setUserAsAdmin } = require('../utils/userPermission');

const MENU_BUTTONS = [
	[Markup.button.callback('Tạo phụ đề mới', 'create_subtitle')],
	[Markup.button.callback('Hướng dẫn sử dụng', 'help')],
];

const HELP_MESSAGE = `Các bước để tạo phụ đề tự động:\n
1. Nhấn nút <b>Tạo phụ đề mới</b>
2. Nhập URL video. Bot hỗ trợ:
   • URL video trực tiếp (.mp4, .webm, ...)
   • YouTube (youtube.com, youtu.be)
   • Stream HLS (m3u8)
   • Magnet link (magnet:...)
   • Torrent file (.torrent)
   • File video
   • File phụ đề .srt
3. Nhập prompt dịch (mô tả cách bạn muốn dịch phụ đề)
4. Đợi bot xử lý và tải về phụ đề`;

/**
 * Xử lý lệnh /start và nút "Quay lại menu chính"
 * @param {object} ctx - Context Telegraf
 * @param {boolean} isCommand - Xác định xem có phải là lệnh /start không
 */
async function handleStart(ctx, isCommand = false) {
	if (!isCommand) {
		await ctx.answerCbQuery();
	}

	await ctx.reply(
		formatMessage(
			EMOJI.START,
			'Chào mừng đến với Bot Phụ Đề Tự Động!',
			'Hãy chọn một trong các tùy chọn bên dưới để bắt đầu:'
		),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard(MENU_BUTTONS),
		}
	);
}

/**
 * Xử lý lệnh /help và nút "Hướng dẫn sử dụng"
 * @param {object} ctx - Context Telegraf
 * @param {boolean} isCommand - Xác định xem có phải là lệnh /help không
 */
async function handleHelp(ctx, isCommand = false) {
	if (!isCommand) {
		await ctx.answerCbQuery();
	}

	await ctx.reply(
		formatMessage('📚', 'Hướng dẫn sử dụng Bot Phụ Đề Tự Động', HELP_MESSAGE),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('Quay lại menu chính', 'start')],
			]),
		}
	);
}

/**
 * Xử lý khi user gõ lệnh /admin [mật khẩu]
 */
const handleAdminCommand = async (ctx) => {
	try {
		const adminPassword = 'admin123'; // Đặt mật khẩu admin tại đây

		// Lấy tham số từ lệnh /admin
		const params = ctx.message.text.split(' ').slice(1);

		if (params.length === 0) {
			await ctx.reply('❌ Vui lòng nhập mật khẩu admin.');
			return;
		}

		const password = params[0];

		if (password !== adminPassword) {
			await ctx.reply('❌ Mật khẩu không đúng.');
			return;
		}

		const telegramId = ctx.from.id.toString();
		const success = await setUserAsAdmin(telegramId);

		if (success) {
			await ctx.reply('✅ Bạn đã được thiết lập thành admin thành công!');
		} else {
			await ctx.reply('❌ Có lỗi xảy ra khi thiết lập quyền admin.');
		}
	} catch (error) {
		console.error('Lỗi xử lý lệnh admin:', error);
		await ctx.reply('❌ Có lỗi xảy ra khi xử lý lệnh admin.');
	}
};

module.exports = {
	handleStartCommand: (ctx) => handleStart(ctx, true),
	handleHelpCommand: (ctx) => handleHelp(ctx, true),
	handleStartAction: (ctx) => handleStart(ctx, false),
	handleHelpAction: (ctx) => handleHelp(ctx, false),
	handleAdminCommand,
};
