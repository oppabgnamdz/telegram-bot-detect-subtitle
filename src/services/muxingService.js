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
 * Lấy thông tin độ phân giải của video
 * @param {string} videoPath - Đường dẫn đến file video
 * @returns {Promise<{width: number, height: number}>} - Độ phân giải của video
 */
async function getVideoResolution(videoPath) {
	return new Promise((resolve, reject) => {
		const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}"`;
		exec(command, (error, stdout, stderr) => {
			if (error) {
				console.error(`Lỗi khi lấy độ phân giải video: ${error.message}`);
				// Nếu không thể lấy, trả về độ phân giải mặc định HD
				resolve({ width: 1280, height: 720 });
				return;
			}

			try {
				const [width, height] = stdout.trim().split('x').map(Number);
				console.log(`Độ phân giải video: ${width}x${height}`);
				resolve({ width, height });
			} catch (e) {
				console.error(`Lỗi khi phân tích độ phân giải: ${e.message}`);
				resolve({ width: 1280, height: 720 });
			}
		});
	});
}

/**
 * Tính toán kích thước phụ đề dựa trên độ phân giải video
 * @param {Object} resolution - Độ phân giải của video {width, height}
 * @returns {number} - Kích thước phụ đề tối ưu
 */
function calculateOptimalFontSize(resolution) {
	// Các ngưỡng độ phân giải
	const resolutionThresholds = [
		{ width: 3840, height: 2160, fontSize: 48 }, // 4K
		{ width: 2560, height: 1440, fontSize: 36 }, // 2K
		{ width: 1920, height: 1080, fontSize: 28 }, // Full HD
		{ width: 1280, height: 720, fontSize: 24 }, // HD
		{ width: 854, height: 480, fontSize: 20 }, // SD
		{ width: 640, height: 360, fontSize: 16 }, // 360p
		{ width: 426, height: 240, fontSize: 14 }, // 240p
	];

	// Tìm ngưỡng phù hợp với độ phân giải
	for (const threshold of resolutionThresholds) {
		if (
			resolution.width >= threshold.width ||
			resolution.height >= threshold.height
		) {
			return threshold.fontSize;
		}
	}

	// Mặc định cho các độ phân giải rất nhỏ
	return 12;
}

/**
 * Tính toán vị trí phù hợp cho phụ đề dựa trên tỷ lệ khung hình
 * @param {Object} resolution - Độ phân giải của video {width, height}
 * @param {string} position - Vị trí chỉ định ('top', 'middle', 'bottom')
 * @returns {string} - Biểu thức vị trí cho FFmpeg
 */
function calculateSubtitlePosition(resolution, position) {
	// Tính tỷ lệ khung hình
	const aspectRatio = resolution.width / resolution.height;

	// Vị trí mặc định
	let positionExpr = '(w-tw)/2:h-th-10'; // Bottom center

	// Căn chỉnh vị trí dựa theo tỷ lệ khung hình và vị trí được chọn
	switch (position) {
		case 'top':
			// Đối với video có tỷ lệ rộng, đặt cao hơn một chút
			if (aspectRatio > 2) {
				// Video siêu rộng (ultrawide)
				positionExpr = '(w-tw)/2:h*0.05';
			} else if (aspectRatio > 1.7) {
				// Video rộng (widescreen)
				positionExpr = '(w-tw)/2:h*0.08';
			} else {
				positionExpr = '(w-tw)/2:h*0.1'; // Video tỷ lệ bình thường
			}
			break;

		case 'middle':
			positionExpr = '(w-tw)/2:(h-th)/2';
			break;

		case 'bottom':
		default:
			// Đối với video có tỷ lệ rộng, đặt thấp hơn một chút để tránh bị che
			if (aspectRatio > 2) {
				// Video siêu rộng
				positionExpr = '(w-tw)/2:h-th-(h*0.05)';
			} else if (aspectRatio > 1.7) {
				// Video rộng
				positionExpr = '(w-tw)/2:h-th-(h*0.08)';
			} else {
				positionExpr = '(w-tw)/2:h-th-(h*0.1)'; // Video tỷ lệ bình thường
			}
	}

	return positionExpr;
}

