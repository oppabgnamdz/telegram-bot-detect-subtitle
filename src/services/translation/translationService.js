/**
 * Dịch vụ dịch phụ đề
 */
const fs = require('fs-extra');
const path = require('path');
const { OpenAI } = require('openai');
const pTimeout = require('p-timeout');
const { v4: uuidv4 } = require('uuid'); // Thêm uuid để tạo ID duy nhất cho sessions
const config = require('../../config');

// Import các modules đã tách
const { parseSRT, formatSRT, isVietnamese } = require('./srtUtils');
const { withRetry, parseTranslatedResponse } = require('./apiUtils');
const {
	createSmartBatches,
	createTranslationPrompt,
	BATCH_SIZE,
} = require('./batchUtils');

// Cấu hình
const TRANSLATION_TIMEOUT = 600000; // 10 phút (600,000 ms)

// Giá tiền cho model GPT-3.5-turbo (USD/1000 token)
const GPT35_PRICING = {
	input: 0.0015, // $0.0015 / 1000 token đầu vào
	output: 0.002, // $0.002 / 1000 token đầu ra
};

// Khởi tạo OpenAI client
const openai = new OpenAI({
	apiKey: config.openaiApiKey,
});

/**
 * Dịch phụ đề sang tiếng Việt sử dụng OpenAI API - phiên bản cải tiến
 * @param {string} srtPath - Đường dẫn đến file SRT gốc
 * @param {string} prompt - Câu lệnh prompt để dịch
 * @param {number|string} chatId - ID chat Telegram để gửi thông báo
 * @param {object} bot - Instance của Telegram bot
 * @returns {Promise<string>} - Đường dẫn đến file SRT đã dịch
 */
