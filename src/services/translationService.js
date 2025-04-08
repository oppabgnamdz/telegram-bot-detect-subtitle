const fs = require('fs-extra');
const path = require('path');
const { OpenAI } = require('openai');
const config = require('../config');
const pTimeout = require('p-timeout');
const { v4: uuidv4 } = require('uuid'); // Thêm uuid để tạo ID duy nhất cho sessions

// Cấu hình
const TRANSLATION_TIMEOUT = 600000; // 10 phút (600,000 ms)
const MAX_RETRIES = 3; // Số lần thử lại tối đa cho API calls
const RETRY_DELAY = 2000; // Delay giữa các lần retry (ms)
const BATCH_SIZE = 40; // Giảm batch size để đảm bảo không vượt quá giới hạn token
const SAMPLE_SIZE = 10; // Số lượng phụ đề để kiểm tra ngôn ngữ

// Khởi tạo OpenAI client
const openai = new OpenAI({
	apiKey: config.openaiApiKey,
});

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
 * Tạo prompt dịch cho một batch phụ đề
 * @param {Array<{id: string, time: string, text: string}>} batch - Batch phụ đề cần dịch
 * @param {string} customPrompt - Prompt tùy chỉnh từ người dùng
 * @returns {string} - Prompt hoàn chỉnh
 */
/**
 * Tạo các batch thông minh để duy trì ngữ cảnh giữa các phụ đề
 * @param {Array<{id: string, time: string, text: string}>} subtitles - Tất cả phụ đề
 * @param {number} maxBatchSize - Kích thước tối đa của mỗi batch
 * @returns {Array<Array<{id: string, time: string, text: string}>>} - Các batch đã được tạo
 */
