/**
 * Các chức năng xử lý file SRT
 */
const SAMPLE_SIZE = 10; // Số lượng phụ đề để kiểm tra ngôn ngữ

/**
 * Parse SRT file content với xử lý lỗi tốt hơn
 * @param {string} srtContent - Nội dung file SRT
 * @returns {Array<{id: string, time: string, text: string}>} - Mảng các đối tượng phụ đề
 */
function parseSRT(srtContent) {
	try {
		// Chuẩn hóa line breaks
		const normalizedContent = srtContent
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n');
		const blocks = normalizedContent.trim().split(/\n\n+/);

		return blocks
			.map((block, index) => {
				const lines = block.split(/\n/);

				// Kiểm tra định dạng hợp lệ
				if (lines.length < 3) {
					console.warn(
						`Phát hiện block phụ đề không hợp lệ ở vị trí ${index + 1}, sẽ bỏ qua`
					);
					return null;
				}

				// Lấy ID (hoặc tạo ID nếu không hợp lệ)
				let id = lines[0].trim();
				if (!/^\d+$/.test(id)) {
					console.warn(
						`ID phụ đề không hợp lệ ở block ${index + 1}, sẽ tạo ID mới`
					);
					id = String(index + 1);
				}

				// Lấy timestamp
				const time = lines[1].trim();
				if (
					!/^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/.test(time)
				) {
					console.warn(
						`Định dạng thời gian không hợp lệ ở block ${index + 1}: ${time}`
					);
				}

				// Lấy nội dung text
				const textLines = lines.slice(2);
				const text = textLines.join('\n');

				return { id, time, text };
			})
			.filter(Boolean); // Lọc bỏ các phần tử null
	} catch (error) {
		console.error('Lỗi khi phân tích file SRT:', error);
		throw new Error(
			'Không thể phân tích file SRT. Vui lòng kiểm tra định dạng file.'
		);
	}
}

/**
 * Format array of subtitles to SRT format
 * @param {Array<{id: string, time: string, text: string}>} subtitles - Mảng các đối tượng phụ đề
 * @returns {string} - Nội dung file SRT
 */
function formatSRT(subtitles) {
	return subtitles
		.map(({ id, time, text }) => {
			return `${id}\n${time}\n${text}`;
		})
		.join('\n\n');
}

/**
 * Kiểm tra ngôn ngữ của file phụ đề - phương pháp cải tiến
 * @param {Array<{id: string, time: string, text: string}>} subtitles - Mảng các đối tượng phụ đề
 * @returns {boolean} - True nếu đã là tiếng Việt, false nếu không phải
 */
function isVietnamese(subtitles) {
	if (subtitles.length === 0) return false;

	// Lấy mẫu từ nhiều vị trí khác nhau và số lượng mẫu lớn hơn
	const totalSamples = Math.min(SAMPLE_SIZE, subtitles.length);
	const sampleIndices = [];

	// Tạo các vị trí mẫu phân bố đều trong file
	for (let i = 0; i < totalSamples; i++) {
		const idx = Math.floor((i / totalSamples) * subtitles.length);
		sampleIndices.push(idx);
	}

	const uniqueIndices = [...new Set(sampleIndices)];
	const sampleTexts = uniqueIndices.map((idx) => subtitles[idx].text);

	// Kết hợp tất cả văn bản mẫu để phân tích
	const combinedText = sampleTexts.join(' ');

	// Kiểm tra các ký tự đặc trưng của tiếng Việt
	const vietnameseChars =
		/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

	// Kiểm tra cả các từ thông dụng trong tiếng Việt
	const vietnameseWords =
		/\b(của|và|trong|những|các|với|không|là|có|cho|được|này|một|như|đã|về|từ|đến|tôi|chúng|bạn|anh|chị|ông|bà|họ|mình)\b/i;

	// Đếm số lần xuất hiện của từng loại đặc điểm
	const charMatches = (combinedText.match(vietnameseChars) || []).length;
	const wordMatches = (
		combinedText.match(new RegExp(vietnameseWords, 'gi')) || []
	).length;

	// Tính tỷ lệ xuất hiện trên độ dài văn bản
	const textLength = combinedText.length;
	const charDensity = textLength > 0 ? charMatches / textLength : 0;
	const wordDensity =
		textLength > 0 ? wordMatches / combinedText.split(/\s+/).length : 0;

	// Kiểm tra tỷ lệ xuất hiện vượt ngưỡng
	const isCharsVietnamese = charDensity > 0.01; // Hơn 1% ký tự là dấu tiếng Việt
	const isWordsVietnamese = wordDensity > 0.05; // Hơn 5% từ là từ tiếng Việt phổ biến

	// Log để debug
	console.log(
		`Kết quả phát hiện ngôn ngữ: charDensity=${charDensity.toFixed(4)}, wordDensity=${wordDensity.toFixed(4)}`
	);

	// Kết hợp các điều kiện - chỉ cần một trong hai điều kiện đạt ngưỡng cao
	return isCharsVietnamese || isWordsVietnamese;
}

module.exports = {
	parseSRT,
	formatSRT,
	isVietnamese,
};
