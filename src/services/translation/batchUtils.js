/**
 * Các chức năng xử lý batch và prompt dịch
 */

// Cấu hình
const BATCH_SIZE = 40; // Giảm batch size để đảm bảo không vượt quá giới hạn token

/**
 * Tạo các batch thông minh để duy trì ngữ cảnh giữa các phụ đề
 * @param {Array<{id: string, time: string, text: string}>} subtitles - Tất cả phụ đề
 * @param {number} maxBatchSize - Kích thước tối đa của mỗi batch
 * @returns {Array<Array<{id: string, time: string, text: string}>>} - Các batch đã được tạo
 */
function createSmartBatches(subtitles, maxBatchSize = BATCH_SIZE) {
	const batches = [];
	let currentBatch = [];
	let currentSceneId = null;
	let currentSceneEndTime = null;

	// Hàm kiểm tra một phụ đề có thuộc về cảnh mới không
	function isNewScene(subtitle, prevEndTime) {
		if (!prevEndTime) return false;

		// Phân tích thời gian bắt đầu của phụ đề hiện tại
		const timeMatch = subtitle.time.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> /);
		if (!timeMatch) return false;

		const currentStartTime = timeMatch[1];

		// Chuyển đổi thành số giây để so sánh
		function timeToSeconds(timeStr) {
			const [hours, minutes, secondsAndMs] = timeStr.split(':');
			const [seconds, ms] = secondsAndMs.split(',');
			return (
				parseInt(hours) * 3600 +
				parseInt(minutes) * 60 +
				parseInt(seconds) +
				parseInt(ms) / 1000
			);
		}

		const prevEndSeconds = timeToSeconds(prevEndTime);
		const currentStartSeconds = timeToSeconds(currentStartTime);

		// Xác định cảnh mới nếu khoảng cách > 2 giây
		const TIME_GAP_THRESHOLD = 2.0; // Ngưỡng 2 giây
		return currentStartSeconds - prevEndSeconds > TIME_GAP_THRESHOLD;
	}

	// Hàm lấy thời gian kết thúc từ timestamp
	function getEndTime(timeStr) {
		const match = timeStr.match(/--> (\d{2}:\d{2}:\d{2},\d{3})/);
		return match ? match[1] : null;
	}

	// Tạo các batch thông minh
	for (let i = 0; i < subtitles.length; i++) {
		const subtitle = subtitles[i];
		const endTime = getEndTime(subtitle.time);

		// Kiểm tra xem đây có phải là cảnh mới không
		const isStartOfNewScene = isNewScene(subtitle, currentSceneEndTime);

		// Nếu batch hiện tại đã đầy HOẶC đây là cảnh mới và batch hiện tại không trống
		if (
			currentBatch.length >= maxBatchSize ||
			(isStartOfNewScene && currentBatch.length > 0)
		) {
			batches.push([...currentBatch]);
			currentBatch = [];
			currentSceneId = null;
		}

		// Thêm phụ đề vào batch hiện tại
		currentBatch.push(subtitle);
		currentSceneEndTime = endTime;

		// Nếu đến cuối danh sách, thêm batch cuối cùng
		if (i === subtitles.length - 1 && currentBatch.length > 0) {
			batches.push(currentBatch);
		}
	}

	return batches;
}

/**
 * Trích xuất các thuật ngữ đặc biệt và tên riêng từ batch phụ đề
 * @param {Array<{id: string, time: string, text: string}>} batch - Batch phụ đề
 * @returns {Array<string>} - Danh sách các thuật ngữ đặc biệt
 */
