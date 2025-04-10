const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config');
const pTimeout = require('p-timeout');

// Cấu hình thời gian chờ tăng lên cho Whisper
const WHISPER_TIMEOUT = 7200000; // 2 giờ (7,200,000 ms)

/**
 * Trích xuất phụ đề từ video sử dụng Faster-Whisper
 * @param {string} videoPath - Đường dẫn đến file video
 * @returns {Promise<string>} - Đường dẫn đến file SRT được tạo
 */
async function extractSubtitles(videoPath) {
	try {
		const videoName = path.basename(videoPath, path.extname(videoPath));
		const outputPath = path.join(config.uploadPath, `${videoName}.srt`);

		// Kiểm tra xem python có được cài đặt không
		const checkPythonCmd = 'which python3 || echo "not found"';
		const pythonPath = await new Promise((resolve, reject) => {
			exec(checkPythonCmd, (error, stdout, stderr) => {
				if (error) {
					console.error(`Không thể kiểm tra python3: ${error.message}`);
				}
				resolve(stdout.trim());
			});
		});

		if (pythonPath === 'not found') {
			throw new Error(
				'Python3 chưa được cài đặt hoặc không có trong PATH. Vui lòng cài đặt Python và đảm bảo nó có trong PATH.'
			);
		}

		console.log(`Đang xử lý video: ${videoPath}`);
		console.log(`Sử dụng model: ${config.whisperModel}`);

		// Tạo script Python tạm thời để chạy faster-whisper
		const tempScriptPath = path.join(
			config.uploadPath,
			'faster_whisper_script.py'
		);
		const pythonScript = `
import sys
import os
from faster_whisper import WhisperModel

# Kiểm tra tham số đầu vào
if len(sys.argv) < 4:
    print("Sử dụng: python3 script.py video_path output_dir model_name")
    sys.exit(1)

def format_timestamp(seconds):
    """Chuyển đổi thời gian từ giây sang định dạng SRT (00:00:00,000)"""
    hours = int(seconds / 3600)
    minutes = int((seconds % 3600) / 60)
    secs = seconds % 60
    millisecs = int((seconds - int(seconds)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{int(secs):02d},{millisecs:03d}"

video_path = sys.argv[1]
output_dir = sys.argv[2]
model_name = sys.argv[3]
language = sys.argv[4] if len(sys.argv) > 4 else "ja"

print(f"Đang xử lý video: {video_path}")
print(f"Thư mục đầu ra: {output_dir}")
print(f"Model: {model_name}")
print(f"Ngôn ngữ: {language}")

# Tạo tên file đầu ra
video_name = os.path.basename(video_path)
base_name = os.path.splitext(video_name)[0]
srt_path = os.path.join(output_dir, f"{base_name}.srt")

# Tải model
print("Đang tải model faster-whisper...")
model = WhisperModel(model_name, device="cpu", compute_type="int8")

# Thực hiện chuyển giọng nói thành văn bản
print("Đang thực hiện chuyển đổi...")
segments, info = model.transcribe(video_path, language=language, beam_size=5)

print(f"Phát hiện ngôn ngữ: {info.language}, độ tin cậy: {info.language_probability:.2f}")

# Ghi kết quả vào file SRT
with open(srt_path, "w", encoding="utf-8") as srt_file:
    for i, segment in enumerate(segments, start=1):
        # Định dạng thời gian SRT (00:00:00,000 --> 00:00:00,000)
        start_time = format_timestamp(segment.start)
        end_time = format_timestamp(segment.end)
        
        # Ghi vào file SRT
        srt_file.write(f"{i}\\n")
        srt_file.write(f"{start_time} --> {end_time}\\n")
        srt_file.write(f"{segment.text.strip()}\\n\\n")

print(f"Đã tạo file SRT thành công: {srt_path}")
`;

		// Ghi script Python vào file tạm thời
		await fs.writeFile(tempScriptPath, pythonScript);

		const whisperPromise = new Promise((resolve, reject) => {
			// Sử dụng Faster-Whisper thông qua Python script
			const command = `python3 "${tempScriptPath}" "${videoPath}" "${config.uploadPath}" ${config.whisperModel} ja`;
			console.log(`Thực thi lệnh: ${command}`);

			// Không giới hạn timeout để xử lý video dài
			const childProcess = exec(command, {}, (error, stdout, stderr) => {
				// Xóa file script tạm thời
				fs.remove(tempScriptPath).catch((err) => {
					console.error(`Lỗi khi xóa file script tạm thời: ${err.message}`);
				});

				if (error) {
					console.error(`Faster-Whisper error: ${error.message}`);
					reject(error);
					return;
				}

				if (stderr) {
					console.log(`Faster-Whisper stderr: ${stderr}`);
				}

				console.log(`Faster-Whisper stdout: ${stdout}`);

				// Kiểm tra xem file SRT có tồn tại không
				fs.access(outputPath, fs.constants.F_OK, (err) => {
					if (err) {
						console.error(`Không tìm thấy file SRT: ${outputPath}`);
						// Tìm bất kỳ file SRT nào trong thư mục
						fs.readdir(config.uploadPath, (dirErr, files) => {
							if (dirErr) {
								reject(new Error(`Không thể đọc thư mục: ${dirErr.message}`));
								return;
							}

							const srtFiles = files.filter(
								(file) => file.endsWith('.srt') && file.includes(videoName)
							);
							if (srtFiles.length > 0) {
								const foundSrtPath = path.join(config.uploadPath, srtFiles[0]);
								console.log(`Tìm thấy file SRT thay thế: ${foundSrtPath}`);
								resolve(foundSrtPath);
							} else {
								reject(new Error('Không thể tạo file phụ đề'));
							}
						});
					} else {
						console.log(`File SRT đã được tạo: ${outputPath}`);
						resolve(outputPath);
					}
				});
			});

			// Hiển thị tiến trình
			childProcess.stdout?.on('data', (data) => {
				console.log(`Faster-Whisper tiến trình: ${data}`);
			});
		});

		// Bọc promise với timeout dài hơn (2 giờ) cho quá trình trích xuất phụ đề
		return pTimeout(
			whisperPromise,
			WHISPER_TIMEOUT,
			`Quá thời gian (${WHISPER_TIMEOUT / 1000 / 60} phút) khi trích xuất phụ đề video với Faster-Whisper`
		);
	} catch (error) {
		console.error('Error extracting subtitles:', error);
		throw error;
	}
}

