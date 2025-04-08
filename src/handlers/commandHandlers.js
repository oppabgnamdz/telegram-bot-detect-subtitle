/**
 * Xử lý các lệnh cơ bản của bot
 */

const { Markup } = require('telegraf');
const { formatMessage, EMOJI } = require('../utils/messageFormatter');

/**
 * Xử lý lệnh /start
 * @param {object} ctx - Context Telegraf
 */
async function handleStartCommand(ctx) {
	await ctx.reply(
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
}

/**
 * Xử lý lệnh /help
 * @param {object} ctx - Context Telegraf
 */
async function handleHelpCommand(ctx) {
	await ctx.reply(
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
}

/**
 * Xử lý nút "Quay lại menu chính"
 * @param {object} ctx - Context Telegraf
 */
async function handleStartAction(ctx) {
	await ctx.answerCbQuery();
	await ctx.reply(
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
}

/**
 * Xử lý nút "Hướng dẫn sử dụng"
 * @param {object} ctx - Context Telegraf
 */
async function handleHelpAction(ctx) {
	await ctx.answerCbQuery();
	await ctx.reply(
		formatMessage(
			'📚',
			'Hướng dẫn sử dụng Bot Phụ Đề Tự Động',
			`Các bước để tạo phụ đề tự động:\n
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
4. Đợi bot xử lý và tải về phụ đề`
		),
		{
			parse_mode: 'HTML',
			...Markup.inlineKeyboard([
				[Markup.button.callback('Quay lại menu chính', 'start')],
			]),
		}
	);
}

module.exports = {
	handleStartCommand,
	handleHelpCommand,
	handleStartAction,
	handleHelpAction,
};