function extractSpecialTerms(batch) {
	// Nối tất cả văn bản phụ đề
	const allText = batch.map((sub) => sub.text).join(' ');

	// Tìm các chuỗi có thể là tên riêng (bắt đầu bằng chữ hoa)
	const potentialNames = allText.match(/\b[A-Z][a-z]{2,}\b/g) || [];

	// Tìm các chuỗi có thể là thuật ngữ đặc biệt (trong dấu ngoặc, viết hoa, v.v.)
	const specialTerms = [
		...(allText.match(/\([^)]+\)/g) || []), // Chuỗi trong ngoặc đơn
		...(allText.match(/\[[^\]]+\]/g) || []), // Chuỗi trong ngoặc vuông
		...(allText.match(/\b[A-Z]{2,}\b/g) || []), // Từ viết hoa
		...(allText.match(/"[^"]{3,}"/g) || []), // Chuỗi trong dấu ngoặc kép
	];

	// Kết hợp và loại bỏ trùng lặp
	const allTerms = [...new Set([...potentialNames, ...specialTerms])];

	// Lọc bỏ các thuật ngữ phổ biến và quá ngắn
	const commonWords = new Set([
		'The',
		'This',
		'That',
		'There',
		'Their',
		'They',
		'When',
		'What',
		'Where',
		'Who',
		'Why',
		'How',
	]);
	return allTerms
		.filter((term) => !commonWords.has(term) && term.length > 2)
		.slice(0, 20); // Giới hạn số lượng thuật ngữ
}

/**
 * Tạo prompt dịch cho một batch phụ đề
 * @param {Array<{id: string, time: string, text: string}>} batch - Batch phụ đề cần dịch
 * @param {string} customPrompt - Prompt tùy chỉnh từ người dùng
 * @param {Array<{id: string, time: string, text: string}>} [previousBatchEnd] - Cuối batch trước để cung cấp ngữ cảnh
 * @returns {string} - Prompt hoàn chỉnh
 */
function createTranslationPrompt(batch, customPrompt, previousBatchEnd = []) {
	// Thêm một số phụ đề từ batch trước để cung cấp ngữ cảnh (nếu có)
	const contextSubtitles = previousBatchEnd.slice(-3); // Lấy 3 phụ đề cuối cùng từ batch trước

	// Tạo phần ngữ cảnh (nếu có)
	let contextPrompt = '';
	if (contextSubtitles.length > 0) {
		const contextTexts = contextSubtitles
			.map((sub, index) => `[Context ${index + 1}] ${sub.text}`)
			.join('\n\n');
		contextPrompt = `Phụ đề ngữ cảnh trước đó (chỉ để tham khảo, KHÔNG dịch lại):\n\n${contextTexts}\n\n`;
	}

	// Tạo phần phụ đề cần dịch
	const textsToTranslate = batch
		.map((sub, index) => `[${index + 1}] ${sub.text}`)
		.join('\n\n');

	// Tạo danh sách tên riêng và thuật ngữ đặc biệt từ batch
	const specialTerms = extractSpecialTerms(batch);
	let termsPrompt = '';

	if (specialTerms.length > 0) {
		// Kiểm tra xem có term nào dài hơn 3 từ hay không để tổ chức định dạng khác
		const complexTerms = specialTerms.filter(
			(term) => term.split(/\s+/).length > 3
		);
		const simpleTerms = specialTerms.filter(
			(term) => term.split(/\s+/).length <= 3
		);

		termsPrompt =
			'\n\nCác tên riêng và thuật ngữ đặc biệt cần giữ nguyên hoặc dịch nhất quán:';

		// Các term đơn giản thì gộp thành một dòng
		if (simpleTerms.length > 0) {
			termsPrompt += ` ${simpleTerms.join(', ')}`;
		}

		// Các term phức tạp thì liệt kê từng dòng
		if (complexTerms.length > 0) {
			termsPrompt += '\nCác thuật ngữ phức tạp:';
			complexTerms.forEach((term) => {
				termsPrompt += `\n- "${term}"`;
			});
		}
	}

	return `${customPrompt || 'Dịch chính xác, tự nhiên và dễ hiểu'}\n\n${contextPrompt}Dịch những phụ đề sau sang tiếng Việt, giữ nguyên định dạng và số lượng dòng. Mỗi phụ đề được đánh số trong ngoặc vuông. QUAN TRỌNG: Giữ nguyên thẻ định dạng như <i>, <b> nếu có.${termsPrompt}\n\n${textsToTranslate}`;
}

module.exports = {
	createSmartBatches,
	createTranslationPrompt,
	extractSpecialTerms,
	BATCH_SIZE,
};