async function translateSubtitles(srtPath, prompt, chatId, bot) {
	const sessionId = uuidv4().slice(0, 8); // Tạo ID session để theo dõi
	console.log(`[${sessionId}] Bắt đầu xử lý file: ${srtPath}`);

	// Biến theo dõi chi phí
	let totalTokens = {
		input: 0,
		output: 0,
	};

	// Gửi thông báo bắt đầu cho người dùng
	if (chatId && bot) {
		await bot.telegram.sendMessage(chatId, `🔄 Bắt đầu xử lý file phụ đề...`);
	}

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

		// Gửi thông báo đã đọc file
		if (chatId && bot) {
			await bot.telegram.sendMessage(
				chatId,
				`📑 Đã đọc file phụ đề với ${subtitles.length} dòng phụ đề`
			);
		}

		// Kiểm tra xem file đã là tiếng Việt chưa
		console.time(`[${sessionId}] Kiểm tra ngôn ngữ`);
		const alreadyVietnamese = isVietnamese(subtitles);
		console.timeEnd(`[${sessionId}] Kiểm tra ngôn ngữ`);

		if (alreadyVietnamese) {
			console.log(`[${sessionId}] File đã là tiếng Việt, không cần dịch lại`);

			// Thông báo về việc file đã là tiếng Việt
			if (chatId && bot) {
				await bot.telegram.sendMessage(
					chatId,
					`🇻🇳 File phụ đề đã là tiếng Việt, không cần dịch lại`
				);
			}

			// Vẫn lưu file với đuôi .vi.srt để đảm bảo tính nhất quán
			const fileName = path.basename(srtPath, '.srt');
			const translatedPath = path.join(config.uploadPath, `${fileName}.vi.srt`);
			await fs.writeFile(translatedPath, srtContent, 'utf-8');

			console.timeEnd(`[${sessionId}] Thời gian tổng cộng`);

			// Thông báo hoàn thành
			if (chatId && bot) {
				await bot.telegram.sendMessage(
					chatId,
					`✅ Đã hoàn thành và lưu file: ${fileName}.vi.srt`
				);
			}

			return translatedPath;
		}

		// Thông báo bắt đầu quá trình dịch
		if (chatId && bot) {
			await bot.telegram.sendMessage(
				chatId,
				`🔍 Đã phát hiện file phụ đề không phải tiếng Việt, bắt đầu dịch...`
			);
		}

		// Chia thành các batch để dịch với chiến lược thông minh
		console.time(`[${sessionId}] Dịch phụ đề`);
		const batches = createSmartBatches(subtitles, BATCH_SIZE);

		console.log(
			`[${sessionId}] Chia thành ${batches.length} batch(es) để dịch với chiến lược bảo toàn ngữ cảnh`
		);

		// Thông báo về số batch
		if (chatId && bot) {
			await bot.telegram.sendMessage(
				chatId,
				`📊 Chia thành ${batches.length} phần để dịch, mỗi phần có khoảng ${BATCH_SIZE} phụ đề`
			);
		}

		const translatedBatches = [];

		// Dịch từng batch
		for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
			const batch = batches[batchIndex];
			console.log(
				`[${sessionId}] Đang dịch batch ${batchIndex + 1}/${batches.length} (${batch.length} phụ đề)`
			);

			// Gửi thông báo tiến độ dịch
			if (chatId && bot && batches.length > 1) {
				// Chỉ gửi thông báo tiến độ nếu có nhiều batch
				const progressPercent = Math.round(
					((batchIndex + 1) / batches.length) * 100
				);
				await bot.telegram.sendMessage(
					chatId,
					`🔄 Đang dịch phần ${batchIndex + 1}/${batches.length} (${progressPercent}%)`
				);
			}

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

				// Cập nhật số token sử dụng
				if (response.usage) {
					totalTokens.input += response.usage.prompt_tokens;
					totalTokens.output += response.usage.completion_tokens;
					console.log(
						`[${sessionId}] Batch ${batchIndex + 1} sử dụng: ${response.usage.prompt_tokens} input tokens, ${response.usage.completion_tokens} output tokens`
					);
				}

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

				// Thông báo lỗi cho người dùng
				if (chatId && bot) {
					await bot.telegram.sendMessage(
						chatId,
						`⚠️ Gặp lỗi khi dịch phần ${batchIndex + 1}/${batches.length}. Giữ nguyên phụ đề gốc cho phần này.`
					);
				}

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

		// Tính chi phí dịch thuật
		const costInUSD = calculateCost(totalTokens);
		console.log(
			`[${sessionId}] Chi phí dịch thuật: $${costInUSD.toFixed(4)} (${totalTokens.input} input tokens, ${totalTokens.output} output tokens)`
		);

		// Thông báo đã dịch xong
		if (chatId && bot) {
			await bot.telegram.sendMessage(
				chatId,
				`📝 Đã dịch xong toàn bộ phụ đề, đang lưu kết quả...`
			);
		}

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

		// Thông báo hoàn thành và chi phí cho người dùng
		if (chatId && bot) {
			await bot.telegram.sendMessage(
				chatId,
				`✅ Đã dịch xong và lưu file: ${fileName}.vi.srt
Tổng số phụ đề: ${translatedSubtitles.length}
📊 Thống kê chi phí:
• Tokens đầu vào: ${totalTokens.input.toLocaleString()}
• Tokens đầu ra: ${totalTokens.output.toLocaleString()}
• Chi phí: $${costInUSD.toFixed(4)} USD`
			);
		}

		return translatedPath;
	} catch (error) {
		console.error(`[${sessionId}] Lỗi nghiêm trọng khi dịch phụ đề:`, error);
		console.timeEnd(`[${sessionId}] Thời gian tổng cộng`);

		// Gửi thông báo lỗi
		if (chatId && bot) {
			await bot.telegram.sendMessage(
				chatId,
				`❌ Gặp lỗi nghiêm trọng khi xử lý file phụ đề: ${error.message || 'Lỗi không xác định'}`
			);
		}

		throw error;
	}
}

/**
 * Tính chi phí dịch dựa trên lượng token sử dụng
 * @param {Object} tokens - Object chứa số lượng token đầu vào và đầu ra
 * @returns {number} - Chi phí tính bằng USD
 */
function calculateCost(tokens) {
	const inputCost = (tokens.input / 1000) * GPT35_PRICING.input;
	const outputCost = (tokens.output / 1000) * GPT35_PRICING.output;
	return inputCost + outputCost;
}

module.exports = {
	translateSubtitles,
};
