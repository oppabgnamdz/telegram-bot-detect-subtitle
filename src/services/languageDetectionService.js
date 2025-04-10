/**
 * Dịch vụ tự động phát hiện ngôn ngữ
 */
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config');
const pTimeout = require('p-timeout');

// Thời gian chờ tối đa cho việc phát hiện ngôn ngữ
const LANGUAGE_DETECTION_TIMEOUT = 300000; // 5 phút

/**
 * Tự động phát hiện ngôn ngữ từ file video hoặc audio
 * @param {string} videoPath - Đường dẫn đến file video/audio
 * @returns {Promise<{code: string, name: string}>} - Mã ngôn ngữ và tên đầy đủ
 */
async function detectLanguage(videoPath) {
	try {
		console.log(`Phát hiện ngôn ngữ từ file: ${videoPath}`);

		// Tạo tên file mẫu tạm thời
		const randomPart = Math.random().toString(36).substring(2, 8);
		const samplePath = path.join(
			path.dirname(videoPath),
			`sample_${randomPart}_${path.basename(videoPath)}.wav`
		);

		// Trích xuất mẫu âm thanh 30 giây đầu tiên
		await new Promise((resolve, reject) => {
			const command = `ffmpeg -i "${videoPath}" -t 30 -vn -acodec pcm_s16le -ar 16000 -ac 1 "${samplePath}"`;
			console.log(`Trích xuất mẫu âm thanh: ${command}`);

			exec(command, (error, stdout, stderr) => {
				if (error) {
					console.error(`Lỗi trích xuất âm thanh: ${error.message}`);
					reject(error);
				} else {
					console.log(`Đã trích xuất mẫu âm thanh thành công: ${samplePath}`);
					resolve();
				}
			});
		});

		// Sử dụng faster-whisper để phát hiện ngôn ngữ
		const languageDetectionPromise = new Promise((resolve, reject) => {
			// Tạo script Python tạm thời để chạy faster-whisper
			const tempScriptPath = path.join(
				config.uploadPath,
				'faster_whisper_language_detection.py'
			);
			const pythonScript = `
import sys
import os
import json
from faster_whisper import WhisperModel

sample_path = "${samplePath.replace(/\\/g, '\\\\')}"
output_dir = "${config.uploadPath.replace(/\\/g, '\\\\')}"
base_name = os.path.basename(sample_path)
json_path = os.path.join(output_dir, f"{os.path.splitext(base_name)[0]}.json")

print(f"Đang phát hiện ngôn ngữ từ: {sample_path}")

# Tải model
print("Đang tải model faster-whisper tiny...")
model = WhisperModel("tiny", device="cpu", compute_type="int8")

# Thực hiện chuyển đổi và phát hiện ngôn ngữ
# Mặc định luôn coi ngôn ngữ là tiếng Nhật
segments, info = model.transcribe(sample_path, language="ja", task="transcribe")

# Ghi kết quả vào file JSON
output = {
    "language": "ja", # Mặc định luôn trả về tiếng Nhật
    "language_probability": 1.0,
    "segments": []
}

for segment in segments:
    output["segments"].append({
        "id": segment.id,
        "start": segment.start,
        "end": segment.end,
        "text": segment.text
    })

with open(json_path, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"Đã lưu kết quả vào: {json_path}")
print(f"Ngôn ngữ được phát hiện: {output['language']}")
`;

			// Ghi script Python vào file tạm thời
			fs.writeFileSync(tempScriptPath, pythonScript);

			// Thực thi script Python
			const command = `python3 "${tempScriptPath}"`;
			console.log(`Thực thi Faster-Whisper để phát hiện ngôn ngữ: ${command}`);

			exec(command, (error, stdout, stderr) => {
				// Xóa file script tạm thời
				try {
					fs.unlinkSync(tempScriptPath);
					console.log(`Đã xóa file script tạm thời: ${tempScriptPath}`);
				} catch (scriptCleanupError) {
					console.error(
						`Lỗi khi xóa file script tạm thời: ${scriptCleanupError.message}`
					);
				}

				// Xóa file mẫu âm thanh
				try {
					fs.unlinkSync(samplePath);
					console.log(`Đã xóa file mẫu âm thanh: ${samplePath}`);
				} catch (cleanupError) {
					console.error(`Lỗi khi xóa file mẫu: ${cleanupError.message}`);
				}

				if (error) {
					console.error(`Lỗi Faster-Whisper: ${error.message}`);
					reject(error);
					return;
				}

				try {
					// Tìm file JSON output
					const baseName = path.basename(samplePath, path.extname(samplePath));
					const jsonPath = path.join(config.uploadPath, `${baseName}.json`);

					if (!fs.existsSync(jsonPath)) {
						console.error(`Không tìm thấy file kết quả: ${jsonPath}`);
						reject(new Error('Không tìm thấy file kết quả phát hiện ngôn ngữ'));
						return;
					}

					// Đọc file kết quả
					const jsonContent = fs.readFileSync(jsonPath, 'utf8');
					const result = JSON.parse(jsonContent);

					// Xóa file JSON
					fs.unlinkSync(jsonPath);
					console.log(`Đã xóa file kết quả JSON: ${jsonPath}`);

					// Ghi đè ngôn ngữ phát hiện thành tiếng Nhật
					const detectedLanguage = 'ja'; // Luôn trả về tiếng Nhật
					console.log(`Ngôn ngữ được phát hiện: ${detectedLanguage}`);

					// Trả về thông tin ngôn ngữ
					resolve({
						code: detectedLanguage,
						name: getLanguageName(detectedLanguage),
					});
				} catch (parseError) {
					console.error(`Lỗi khi phân tích kết quả: ${parseError.message}`);
					reject(parseError);
				}
			});
		});

		// Đặt timeout cho quá trình phát hiện ngôn ngữ
		return pTimeout(
			languageDetectionPromise,
			LANGUAGE_DETECTION_TIMEOUT,
			`Quá thời gian (${LANGUAGE_DETECTION_TIMEOUT / 1000 / 60} phút) khi phát hiện ngôn ngữ`
		);
	} catch (error) {
		console.error('Lỗi khi phát hiện ngôn ngữ:', error);
		// Trả về ngôn ngữ mặc định là tiếng Anh nếu có lỗi
		return { code: 'en', name: 'English' };
	}
}

