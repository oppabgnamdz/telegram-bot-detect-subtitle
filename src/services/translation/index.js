/**
 * Module dịch phụ đề
 */

const srtUtils = require('./srtUtils');
const apiUtils = require('./apiUtils');
const batchUtils = require('./batchUtils');
const translationService = require('./translationService');

module.exports = {
	// Export công khai API chính
	translateSubtitles: translationService.translateSubtitles,

	// Export các tiện ích cho SRT
	parseSRT: srtUtils.parseSRT,
	formatSRT: srtUtils.formatSRT,
	isVietnamese: srtUtils.isVietnamese,

	// Export các tiện ích cho batch
	createSmartBatches: batchUtils.createSmartBatches,

	// Constants
	BATCH_SIZE: batchUtils.BATCH_SIZE,
};