async function transcribeVideo(videoPath, model = 'tiny') {
	console.log(`Đang xử lý video: ${videoPath}`);
	console.log(`Sử dụng model: ${model}`);

	try {
		// Kiểm tra file video có tồn tại và hợp lệ không
		if (!fs.existsSync(videoPath)) {
			throw new Error('File video không tồn tại');
		}

		// Kiểm tra kích thước file
		const stats = fs.statSync(videoPath);
		if (stats.size === 0) {
			throw new Error('File video trống');
		}

		// Thử kiểm tra file video bằng ffmpeg
		await new Promise((resolve, reject) => {
			const process = exec(
				`ffmpeg -v error -i "${videoPath}" -f null - 2>&1`,
				(error, stdout, stderr) => {
					if (error) {
						reject(new Error(`File video không hợp lệ: ${stderr}`));
					} else {
						resolve(true);
					}
				}
			);
		});

		// Tạo script Python tạm thời để chạy faster-whisper
		const videoName = path.basename(videoPath, path.extname(videoPath));
		const outputPath = path.join('./uploads', `${videoName}.srt`);
		const tempScriptPath = path.join('./uploads', 'faster_whisper_temp.py');

		const pythonScript = `
import sys
import os
from faster_whisper import WhisperModel

def format_timestamp(seconds):
    """Chuyển đổi thời gian từ giây sang định dạng SRT (00:00:00,000)"""
    hours = int(seconds / 3600)
    minutes = int((seconds % 3600) / 60)
    secs = seconds % 60
    millisecs = int((seconds - int(seconds)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{int(secs):02d},{millisecs:03d}"

video_path = "${videoPath.replace(/\\/g, '\\\\')}"
model_name = "${model}"
output_dir = "./uploads"
language = "ja"

print(f"Đang xử lý video: {video_path}")
print(f"Model: {model_name}")

# Tạo tên file đầu ra
video_name = os.path.basename(video_path)
base_name = os.path.splitext(video_name)[0]
srt_path = os.path.join(output_dir, f"{base_name}.srt")

# Tải model
print("Đang tải model faster-whisper...")
model = WhisperModel(model_name, device="cpu", compute_type="int8")

# Thực hiện chuyển giọng nói thành văn bản
print("Đang thực hiện chuyển đổi...")
segments, info = model.transcribe(video_path, language=language, beam_size=5)

print(f"Phát hiện ngôn ngữ: {info.language}, độ tin cậy: {info.language_probability:.2f}")

# Ghi kết quả vào file SRT
with open(srt_path, "w", encoding="utf-8") as srt_file:
    for i, segment in enumerate(segments, start=1):
        # Định dạng thời gian SRT (00:00:00,000 --> 00:00:00,000)
        start_time = format_timestamp(segment.start)
        end_time = format_timestamp(segment.end)
        
        # Ghi vào file SRT
        srt_file.write(f"{i}\\n")
        srt_file.write(f"{start_time} --> {end_time}\\n")
        srt_file.write(f"{segment.text.strip()}\\n\\n")

print(f"Đã tạo file SRT thành công: {srt_path}")
`;

		// Ghi script Python vào file tạm thời
		await fs.writeFile(tempScriptPath, pythonScript);

		// Chạy script Python
		const { stdout, stderr } = await new Promise((resolve, reject) => {
			exec(`python3 "${tempScriptPath}"`, (error, stdout, stderr) => {
				if (error) {
					reject(new Error(`Faster-Whisper error: ${error.message}`));
					return;
				}
				resolve({ stdout, stderr });
			});
		});

		// Xóa script tạm thời
		await fs.remove(tempScriptPath).catch((err) => {
			console.error(`Lỗi khi xóa file script tạm thời: ${err.message}`);
		});

		console.log('Faster-Whisper stdout:', stdout);
		console.log('Faster-Whisper stderr:', stderr);

		// Kiểm tra file SRT đã được tạo chưa
		if (!fs.existsSync(outputPath)) {
			throw new Error('Không thể tạo file phụ đề');
		}

		return outputPath;
	} catch (error) {
		console.error('Error processing subtitle:', error);

		// Xóa file video nếu có lỗi
		if (fs.existsSync(videoPath)) {
			try {
				await fs.unlink(videoPath);
				console.log('Đã xóa file video do lỗi:', videoPath);
			} catch (unlinkError) {
				console.error('Lỗi khi xóa file video:', unlinkError);
			}
		}

		// Xóa file SRT nếu có
		const srtPath = videoPath.replace(/\.[^/.]+$/, '.srt');
		if (fs.existsSync(srtPath)) {
			try {
				await fs.unlink(srtPath);
				console.log('Đã xóa file SRT do lỗi:', srtPath);
			} catch (unlinkError) {
				console.error('Lỗi khi xóa file SRT:', unlinkError);
			}
		}

		throw error;
	}
}

module.exports = {
	extractSubtitles,
	transcribeVideo,
};