function createSmartBatches(subtitles, maxBatchSize) {
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

/**
 * Dịch phụ đề sang tiếng Việt sử dụng OpenAI API - phiên bản cải tiến
 * @param {string} srtPath - Đường dẫn đến file SRT gốc
 * @param {string} prompt - Câu lệnh prompt để dịch
 * @returns {Promise<string>} - Đường dẫn đến file SRT đã dịch
 */
async function translateSubtitles(srtPath, prompt) {
	const sessionId = uuidv4().slice(0, 8); // Tạo ID session để theo dõi
	console.log(`[${sessionId}] Bắt đầu xử lý file: ${srtPath}`);

	try {
		console.time(`[${sessionId}] Thời gian tổng cộng`);

		// Đọc và phân tích file SRT
		console.time(`[${sessionId}] Đọc file`);
		const srtContent = await fs.readFile(srtPath, 'utf-8');
		console.timeEnd(`[${sessionId}] Đọc file`);

		console.time(`[${sessionId}] Phân tích SRT`);
		const subtitles = parseSRT(srtContent);
		console.timeEnd(`[${sessionId}] Phân tích SRT`);

		console.log(`[${sessionId}] Tổng số phụ đề: ${subtitles.length}`);

		// Kiểm tra xem file đã là tiếng Việt chưa
		console.time(`[${sessionId}] Kiểm tra ngôn ngữ`);
		const alreadyVietnamese = isVietnamese(subtitles);
		console.timeEnd(`[${sessionId}] Kiểm tra ngôn ngữ`);

		if (alreadyVietnamese) {
			console.log(`[${sessionId}] File đã là tiếng Việt, không cần dịch lại`);

			// Vẫn lưu file với đuôi .vi.srt để đảm bảo tính nhất quán
			const fileName = path.basename(srtPath, '.srt');
			const translatedPath = path.join(config.uploadPath, `${fileName}.vi.srt`);
			await fs.writeFile(translatedPath, srtContent, 'utf-8');

			console.timeEnd(`[${sessionId}] Thời gian tổng cộng`);
			return translatedPath;
		}

		// Chia thành các batch để dịch với chiến lược thông minh
		console.time(`[${sessionId}] Dịch phụ đề`);
		const batches = createSmartBatches(subtitles, BATCH_SIZE);

		console.log(
			`[${sessionId}] Chia thành ${batches.length} batch(es) để dịch với chiến lược bảo toàn ngữ cảnh`
		);

		const translatedBatches = [];

		// Dịch từng batch
		for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
			const batch = batches[batchIndex];
			console.log(
				`[${sessionId}] Đang dịch batch ${batchIndex + 1}/${batches.length} (${batch.length} phụ đề)`
			);

			// Lấy ngữ cảnh từ batch trước đó (nếu có)
			const previousBatch = batchIndex > 0 ? batches[batchIndex - 1] : [];
			const previousBatchEnd = previousBatch.slice(-3); // Lấy 3 phụ đề cuối cùng từ batch trước

			const translationPrompt = createTranslationPrompt(
				batch,
				prompt,
				previousBatchEnd
			);

			// Thực hiện API call với cơ chế retry
			const apiCallFn = async () => {
				// Bọc lời gọi API OpenAI bằng p-timeout
				return pTimeout(
					openai.chat.completions.create({
						model: 'gpt-3.5-turbo',
						messages: [
							{
								role: 'system',
								content:
									'Bạn là một trợ lý AI chuyên dịch phụ đề sang tiếng Việt chuẩn, tự nhiên và dễ hiểu. Tuân thủ các nguyên tắc sau:\n\n1. Giữ nguyên định dạng của phụ đề gốc và các thẻ HTML nếu có\n2. Duy trì phong cách, ngữ điệu nhất quán trong toàn bộ bản dịch\n3. Dịch nhất quán các tên riêng, thuật ngữ chuyên môn\n4. Bảo tồn ngữ cảnh của các đoạn đối thoại\n5. Không thêm ghi chú hoặc chú thích vào bản dịch\n6. Chỉ dịch nội dung được đánh số trong [số], bỏ qua phần Context\n7. Đảm bảo dịch các thuật ngữ đặc biệt nhất quán với ngữ cảnh',
							},
							{ role: 'user', content: translationPrompt },
						],
						temperature: 0.3,
						max_tokens: 4000,
					}),
					TRANSLATION_TIMEOUT,
					`Quá thời gian (${TRANSLATION_TIMEOUT / 1000 / 60} phút) khi gọi API dịch thuật batch ${batchIndex + 1}/${batches.length}`
				);
			};

			try {
				const response = await withRetry(apiCallFn);
				const translatedText = response.choices[0].message.content.trim();

				// Phân tích kết quả dịch
				const translatedSubtitles = parseTranslatedResponse(
					translatedText,
					batch
				);
				translatedBatches.push(translatedSubtitles);

				// Log tiến độ
				console.log(
					`[${sessionId}] Đã dịch xong batch ${batchIndex + 1}/${batches.length}`
				);
			} catch (error) {
				console.error(
					`[${sessionId}] Lỗi không thể khắc phục khi dịch batch ${batchIndex + 1}/${batches.length}:`,
					error
				);

				// Trong trường hợp lỗi, giữ nguyên phụ đề gốc cho batch này
				console.log(
					`[${sessionId}] Giữ nguyên phụ đề gốc cho batch ${batchIndex + 1}`
				);
				translatedBatches.push(batch);
			}

			// Thêm delay để tránh rate limit
			if (batchIndex < batches.length - 1) {
				const delay = 1000 + Math.random() * 500; // Thêm jitter để tránh đồng bộ hóa
				console.log(
					`[${sessionId}] Chờ ${delay}ms trước khi dịch batch tiếp theo...`
				);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		console.timeEnd(`[${sessionId}] Dịch phụ đề`);

		// Kết hợp tất cả các batch đã dịch
		const translatedSubtitles = translatedBatches.flat();

		// Kiểm tra kết quả dịch có khớp số lượng với subtitles gốc không
		if (translatedSubtitles.length !== subtitles.length) {
			console.warn(
				`[${sessionId}] Cảnh báo: Số lượng phụ đề sau khi dịch (${translatedSubtitles.length}) khác với số lượng gốc (${subtitles.length})`
			);
		}

		// Format và lưu kết quả
		console.time(`[${sessionId}] Lưu file kết quả`);
		const translatedContent = formatSRT(translatedSubtitles);

		const fileName = path.basename(srtPath, '.srt');
		const translatedPath = path.join(config.uploadPath, `${fileName}.vi.srt`);
		await fs.writeFile(translatedPath, translatedContent, 'utf-8');
		console.timeEnd(`[${sessionId}] Lưu file kết quả`);

		console.log(
			`[${sessionId}] Đã dịch thành công và lưu vào: ${translatedPath}`
		);
		console.timeEnd(`[${sessionId}] Thời gian tổng cộng`);

		return translatedPath;
	} catch (error) {
		console.error(`[${sessionId}] Lỗi nghiêm trọng khi dịch phụ đề:`, error);
		console.timeEnd(`[${sessionId}] Thời gian tổng cộng`);
		throw error;
	}
}

module.exports = {
	translateSubtitles,
	parseSRT, // Export thêm các hàm để dễ test
	isVietnamese,
	formatSRT,
};
