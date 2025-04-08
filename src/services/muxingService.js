/**
 * Dịch vụ ghép phụ đề và video
 */
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const config = require('../config');
const crypto = require('crypto');
const pTimeout = require('p-timeout');

// Định nghĩa hàm formatMessage nội bộ
const formatMessage = (emoji, title, content) => {
	return `<b>${emoji} ${title}</b>\n\n${content}`;
};

// Cấu hình thời gian chờ tăng lên cho quá trình ghép video
const MUXING_TIMEOUT = 7200000; // 2 giờ (7,200,000 ms)
// Cấu hình cập nhật trạng thái
const STATUS_UPDATE_INTERVAL = 3000; // Cập nhật trạng thái mỗi 3 giây

/**
 * Kiểm tra định dạng video có hỗ trợ gắn subtitle không
 * @param {string} videoPath - Đường dẫn đến file video
 * @returns {Promise<boolean>} - true nếu video hỗ trợ gắn subtitle
 */
async function checkVideoSubtitleSupport(videoPath) {
	return new Promise((resolve, reject) => {
		const command = `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
		exec(command, (error, stdout, stderr) => {
			if (error) {
				console.error(`Lỗi khi kiểm tra video: ${error.message}`);
				// Nếu không thể kiểm tra, giả định là hỗ trợ
				resolve(true);
				return;
			}
			// Các định dạng video phổ biến hỗ trợ subtitle
			const supportedFormats = [
				'h264',
				'hevc',
				'mpeg4',
				'mpeg2video',
				'vp8',
				'vp9',
				'av1',
				'prores',
				'mjpeg',
				'wmv2',
				'wmv3',
			];
			const codec = stdout.trim().toLowerCase();
			const isSupported = supportedFormats.includes(codec);
			console.log(`Codec video: ${codec}, Hỗ trợ phụ đề: ${isSupported}`);
			resolve(isSupported);
		});
	});
}

/**
 * Ghép phụ đề vào video sử dụng ffmpeg
 * @param {string} videoPath - Đường dẫn đến file video
 * @param {string} subtitlePath - Đường dẫn đến file phụ đề
 * @param {Object} options - Các tùy chọn gắn phụ đề
 * @param {string} options.language - Ngôn ngữ của phụ đề (mặc định: 'vie')
 * @param {string} options.font - Font chữ (mặc định: 'Arial')
 * @param {number} options.fontSize - Kích thước chữ (mặc định: 24)
 * @param {string} options.fontColor - Màu chữ (mặc định: 'white')
 * @param {string} options.position - Vị trí hiển thị (mặc định: 'bottom')
 * @param {boolean} options.skipFormatCheck - Bỏ qua kiểm tra định dạng video (mặc định: false)
 * @param {Object} options.telegramInfo - Thông tin để gửi cập nhật lên Telegram (tùy chọn)
 * @param {Object} options.telegramInfo.ctx - Context của Telegram
 * @param {number} options.telegramInfo.messageId - ID của tin nhắn cần cập nhật
 * @returns {Promise<string>} - Đường dẫn đến file video đã ghép
 */
async function muxSubtitleToVideo(videoPath, subtitlePath, options = {}) {
	try {
		// Các tùy chọn mặc định
		const defaultOptions = {
			language: 'vie',
			font: 'Arial',
			fontSize: 24,
			fontColor: 'white',
			position: 'bottom',
			skipFormatCheck: false,
		};

		// Kết hợp tùy chọn người dùng với tùy chọn mặc định
		const finalOptions = { ...defaultOptions, ...options };

		// Kiểm tra video có hỗ trợ gắn subtitle không (nếu không bỏ qua kiểm tra)
		if (!finalOptions.skipFormatCheck) {
			const isSupported = await checkVideoSubtitleSupport(videoPath);
			if (!isSupported) {
				console.warn(
					'Định dạng video không được xác định là hỗ trợ phụ đề, nhưng sẽ thử ghép anyway'
				);
			}
		}

		// Tạo tên file kết quả ngẫu nhiên để tránh xung đột
		const randomHash = crypto.randomBytes(8).toString('hex');
		const outputFileName = `muxed_${randomHash}${path.extname(videoPath)}`;
		const outputPath = path.join(config.uploadPath, outputFileName);

		console.log(`Đang ghép phụ đề ${subtitlePath} vào video ${videoPath}`);

		const muxingPromise = new Promise((resolve, reject) => {
			// Xác định vị trí hiển thị phụ đề
			let positionArg = '';
			switch (finalOptions.position) {
				case 'top':
					positionArg = '(w-tw)/2:10';
					break;
				case 'middle':
					positionArg = '(w-tw)/2:(h-th)/2';
					break;
				case 'bottom':
				default:
					positionArg = '(w-tw)/2:h-th-10';
			}

			// Sử dụng ffmpeg để ghép phụ đề vào video với các tùy chọn
			// Thử hai phương pháp khác nhau để ghép phụ đề
			// Phương pháp 1: Sử dụng -c:s mov_text (tốt cho MP4)
			const command1 =
				`ffmpeg -i "${videoPath}" -i "${subtitlePath}" -c:v copy -c:a copy ` +
				`-c:s mov_text -metadata:s:s:0 language=${finalOptions.language} ` +
				`-disposition:s:0 default ` +
				`"${outputPath}"`;

			// Phương pháp 2: Sử dụng -vf subtitles (tốt cho nhiều định dạng)
			const command2 =
				`ffmpeg -i "${videoPath}" -vf "subtitles=${subtitlePath}:force_style='FontName=${finalOptions.font},FontSize=${finalOptions.fontSize},PrimaryColour=&HFFFFFF,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=1,Alignment=2'" ` +
				`-c:a copy "${outputPath}"`;

			// Thử phương pháp 2 trước (render trực tiếp)
			console.log(`Thực thi lệnh (phương pháp 2): ${command2}`);

			const childProcess = exec(command2, (error2, stdout2, stderr2) => {
				if (error2) {
					console.error(`Ffmpeg error (phương pháp 2): ${error2.message}`);
					console.log('Thử phương pháp 1...');

					// Nếu phương pháp 2 thất bại, thử phương pháp 1
					exec(command1, (error, stdout, stderr) => {
						if (error) {
							console.error(`Ffmpeg error (phương pháp 1): ${error.message}`);
							reject(error);
							return;
						}

						if (stderr) {
							console.log(`Ffmpeg stderr (phương pháp 1): ${stderr}`);
						}

						console.log(`Ffmpeg stdout (phương pháp 1): ${stdout}`);

						// Kiểm tra xem file kết quả có tồn tại không
						fs.access(outputPath, fs.constants.F_OK, (err) => {
							if (err) {
								console.error(`Không tìm thấy file kết quả: ${outputPath}`);
								reject(new Error('Không thể tạo file video với phụ đề'));
							} else {
								console.log(`File video với phụ đề đã được tạo: ${outputPath}`);
								resolve(outputPath);
							}
						});
					});
					return;
				}

				if (stderr2) {
					console.log(`Ffmpeg stderr (phương pháp 2): ${stderr2}`);
				}

				console.log(`Ffmpeg stdout (phương pháp 2): ${stdout2}`);

				// Kiểm tra xem file kết quả có tồn tại không
				fs.access(outputPath, fs.constants.F_OK, (err) => {
					if (err) {
						console.error(`Không tìm thấy file kết quả: ${outputPath}`);
						reject(new Error('Không thể tạo file video với phụ đề'));
					} else {
						console.log(`File video với phụ đề đã được tạo: ${outputPath}`);
						resolve(outputPath);
					}
				});
			});

			// Hiển thị tiến trình
			let lastStatus = '';
			let lastUpdateTime = 0;

			childProcess.stderr?.on('data', (data) => {
				const statusText = data.toString().trim();
				if (statusText.includes('time=')) {
					process.stdout.write(`\rĐang xử lý: ${statusText}`);

					// Gửi cập nhật lên Telegram
					const now = Date.now();
					if (
						finalOptions.telegramInfo &&
						now - lastUpdateTime > STATUS_UPDATE_INTERVAL
					) {
						lastUpdateTime = now;
						lastStatus = statusText;

						try {
							const { ctx, messageId } = finalOptions.telegramInfo;
							ctx.telegram
								.editMessageText(
									ctx.chat.id,
									messageId,
									null,
									formatMessage(
										'🔄',
										'Đang ghép phụ đề vào video',
										`<code>${statusText}</code>\n\n🔹 Tiến độ: ${extractProgress(statusText)}\n🔹 Tốc độ: ${extractSpeed(statusText)}\n🔹 Thời gian đã xử lý: ${extractTime(statusText)}`
									),
									{ parse_mode: 'HTML' }
								)
								.catch((err) => {
									// Bỏ qua lỗi flood control hoặc tin nhắn không thay đổi
									if (
										!err.message.includes('message is not modified') &&
										!err.message.includes('flood control')
									) {
										console.error('Lỗi khi cập nhật tin nhắn Telegram:', err);
									}
								});
						} catch (telegramError) {
							console.error(
								'Lỗi khi gửi cập nhật lên Telegram:',
								telegramError
							);
							// Tiếp tục xử lý bình thường ngay cả khi không cập nhật được Telegram
						}
					}
				}
			});
		});

		// Bọc promise với timeout dài hơn (2 giờ) cho quá trình ghép
		return pTimeout(
			muxingPromise,
			MUXING_TIMEOUT,
			`Quá thời gian (${MUXING_TIMEOUT / 1000 / 60} phút) khi ghép phụ đề vào video`
		);
	} catch (error) {
		console.error('Error muxing subtitles:', error);
		throw error;
	}
}

/**
 * Tạo đường dẫn trực tiếp để tải file
 * @param {string} filePath - Đường dẫn đến file cần tạo link
 * @returns {string} - URL trực tiếp để tải file
 */
function getDirectDownloadLink(filePath) {
	// Lấy tên file
	const fileName = path.basename(filePath);

	// Tạo URL tải trực tiếp
	// Lưu ý: URL này phụ thuộc vào cấu hình máy chủ web của bạn
	// Ví dụ: Nếu máy chủ của bạn có thư mục /uploads được phục vụ tại /downloads
	const downloadLink = `/downloads/${fileName}`;

	// Thay thế bằng URL thực tế của máy chủ của bạn
	const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
	const fullDownloadUrl = `${baseUrl}${downloadLink}`;

	return fullDownloadUrl;
}

// Các hàm trích xuất thông tin từ chuỗi trạng thái ffmpeg
function extractProgress(statusText) {
	const timeMatch = statusText.match(/time=(\d+:\d+:\d+\.\d+)/);
	if (timeMatch) {
		return timeMatch[1] || 'Đang xử lý...';
	}
	return 'Đang xử lý...';
}

function extractSpeed(statusText) {
	const speedMatch = statusText.match(/speed=(\d+\.\d+x)/);
	if (speedMatch) {
		return speedMatch[1] || 'Đang tính toán...';
	}
	return 'Đang tính toán...';
}

function extractTime(statusText) {
	const timeMatch = statusText.match(/time=(\d+:\d+:\d+\.\d+)/);
	if (timeMatch) {
		return timeMatch[1] || '00:00:00';
	}
	return '00:00:00';
}

module.exports = {
	muxSubtitleToVideo,
	getDirectDownloadLink,
};