/**
 * Ghép phụ đề vào video sử dụng ffmpeg
 * @param {string} videoPath - Đường dẫn đến file video
 * @param {string} subtitlePath - Đường dẫn đến file phụ đề
 * @param {Object} options - Các tùy chọn gắn phụ đề
 * @param {string} options.language - Ngôn ngữ của phụ đề (mặc định: 'vie')
 * @param {string} options.font - Font chữ (mặc định: 'Arial')
 * @param {number} options.fontSize - Kích thước chữ (mặc định: dựa trên độ phân giải)
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
		// Lấy độ phân giải của video
		const resolution = await getVideoResolution(videoPath);

		// Tính toán kích thước phụ đề tối ưu
		const optimalFontSize = calculateOptimalFontSize(resolution);

		// Các tùy chọn mặc định
		const defaultOptions = {
			language: 'vie',
			font: 'Arial',
			fontSize: optimalFontSize, // Sử dụng kích thước được tính toán
			fontColor: 'white',
			position: 'bottom',
			skipFormatCheck: false,
			style: {
				primaryColour: '&HFFFFFF', // Màu trắng mặc định
				outlineColour: '&H000000', // Màu đen cho viền
				backColour: '&H00000000', // Màu nền trong suốt
				borderStyle: 1, // Kiểu viền (1 = viền mỏng)
				outline: 1, // Độ dày viền
				shadow: 0, // Không có bóng đổ
			},
		};

		// Kết hợp tùy chọn người dùng với tùy chọn mặc định
		const finalOptions = { ...defaultOptions, ...options };

		// Điều chỉnh độ dày viền dựa trên kích thước chữ
		if (!options.style?.outline) {
			finalOptions.style.outline = Math.max(
				1,
				Math.floor(finalOptions.fontSize / 16)
			);
		}

		// Kiểm tra video có hỗ trợ gắn subtitle không (nếu không bỏ qua kiểm tra)
		if (!finalOptions.skipFormatCheck) {
			const isSupported = await checkVideoSubtitleSupport(videoPath);
			if (!isSupported) {
				console.warn(
					'Định dạng video không được xác định là hỗ trợ phụ đề, nhưng sẽ thử ghép anyway'
				);
			}
		}

		// Lấy độ dài video để tính phần trăm tiến độ
		let videoDuration = 0;
		await new Promise((resolve) => {
			const durationCommand = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
			exec(durationCommand, (err, stdout, stderr) => {
				if (!err && stdout) {
					videoDuration = parseFloat(stdout.trim());
					console.log(`Video duration: ${videoDuration} seconds`);
				}
				resolve();
			});
		});

		// Tạo tên file kết quả ngẫu nhiên để tránh xung đột
		const randomHash = crypto.randomBytes(8).toString('hex');
		const outputFileName = `muxed_${randomHash}${path.extname(videoPath)}`;
		const outputPath = path.join(config.uploadPath, outputFileName);

		console.log(`Đang ghép phụ đề ${subtitlePath} vào video ${videoPath}`);
		console.log(
			`Sử dụng kích thước chữ: ${finalOptions.fontSize} cho độ phân giải ${resolution.width}x${resolution.height}`
		);

		const muxingPromise = new Promise((resolve, reject) => {
			// Xác định vị trí hiển thị phụ đề dựa trên tỷ lệ khung hình
			const positionArg = calculateSubtitlePosition(
				resolution,
				finalOptions.position
			);
			console.log(`Sử dụng vị trí phụ đề: ${positionArg}`);

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
				`ffmpeg -i "${videoPath}" -vf "subtitles=${subtitlePath}:force_style='FontName=${finalOptions.font},FontSize=${finalOptions.fontSize},PrimaryColour=${finalOptions.style.primaryColour},OutlineColour=${finalOptions.style.outlineColour},BackColour=${finalOptions.style.backColour},BorderStyle=${finalOptions.style.borderStyle},Outline=${finalOptions.style.outline},Shadow=${finalOptions.style.shadow},Alignment=2'" ` +
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

					// Thêm thông tin về tổng thời lượng video vào statusText
					const enrichedStatusText =
						videoDuration > 0
							? `${statusText} (Duration: ${formatDuration(videoDuration)})`
							: statusText;

					// Gửi cập nhật lên Telegram
					const now = Date.now();
					if (
						finalOptions.telegramInfo &&
						now - lastUpdateTime > STATUS_UPDATE_INTERVAL
					) {
						lastUpdateTime = now;
						lastStatus = enrichedStatusText;

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
										`<code>${statusText}</code>\n\n🔹 Tiến độ: ${extractProgress(enrichedStatusText, videoDuration)}\n🔹 Tốc độ: ${extractSpeed(statusText)}\n🔹 Thời gian đã xử lý: ${extractTime(statusText)}`
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

// Format thời lượng từ giây sang định dạng HH:MM:SS.ss
function formatDuration(seconds) {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
}

// Các hàm trích xuất thông tin từ chuỗi trạng thái ffmpeg
function extractProgress(statusText, videoDuration) {
	const timeMatch = statusText.match(/time=(\d+):(\d+):(\d+\.\d+)/);

	if (timeMatch) {
		// Nếu có thời gian hiện tại, chuyển đổi sang giây
		const currentHours = parseInt(timeMatch[1]);
		const currentMinutes = parseInt(timeMatch[2]);
		const currentSeconds = parseFloat(timeMatch[3]);
		const currentTimeInSeconds =
			currentHours * 3600 + currentMinutes * 60 + currentSeconds;

		// Nếu có thông tin về tổng thời lượng, tính phần trăm
		if (videoDuration > 0) {
			const percentage = Math.min(
				100,
				Math.round((currentTimeInSeconds / videoDuration) * 100)
			);
			return `${percentage}%`;
		}

		// Nếu không có thông tin về tổng thời lượng, tìm trong chuỗi trạng thái
		const durationMatch = statusText.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
		if (durationMatch) {
			const totalHours = parseInt(durationMatch[1]);
			const totalMinutes = parseInt(durationMatch[2]);
			const totalSeconds = parseFloat(durationMatch[3]);
			const totalDurationInSeconds =
				totalHours * 3600 + totalMinutes * 60 + totalSeconds;

			if (totalDurationInSeconds > 0) {
				const percentage = Math.min(
					100,
					Math.round((currentTimeInSeconds / totalDurationInSeconds) * 100)
				);
				return `${percentage}%`;
			}
		}

		// Nếu không có thông tin về tổng thời lượng, chỉ trả về thời gian hiện tại
		return `${Math.round(currentTimeInSeconds)} giây`;
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
	getVideoResolution,
	calculateOptimalFontSize,
};
