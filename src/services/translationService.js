const fs = require('fs-extra');
const path = require('path');
const { OpenAI } = require('openai');
const config = require('../config');
const pTimeout = require('p-timeout');

// Cấu hình thời gian chờ cho quá trình dịch
const TRANSLATION_TIMEOUT = 600000; // 10 phút (600,000 ms)

// Khởi tạo OpenAI client
const openai = new OpenAI({
	apiKey: config.openaiApiKey,
});

/**
 * Parse SRT file content
 * @param {string} srtContent - Nội dung file SRT
 * @returns {Array<{id: string, time: string, text: string}>} - Mảng các đối tượng phụ đề
 */
function parseSRT(srtContent) {
	const blocks = srtContent.trim().split(/\r?\n\r?\n/);

	return blocks.map((block) => {
		const lines = block.split(/\r?\n/);
		const id = lines[0];
		const time = lines[1];
		const textLines = lines.slice(2);
		// Sửa lỗi: Giữ nguyên định dạng văn bản thay vì nối thành một dòng
		const text = textLines.join('\n');

		return { id, time, text };
	});
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
 * Kiểm tra ngôn ngữ của file phụ đề
 * @param {string} text - Văn bản cần kiểm tra
 * @returns {boolean} - True nếu đã là tiếng Việt, false nếu không phải
 */
function isVietnamese(text) {
	// Kiểm tra các ký tự đặc trưng của tiếng Việt
	const vietnameseChars =
		/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
	return vietnameseChars.test(text);
}

/**
 * Dịch phụ đề sang tiếng Việt sử dụng OpenAI API
 * @param {string} srtPath - Đường dẫn đến file SRT gốc
 * @param {string} prompt - Câu lệnh prompt để dịch
 * @returns {Promise<string>} - Đường dẫn đến file SRT đã dịch
 */
async function translateSubtitles(srtPath, prompt) {
	try {
		const srtContent = await fs.readFile(srtPath, 'utf-8');
		const subtitles = parseSRT(srtContent);

		// Kiểm tra xem file đã là tiếng Việt chưa
		const sampleText = subtitles
			.slice(0, 5)
			.map((sub) => sub.text)
			.join(' ');
		if (isVietnamese(sampleText)) {
			console.log('File đã là tiếng Việt, không cần dịch lại');
			// Vẫn lưu file với đuôi .vi.srt để đảm bảo tính nhất quán
			const fileName = path.basename(srtPath, '.srt');
			const translatedPath = path.join(config.uploadPath, `${fileName}.vi.srt`);
			await fs.writeFile(translatedPath, srtContent, 'utf-8');
			return translatedPath;
		}

		// Tăng kích thước batch để giảm số lượng API calls
		const batchSize = 50; // Giảm xuống 50 để tránh vượt quá giới hạn token
		const batches = [];

		for (let i = 0; i < subtitles.length; i += batchSize) {
			batches.push(subtitles.slice(i, i + batchSize));
		}

		const translatedBatches = [];

		for (const batch of batches) {
			const textsToTranslate = batch
				.map((sub, index) => `[${index + 1}] ${sub.text}`)
				.join('\n\n');

			const translationPrompt = `${prompt}\n\nDịch những phụ đề sau sang tiếng Việt, giữ nguyên định dạng và số lượng dòng. Mỗi phụ đề được đánh số trong ngoặc vuông:\n\n${textsToTranslate}`;

			// Bọc lời gọi API OpenAI bằng p-timeout
			const translationPromise = openai.chat.completions.create({
				model: 'gpt-3.5-turbo',
				messages: [
					{
						role: 'system',
						content:
							'Bạn là một trợ lý AI chuyên dịch phụ đề sang tiếng Việt chuẩn, tự nhiên và dễ hiểu. Giữ nguyên định dạng của phụ đề gốc.',
					},
					{ role: 'user', content: translationPrompt },
				],
				temperature: 0.3, // Giảm temperature để có kết quả ổn định hơn
				max_tokens: 4000, // Tăng số token để đảm bảo dịch đủ nội dung
			});

			// Áp dụng timeout cho lời gọi API
			const response = await pTimeout(
				translationPromise,
				TRANSLATION_TIMEOUT,
				`Quá thời gian (${TRANSLATION_TIMEOUT / 1000 / 60} phút) khi gọi API dịch thuật OpenAI`
			);

			const translatedText = response.choices[0].message.content.trim();

			// Xử lý kết quả dịch bằng cách tách theo số thứ tự
			const translatedParts = translatedText.split(/\[\d+\]/);
			translatedParts.shift(); // Bỏ phần tử đầu tiên (thường là rỗng)

			// Map translated texts back to subtitles
			const translatedSubtitles = batch.map((sub, index) => ({
				...sub,
				text: translatedParts[index] ? translatedParts[index].trim() : sub.text,
			}));

			translatedBatches.push(translatedSubtitles);

			// Thêm delay để tránh rate limit
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		// Combine all translated batches
		const translatedSubtitles = translatedBatches.flat();
		const translatedContent = formatSRT(translatedSubtitles);

		// Save translated SRT
		const fileName = path.basename(srtPath, '.srt');
		const translatedPath = path.join(config.uploadPath, `${fileName}.vi.srt`);
		await fs.writeFile(translatedPath, translatedContent, 'utf-8');

		console.log(`Đã dịch thành công và lưu vào: ${translatedPath}`);
		return translatedPath;
	} catch (error) {
		console.error('Lỗi khi dịch phụ đề:', error);
		throw error;
	}
}

module.exports = {
	translateSubtitles,
};
