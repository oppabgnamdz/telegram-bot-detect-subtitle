/**
 * Tiện ích định dạng tin nhắn cho bot
 */

// Định nghĩa emoji và màu sắc cho tin nhắn
const EMOJI = {
	SUCCESS: '✅',
	ERROR: '❌',
	LOADING: '⏳',
	DOWNLOAD: '📥',
	VIDEO: '🎬',
	SUBTITLE: '🗒️',
	TRANSLATE: '🔄',
	SETTINGS: '⚙️',
	START: '🚀',
	FILE: '📁',
	OPTIONS: '🔢',
	INFO: 'ℹ️',
	UPLOAD: '🔄',
};

// Định nghĩa các tùy chọn xuất kết quả
const OPTIONS = {
	DEFAULT: 1, // Trả về 2 file gốc và dịch
	MUXED_ORIGINAL: 2, // Ghép subtitle gốc vào video
	MUXED_TRANSLATED: 3, // Ghép subtitle đã dịch vào video
};

/**
 * Định dạng tin nhắn với emoji và HTML
 * @param {string} emoji - Emoji hiển thị trước tiêu đề
 * @param {string} title - Tiêu đề tin nhắn (sẽ được in đậm)
 * @param {string} content - Nội dung tin nhắn
 * @returns {string} - Tin nhắn đã định dạng HTML
 */
function formatMessage(emoji, title, content) {
	return `<b>${emoji} ${title}</b>\n\n${content}`;
}

module.exports = {
	formatMessage,
	EMOJI,
	OPTIONS,
};