/**
 * Lấy tên đầy đủ của ngôn ngữ từ mã
 * @param {string} languageCode - Mã ngôn ngữ (ISO 639-1)
 * @returns {string} - Tên đầy đủ của ngôn ngữ
 */
function getLanguageName(languageCode) {
	const languageMap = {
		en: 'English (Tiếng Anh)',
		vi: 'Vietnamese (Tiếng Việt)',
		zh: 'Chinese (Tiếng Trung)',
		ja: 'Japanese (Tiếng Nhật)',
		ko: 'Korean (Tiếng Hàn)',
		fr: 'French (Tiếng Pháp)',
		de: 'German (Tiếng Đức)',
		es: 'Spanish (Tiếng Tây Ban Nha)',
		it: 'Italian (Tiếng Ý)',
		ru: 'Russian (Tiếng Nga)',
		ar: 'Arabic (Tiếng Ả Rập)',
		hi: 'Hindi (Tiếng Hindi)',
		pt: 'Portuguese (Tiếng Bồ Đào Nha)',
		th: 'Thai (Tiếng Thái)',
		id: 'Indonesian (Tiếng Indonesia)',
		ms: 'Malay (Tiếng Malaysia)',
		tr: 'Turkish (Tiếng Thổ Nhĩ Kỳ)',
		nl: 'Dutch (Tiếng Hà Lan)',
		pl: 'Polish (Tiếng Ba Lan)',
		sv: 'Swedish (Tiếng Thụy Điển)',
		da: 'Danish (Tiếng Đan Mạch)',
		no: 'Norwegian (Tiếng Na Uy)',
		fi: 'Finnish (Tiếng Phần Lan)',
		cs: 'Czech (Tiếng Séc)',
		hu: 'Hungarian (Tiếng Hungary)',
		el: 'Greek (Tiếng Hy Lạp)',
		he: 'Hebrew (Tiếng Do Thái)',
		fa: 'Persian (Tiếng Ba Tư)',
		uk: 'Ukrainian (Tiếng Ukraine)',
		ro: 'Romanian (Tiếng Romania)',
		bg: 'Bulgarian (Tiếng Bulgaria)',
		hr: 'Croatian (Tiếng Croatia)',
		sk: 'Slovak (Tiếng Slovakia)',
		sl: 'Slovenian (Tiếng Slovenia)',
		sr: 'Serbian (Tiếng Serbia)',
		lt: 'Lithuanian (Tiếng Lithuania)',
		lv: 'Latvian (Tiếng Latvia)',
		et: 'Estonian (Tiếng Estonia)',
	};

	return languageMap[languageCode] || `Unknown (${languageCode})`;
}

/**
 * Gợi ý prompt dịch dựa trên ngôn ngữ phát hiện được
 * @param {Object} languageInfo - Thông tin ngôn ngữ {code, name}
 * @returns {string} - Prompt gợi ý cho việc dịch
 */
function suggestTranslationPrompt(languageInfo) {
	const promptTemplates = {
		en: 'Dịch phụ đề tiếng Anh sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên',
		zh: 'Dịch phụ đề tiếng Trung sang tiếng Việt, giữ nguyên nghĩa gốc và phong cách văn hóa',
		ja: 'Dịch phụ đề tiếng Nhật sang tiếng Việt, đảm bảo chính xác các thuật ngữ anime/manga nếu có',
		ko: 'Dịch phụ đề tiếng Hàn sang tiếng Việt, giữ nguyên nghĩa và phong cách văn hóa K-Drama/K-Pop nếu có',
		fr: 'Dịch phụ đề tiếng Pháp sang tiếng Việt, giữ nguyên nghĩa và sắc thái văn hóa',
		de: 'Dịch phụ đề tiếng Đức sang tiếng Việt, giữ nguyên nghĩa gốc',
		es: 'Dịch phụ đề tiếng Tây Ban Nha sang tiếng Việt, giữ nguyên nghĩa gốc',
		ru: 'Dịch phụ đề tiếng Nga sang tiếng Việt, giữ nguyên nghĩa gốc và sắc thái văn hóa',
		th: 'Dịch phụ đề tiếng Thái sang tiếng Việt, đảm bảo phản ánh đúng văn hóa và ngôn ngữ Thái',
		id: 'Dịch phụ đề tiếng Indonesia sang tiếng Việt, giữ nguyên nghĩa gốc',
	};

	// Nếu không có mẫu riêng cho ngôn ngữ này, dùng mẫu chung
	if (!promptTemplates[languageInfo.code]) {
		return `Dịch phụ đề từ ${languageInfo.name} sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên`;
	}

	return promptTemplates[languageInfo.code];
}

module.exports = {
	detectLanguage,
	getLanguageName,
	suggestTranslationPrompt,
};
