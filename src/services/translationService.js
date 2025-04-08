/**
 * Dịch vụ dịch phụ đề - Module mới được tái cấu trúc
 * Module này chỉ là công cụ chuyển đổi để duy trì tương thích với code cũ
 */

// Import module dịch đã được cải tiến
const translationModule = require('./translation');

// Export lại các chức năng để duy trì tương thích với code cũ
module.exports = {
	translateSubtitles: translationModule.translateSubtitles,
	parseSRT: translationModule.parseSRT,
	isVietnamese: translationModule.isVietnamese,
	formatSRT: translationModule.formatSRT,
};
