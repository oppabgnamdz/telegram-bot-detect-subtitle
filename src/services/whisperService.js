const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config');
const pTimeout = require('p-timeout');

// Cấu hình thời gian chờ tăng lên cho Whisper
const WHISPER_TIMEOUT = 7200000; // 2 giờ (7,200,000 ms)

/**
 * Trích xuất phụ đề từ video sử dụng Whisper
 * @param {string} videoPath - Đường dẫn đến file video
 * @returns {Promise<string>} - Đường dẫn đến file SRT được tạo
 */
async function extractSubtitles(videoPath) {
	try {
		const videoName = path.basename(videoPath, path.extname(videoPath));
		const outputPath = path.join(config.uploadPath, `${videoName}.srt`);

		// Kiểm tra xem whisper có được cài đặt không
		const checkWhisperCmd = 'which whisper || echo "not found"';
		const whisperPath = await new Promise((resolve, reject) => {
			exec(checkWhisperCmd, (error, stdout, stderr) => {
				if (error) {
					console.error(`Không thể kiểm tra whisper: ${error.message}`);
				}
				resolve(stdout.trim());
			});
		});

		if (whisperPath === 'not found') {
			throw new Error(
				'Whisper chưa được cài đặt hoặc không có trong PATH. Vui lòng cài đặt whisper và đảm bảo nó có trong PATH.'
			);
		}

		console.log(`Đang xử lý video: ${videoPath}`);
		console.log(`Sử dụng model: ${config.whisperModel}`);

		const whisperPromise = new Promise((resolve, reject) => {
			// Sử dụng Whisper CLI để trích xuất phụ đề
			const command = `whisper "${videoPath}" --model ${config.whisperModel} --language ja --output_format srt --output_dir "${config.uploadPath}"`;
			console.log(`Thực thi lệnh: ${command}`);

			// Không giới hạn timeout để xử lý video dài
			const childProcess = exec(command, {}, (error, stdout, stderr) => {
				if (error) {
					console.error(`Whisper error: ${error.message}`);
					reject(error);
					return;
				}

				if (stderr) {
					console.log(`Whisper stderr: ${stderr}`);
				}

				console.log(`Whisper stdout: ${stdout}`);

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
				console.log(`Whisper tiến trình: ${data}`);
			});
		});

		// Bọc promise với timeout dài hơn (2 giờ) cho quá trình trích xuất phụ đề
		return pTimeout(
			whisperPromise,
			WHISPER_TIMEOUT,
			`Quá thời gian (${WHISPER_TIMEOUT / 1000 / 60} phút) khi trích xuất phụ đề video với Whisper`
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
		const ffmpegCheck = await new Promise((resolve, reject) => {
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

		// Thực thi lệnh whisper
		const command = `whisper "${videoPath}" --model ${model} --language ja --output_format srt --output_dir "./uploads"`;
		console.log(`Thực thi lệnh: ${command}`);

		const { stdout, stderr } = await execPromise(command);
		console.log('Whisper stdout:', stdout);
		console.log('Whisper stderr:', stderr);

		// Kiểm tra file SRT đã được tạo chưa
		const srtPath = videoPath.replace(/\.[^/.]+$/, '.srt');
		if (!fs.existsSync(srtPath)) {
			throw new Error('Không thể tạo file phụ đề');
		}

		return srtPath;
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
