/**
 * Các chức năng xử lý API và retry logic
 */

// Cấu hình
const MAX_RETRIES = 3; // Số lần thử lại tối đa cho API calls
const RETRY_DELAY = 2000; // Delay giữa các lần retry (ms)

/**
 * Thực hiện API call với cơ chế retry
 * @param {Function} apiCallFn - Hàm thực hiện API call
 * @param {number} maxRetries - Số lần thử lại tối đa
 * @param {number} delay - Thời gian chờ giữa các lần thử lại (ms)
 * @returns {Promise<any>} - Kết quả từ API
 */
async function withRetry(
	apiCallFn,
	maxRetries = MAX_RETRIES,
	delay = RETRY_DELAY
) {
	let lastError;

	for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
		try {
			return await apiCallFn();
		} catch (error) {
			lastError = error;

			// Nếu đã hết số lần thử, ném lỗi
			if (attempt > maxRetries) {
				throw error;
			}

			// Log thông tin retry
			console.warn(
				`Lần thử ${attempt}/${maxRetries + 1} thất bại. Đang thử lại sau ${delay}ms...`,
				error.message
			);

			// Chờ trước khi thử lại
			await new Promise((resolve) => setTimeout(resolve, delay));

			// Tăng delay cho lần thử tiếp theo (exponential backoff)
			delay = Math.min(delay * 2, 30000); // Tối đa 30 giây
		}
	}

	throw lastError;
}

/**
 * Phân tích kết quả dịch từ OpenAI API cải tiến
 * @param {string} translatedText - Văn bản đã dịch từ API
 * @param {Array<{id: string, time: string, text: string}>} batch - Batch phụ đề gốc
 * @returns {Array<{id: string, time: string, text: string}>} - Mảng phụ đề đã dịch
 */
function parseTranslatedResponse(translatedText, batch) {
	// Sử dụng regex tốt hơn để phân tích kết quả
	const translatedParts = translatedText.split(/\[\d+\]\s*/);
	translatedParts.shift(); // Bỏ phần tử đầu tiên (thường là rỗng)

	// Đảm bảo số lượng phần dịch khớp với số lượng phụ đề
	if (translatedParts.length !== batch.length) {
		console.warn(
			`Số lượng phụ đề dịch (${translatedParts.length}) không khớp với số lượng phụ đề gốc (${batch.length})`
		);
	}

	return batch.map((sub, index) => {
		let translatedText;

		if (index < translatedParts.length) {
			translatedText = translatedParts[index].trim();
		} else {
			console.warn(`Thiếu phụ đề dịch cho index ${index}, giữ nguyên text gốc`);
			translatedText = sub.text;
		}

		return {
			...sub,
			text: translatedText,
		};
	});
}

module.exports = {
	withRetry,
	parseTranslatedResponse,
	MAX_RETRIES,
	RETRY_DELAY,
};
