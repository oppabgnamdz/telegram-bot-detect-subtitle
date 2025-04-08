const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const config = require('../config');
const crypto = require('crypto');
const { exec } = require('child_process');
const YTDlpWrap = require('yt-dlp-wrap').default;
const pTimeout = require('p-timeout');
// Không sử dụng thư viện m3u8-downloader vì gây lỗi
// const M3U8Downloader = require('m3u8-downloader');

// Khởi tạo yt-dlp-wrap
let ytDlp = null;
try {
	ytDlp = new YTDlpWrap();
} catch (error) {
	console.warn('Không thể khởi tạo yt-dlp-wrap:', error.message);
	console.warn(
		'Sẽ kiểm tra và cài đặt yt-dlp nếu cần trong quá trình tải video'
	);
}

// Cấu hình thời gian chờ tăng lên (từ 60 giây mặc định)
const PROMISE_TIMEOUT = 6000000; // 10 phút (600,000 ms)

/**
 * Tạo tên file an toàn từ URL
 * @param {string} url - URL của video
 * @returns {string} - Tên file an toàn
 */
function generateSafeFileName(url) {
	try {
		// Tạo hash ngắn từ URL
		const hash = crypto
			.createHash('md5')
			.update(url)
			.digest('hex')
			.substring(0, 8);
		// Luôn sử dụng .mp4 làm phần mở rộng mặc định
		return `video_${hash}.mp4`;
	} catch (error) {
		// Nếu có lỗi, tạo tên file ngẫu nhiên
		const randomHash = crypto.randomBytes(4).toString('hex');
		return `video_${randomHash}.mp4`;
	}
}

/**
 * Kiểm tra xem URL có phải là định dạng m3u8 không
 * @param {string} url - URL cần kiểm tra
 * @returns {boolean} - true nếu là m3u8, false nếu không phải
 */
function isM3U8Url(url) {
	// Kiểm tra phần mở rộng URL
	if (url.toLowerCase().endsWith('.m3u8')) {
		return true;
	}

	// Kiểm tra tham số URL có chứa m3u8 không
	if (url.toLowerCase().includes('m3u8')) {
		return true;
	}

	return false;
}

/**
 * Tải video từ URL m3u8
 * @param {string} url - URL m3u8 của video cần tải
 * @param {string} outputPath - Đường dẫn lưu file video
 * @returns {Promise<string>} - Đường dẫn đến file đã tải
 */
async function downloadM3U8Video(url, outputPath) {
	console.log(`Đang tải video HLS (m3u8) từ ${url} vào ${outputPath}`);

	// Trực tiếp sử dụng ffmpeg để tải xuống
	return downloadM3U8UsingFFmpeg(url, outputPath);
}

/**
 * Tải video m3u8 sử dụng ffmpeg
 * @param {string} url - URL m3u8 của video cần tải
 * @param {string} outputPath - Đường dẫn lưu file video
 * @returns {Promise<string>} - Đường dẫn đến file đã tải
 */
async function downloadM3U8UsingFFmpeg(url, outputPath) {
	console.log(
		`Đang tải video HLS (m3u8) bằng ffmpeg từ ${url} vào ${outputPath}`
	);

	// Tạo lệnh ffmpeg với đầy đủ tùy chọn cần thiết
	// Tùy chọn được tối ưu hóa dựa trên các vấn đề phổ biến với m3u8
	const ffmpegBaseCmd =
		`ffmpeg -hide_banner -loglevel warning -stats ` +
		`-protocol_whitelist file,http,https,tcp,tls,crypto ` +
		`-user_agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15" ` +
		`-headers "Referer: ${new URL(url).origin}/\r\n" ` +
		`-multiple_requests 1 ` +
		`-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 ` +
		`-timeout 60000000 -rw_timeout 60000000 ` +
		`-i "${url}" -c copy -bsf:a aac_adtstoasc ` +
		`-max_muxing_queue_size 9999 "${outputPath}"`;

	console.log(`Thực thi lệnh: ${ffmpegBaseCmd}`);

	const ffmpegPromise = new Promise((resolve, reject) => {
		const process = exec(ffmpegBaseCmd);

		// Biến để theo dõi tiến trình
		let lastProgress = '';
		let hasProgress = false;

		process.stdout?.on('data', (data) => {
			console.log(`ffmpeg output: ${data}`);
		});

		process.stderr?.on('data', (data) => {
			// ffmpeg thường ghi log vào stderr, không nhất thiết là lỗi
			if (data.includes('time=')) {
				hasProgress = true;
				lastProgress = data.toString().trim();
				process.stdout.write(`\rĐang tải: ${lastProgress}`);
			} else if (
				data.toLowerCase().includes('error') &&
				!data.toLowerCase().includes('http error')
			) {
				console.error(`ffmpeg error: ${data}`);
			}
		});

		process.on('close', async (code) => {
			if (
				code === 0 ||
				(fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10240) // Ít nhất 10KB
			) {
				process.stdout.write('\n');
				console.log(`Tải thành công video HLS vào ${outputPath}`);
				resolve(outputPath);
			} else if (
				hasProgress &&
				fs.existsSync(outputPath) &&
				fs.statSync(outputPath).size > 0
			) {
				// Nếu đã có tiến trình và file có kích thước > 0, xem như thành công một phần
				process.stdout.write('\n');
				console.log(
					`Tải một phần video HLS vào ${outputPath} (${fs.statSync(outputPath).size} bytes)`
				);
				resolve(outputPath);
			} else {
				console.error(
					`ffmpeg thất bại với mã lỗi ${code}. Thử phương pháp khác...`
				);

				// Thử với một lệnh ffmpeg đơn giản hơn
				try {
					const result = await trySimplifiedFFmpeg(url, outputPath);
					resolve(result);
				} catch (simplifiedError) {
					// Nếu ffmpeg đơn giản thất bại, thử phương pháp thay thế
					tryDirectDownload(url, outputPath)
						.then(resolve)
						.catch((error) => {
							// Nếu phương pháp thứ hai thất bại, thử phương pháp thứ ba
							tryAdvancedDownload(url, outputPath)
								.then(resolve)
								.catch((finalError) => {
									console.log(
										'Các phương pháp ffmpeg thất bại, thử dùng yt-dlp...'
									);
									// Thêm phương pháp thứ tư sử dụng yt-dlp
									downloadWithYtDlp(url, outputPath)
										.then(resolve)
										.catch((ytDlpError) => {
											reject(
												new Error(
													`Không thể tải video m3u8 sau khi thử tất cả phương pháp: ${ytDlpError.message}`
												)
											);
										});
								});
						});
				}
			}
		});
	});

	// Bọc promise với timeout dài hơn - sử dụng cú pháp đúng cho p-timeout 4.1.0
	return pTimeout(
		ffmpegPromise,
		PROMISE_TIMEOUT,
		`Quá thời gian (${PROMISE_TIMEOUT / 1000} giây) khi tải video m3u8 với ffmpeg`
	);
}

/**
 * Thử với cấu hình ffmpeg đơn giản hơn
 * @param {string} url - URL m3u8 của video cần tải
 * @param {string} outputPath - Đường dẫn lưu file video
 * @returns {Promise<string>} - Đường dẫn đến file đã tải
 */
async function trySimplifiedFFmpeg(url, outputPath) {
	console.log(`Thử với cấu hình ffmpeg đơn giản hơn cho ${url}`);

	// Phương pháp 1: Sử dụng cấu hình tối giản
	const simpleFfmpegCmd = `ffmpeg -i "${url}" -c copy "${outputPath}"`;

	return new Promise((resolve, reject) => {
		console.log(`Thực thi lệnh đơn giản: ${simpleFfmpegCmd}`);
		const process = exec(simpleFfmpegCmd);

		let hasProgress = false;

		process.stderr?.on('data', (data) => {
			if (data.includes('time=')) {
				hasProgress = true;
				process.stdout.write(
					`\rĐang tải (đơn giản): ${data.toString().trim()}`
				);
			}
		});

		process.on('close', async (code) => {
			if (
				code === 0 ||
				(fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10240)
			) {
				process.stdout.write('\n');
				console.log(`Tải thành công với cấu hình đơn giản vào ${outputPath}`);
				resolve(outputPath);
			} else if (
				hasProgress &&
				fs.existsSync(outputPath) &&
				fs.statSync(outputPath).size > 0
			) {
				// Nếu đã có tiến trình và file có kích thước > 0, xem như thành công một phần
				process.stdout.write('\n');
				console.log(
					`Tải một phần video với cấu hình đơn giản vào ${outputPath}`
				);
				resolve(outputPath);
			} else {
				// Phương pháp 2: Thử với -allowed_extensions ALL
				const altFFmpegCmd = `ffmpeg -allowed_extensions ALL -i "${url}" -c copy "${outputPath}"`;
				console.log(`Thực thi lệnh thay thế: ${altFFmpegCmd}`);

				const altProcess = exec(altFFmpegCmd);
				let altHasProgress = false;

				altProcess.stderr?.on('data', (data) => {
					if (data.includes('time=')) {
						altHasProgress = true;
						process.stdout.write(
							`\rĐang tải (thay thế): ${data.toString().trim()}`
						);
					}
				});

				altProcess.on('close', (altCode) => {
					if (
						altCode === 0 ||
						(fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10240)
					) {
						process.stdout.write('\n');
						console.log(
							`Tải thành công với cấu hình thay thế vào ${outputPath}`
						);
						resolve(outputPath);
					} else if (
						altHasProgress &&
						fs.existsSync(outputPath) &&
						fs.statSync(outputPath).size > 0
					) {
						// Nếu đã có tiến trình và file có kích thước > 0, xem như thành công một phần
						process.stdout.write('\n');
						console.log(
							`Tải một phần video với cấu hình thay thế vào ${outputPath}`
						);
						resolve(outputPath);
					} else {
						reject(new Error(`Các cấu hình ffmpeg đơn giản đều thất bại`));
					}
				});
			}
		});
	});
}

/**
 * Thử tải m3u8 bằng cách phân tích và tải từng phân đoạn
 * @param {string} url - URL m3u8 của video cần tải
 * @param {string} outputPath - Đường dẫn lưu file video
 * @returns {Promise<string>} - Đường dẫn đến file đã tải
 */
async function tryDirectDownload(url, outputPath) {
	console.log(`Thử phương pháp thay thế để tải m3u8 từ ${url}`);

	try {
		// Tải playlist m3u8
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Không thể tải playlist m3u8: ${response.statusText}`);
		}

		const content = await response.text();
		console.log(
			`Đã tải nội dung playlist m3u8: ${content.substring(0, 200)}...`
		);

		// Nếu là master playlist, tìm URL của playlist con có chất lượng tốt nhất
		if (content.includes('#EXT-X-STREAM-INF')) {
			const baseUrl = new URL(url);
			const playlistLines = content.split('\n');
			let bestQualityUrl = '';
			let maxBandwidth = 0;

			for (let i = 0; i < playlistLines.length; i++) {
				if (playlistLines[i].includes('#EXT-X-STREAM-INF')) {
					const bandwidthMatch = playlistLines[i].match(/BANDWIDTH=(\d+)/);
					const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;

					if (bandwidth > maxBandwidth && i + 1 < playlistLines.length) {
						maxBandwidth = bandwidth;
						let subPath = playlistLines[i + 1].trim();

						// Xử lý URL tương đối hoặc tuyệt đối
						if (subPath.startsWith('http')) {
							bestQualityUrl = subPath;
						} else {
							baseUrl.pathname = subPath.startsWith('/')
								? subPath
								: path.posix.join(
										path.posix.dirname(baseUrl.pathname),
										subPath
									);
							bestQualityUrl = baseUrl.toString();
						}
					}
				}
			}

			if (bestQualityUrl) {
				console.log(
					`Đã tìm thấy playlist con chất lượng cao nhất: ${bestQualityUrl}`
				);
				// Thử lại với ffmpeg và URL playlist con
				return downloadM3U8UsingFFmpeg(bestQualityUrl, outputPath);
			}
		}

		// Nếu không phải master playlist hoặc không tìm thấy playlist con
		// Thử lại với ffmpeg và thêm một số tùy chọn khác
		const altCommand = `ffmpeg -protocol_whitelist file,http,https,tcp,tls,crypto -headers "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36" -i "${url}" -c copy "${outputPath}"`;

		return new Promise((resolve, reject) => {
			console.log(`Thử lại với lệnh thay thế: ${altCommand}`);
			const process = exec(altCommand);

			process.stderr?.on('data', (data) => {
				if (data.includes('time=')) {
					process.stdout.write(
						`\rĐang tải (phương pháp thay thế): ${data.toString().trim()}`
					);
				}
			});

			process.on('close', (code) => {
				if (
					code === 0 ||
					(fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0)
				) {
					process.stdout.write('\n');
					console.log(
						`Tải thành công video với phương pháp thay thế vào ${outputPath}`
					);
					resolve(outputPath);
				} else {
					reject(
						new Error(
							`Không thể tải video với phương pháp thay thế (mã lỗi: ${code})`
						)
					);
				}
			});
		});
	} catch (error) {
		console.error('Lỗi khi thử phương pháp thay thế:', error);
		throw error;
	}
}

/**
 * Phương pháp dự phòng cuối cùng để tải m3u8, thử nhiều tùy chọn SSL và User-Agent
 * @param {string} url - URL m3u8 của video cần tải
 * @param {string} outputPath - Đường dẫn lưu file video
 * @returns {Promise<string>} - Đường dẫn đến file đã tải
 */
async function tryAdvancedDownload(url, outputPath) {
	console.log(`Đang thử phương pháp nâng cao để tải m3u8 từ ${url}`);

	// Danh sách các User-Agent khác nhau để thử
	const userAgents = [
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
		'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
	];

	// Danh sách các tùy chọn SSL để thử
	const sslOptions = [
		'', // Mặc định, không thêm tùy chọn
		'-tls_verify 0', // Tắt xác minh TLS
		'-tls_verify 0 -ssl_verify_client 0', // Tắt xác minh TLS và SSL
		'-ca_file /etc/ssl/certs/ca-certificates.crt', // Chỉ định file CA
	];

	// Các tùy chọn bổ sung để thử
	const additionalOptions = [
		'', // Mặc định
		'-rw_timeout 15000000', // Tăng timeout cho đọc/ghi
		'-http_persistent 0', // Không sử dụng kết nối HTTP liên tục
		'-timeout 10000000', // Timeout tổng thể
	];

	// Tạo một chuỗi URL thay thế bằng cách xử lý các tham số
	let urlVariations = [url];

	// Thử thay đổi tham số của URL
	const urlObj = new URL(url);
	if (urlObj.searchParams.has('m3u8')) {
		const altUrl = new URL(url);
		altUrl.searchParams.delete('m3u8');
		urlVariations.push(altUrl.toString());
	}

	// Nếu URL chứa token, cố gắng giữ lại
	if (urlObj.searchParams.has('token') || url.includes('token=')) {
		// URL đã có token, giữ nguyên
	} else {
		// Nếu URL có dạng CDN, thử thêm phiên bản không cache
		if (
			url.includes('cdn') ||
			url.includes('cloudfront') ||
			url.includes('akamai')
		) {
			const altUrl = new URL(url);
			altUrl.searchParams.append('nocache', Date.now());
			urlVariations.push(altUrl.toString());
		}
	}

	// Kiểm tra xem có đuôi khác ngoài .m3u8 không
	if (!url.endsWith('.m3u8') && url.includes('m3u8')) {
		try {
			// Thử tải nội dung playlist để có URL thực
			const response = await fetch(url, {
				headers: { 'User-Agent': userAgents[0] },
			});
			if (response.ok) {
				const content = await response.text();
				// Tìm URL thực trong nội dung nếu có
				const playlistUrls = content.match(
					/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g
				);
				if (playlistUrls && playlistUrls.length > 0) {
					urlVariations = urlVariations.concat(playlistUrls);
				}
			}
		} catch (error) {
			console.error('Lỗi khi thử tải nội dung playlist:', error);
		}
	}

	// Loại bỏ trùng lặp
	urlVariations = [...new Set(urlVariations)];

	console.log(
		`Sẽ thử ${urlVariations.length} biến thể URL, ${userAgents.length} User-Agent, ${sslOptions.length} tùy chọn SSL và ${additionalOptions.length} tùy chọn bổ sung`
	);

	// Thử từng tổ hợp có thể
	for (const testUrl of urlVariations) {
		for (const userAgent of userAgents) {
			for (const sslOption of sslOptions) {
				for (const additionalOption of additionalOptions) {
					try {
						console.log(
							`Thử với URL: ${testUrl} và User-Agent: ${userAgent.substring(0, 30)}...`
						);

						const headers = `-headers "User-Agent: ${userAgent}" -headers "Referer: ${new URL(testUrl).origin}/" `;

						// Tạo lệnh ffmpeg với tùy chọn hiện tại
						const command = `ffmpeg -protocol_whitelist file,http,https,tcp,tls,crypto ${headers} ${sslOption} ${additionalOption} -i "${testUrl}" -c copy "${outputPath}"`;

						console.log(`Thử lệnh: ${command}`);

						// Thực thi lệnh
						const result = await new Promise((resolve, reject) => {
							const proc = exec(command);

							proc.stderr?.on('data', (data) => {
								// Hiển thị tiến trình
								if (data.includes('time=')) {
									process.stdout.write(
										`\rĐang tải (tùy chọn nâng cao): ${data.toString().trim()}`
									);
								}
							});

							proc.on('close', (code) => {
								if (
									code === 0 ||
									(fs.existsSync(outputPath) &&
										fs.statSync(outputPath).size > 0)
								) {
									resolve(true);
								} else {
									reject(new Error(`Mã lỗi: ${code}`));
								}
							});
						});

						if (result === true) {
							console.log(
								`Tải thành công với phương pháp nâng cao! URL: ${testUrl}`
							);
							return outputPath;
						}
					} catch (error) {
						console.log(`Thử tổ hợp thất bại: ${error.message}`);
						// Tiếp tục với tổ hợp tiếp theo
					}
				}
			}
		}
	}

	// Thử cuối cùng - sử dụng phương pháp tải chậm
	try {
		console.log('Thử phương pháp tải chậm...');
		const slowCommand = `ffmpeg -protocol_whitelist file,http,https,tcp,tls,crypto -headers "User-Agent: ${userAgents[0]}" -i "${url}" -c copy -bsf:a aac_adtstoasc -preset ultrafast "${outputPath}"`;

		await new Promise((resolve, reject) => {
			const proc = exec(slowCommand);

			proc.stderr?.on('data', (data) => {
				if (data.includes('time=')) {
					process.stdout.write(
						`\rĐang tải (phương pháp chậm): ${data.toString().trim()}`
					);
				}
			});

			proc.on('close', (code) => {
				if (
					code === 0 ||
					(fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0)
				) {
					resolve();
				} else {
					reject(new Error(`Mã lỗi: ${code}`));
				}
			});
		});

		console.log('Tải thành công với phương pháp chậm!');
		return outputPath;
	} catch (error) {
		console.error('Tất cả phương pháp đều thất bại:', error);
		throw new Error(
			'Không thể tải video sau khi thử tất cả phương pháp: ' + error.message
		);
	}
}

/**
 * Kiểm tra và cài đặt yt-dlp nếu cần
 * @returns {Promise<boolean>} - true nếu yt-dlp đã sẵn sàng, false nếu không
 */
async function ensureYtDlpInstalled() {
	if (ytDlp !== null) {
		return true;
	}

	try {
		// Kiểm tra xem yt-dlp đã được cài đặt chưa
		const checkCmd =
			process.platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp';

		return new Promise((resolve) => {
			exec(checkCmd, async (error, stdout) => {
				if (error || !stdout) {
					console.log('yt-dlp chưa được cài đặt, đang tải...');
					try {
						// Cài đặt yt-dlp-wrap
						ytDlp = new YTDlpWrap();
						// Tải yt-dlp binary
						await ytDlp.downloadFromGithub();
						console.log('Đã cài đặt yt-dlp thành công');
						resolve(true);
					} catch (installError) {
						console.error('Không thể cài đặt yt-dlp:', installError);
						resolve(false);
					}
				} else {
					console.log('yt-dlp đã được cài đặt');
					ytDlp = new YTDlpWrap();
					resolve(true);
				}
			});
		});
	} catch (error) {
		console.error('Lỗi khi kiểm tra yt-dlp:', error);
		return false;
	}
}

/**
 * Tải video m3u8 sử dụng yt-dlp (phương pháp mạnh nhất)
 * @param {string} url - URL m3u8 của video cần tải
 * @param {string} outputPath - Đường dẫn lưu file video
 * @returns {Promise<string>} - Đường dẫn đến file đã tải
 */
async function downloadWithYtDlp(url, outputPath) {
	console.log('Đang thử tải video bằng yt-dlp...');

	// Đảm bảo yt-dlp đã được cài đặt
	const ytDlpReady = await ensureYtDlpInstalled();
	if (!ytDlpReady) {
		throw new Error('Không thể cài đặt hoặc sử dụng yt-dlp');
	}

	try {
		// Thử cách 1: Sử dụng yt-dlp-wrap
		console.log('Phương pháp 1: Sử dụng yt-dlp-wrap API');

		return new Promise((resolve, reject) => {
			// Các tùy chọn cho yt-dlp
			const options = [
				// Ghi đè file đầu ra
				'-f',
				'best',
				// Tùy chọn khác
				'--no-warnings',
				'--no-check-certificate',
				'--prefer-ffmpeg',
				'-o',
				outputPath,
				url,
			];

			console.log(`Thực thi yt-dlp với tùy chọn: ${options.join(' ')}`);

			// Không sử dụng ytDlp.on vì có thể không được hỗ trợ
			// Thực thi yt-dlp
			ytDlp
				.execPromise(options)
				.then(() => {
					process.stdout.write('\n');
					console.log(
						`Tải thành công video vào ${outputPath} bằng yt-dlp-wrap`
					);
					resolve(outputPath);
				})
				.catch(async (error) => {
					console.error('Lỗi khi sử dụng yt-dlp-wrap:', error);
					// Nếu lỗi, thử phương pháp 2: Sử dụng lệnh trực tiếp
					try {
						await downloadWithYtDlpCommand(url, outputPath);
						resolve(outputPath);
					} catch (cmdError) {
						reject(cmdError);
					}
				});
		});
	} catch (error) {
		console.error('Lỗi khi tải bằng yt-dlp-wrap:', error);
		// Thử phương pháp dự phòng
		return downloadWithYtDlpCommand(url, outputPath);
	}
}

/**
 * Phương pháp dự phòng: Tải bằng lệnh yt-dlp trực tiếp
 * @param {string} url - URL video cần tải
 * @param {string} outputPath - Đường dẫn lưu file
 * @returns {Promise<string>} - Đường dẫn đến file đã tải
 */
async function downloadWithYtDlpCommand(url, outputPath) {
	console.log('Phương pháp 2: Sử dụng lệnh yt-dlp trực tiếp');

	return new Promise((resolve, reject) => {
		// Các tùy chọn cho yt-dlp
		const ytDlpCmd = `yt-dlp -f "best" --no-warnings --no-check-certificate --prefer-ffmpeg -o "${outputPath}" "${url}"`;
		console.log(`Thực thi lệnh: ${ytDlpCmd}`);

		const process = exec(ytDlpCmd);

		process.stdout?.on('data', (data) => {
			// Hiển thị tiến trình từ stdout
			if (data.includes('%')) {
				process.stdout.write(`\r${data.toString().trim()}`);
			} else {
				console.log(`yt-dlp: ${data}`);
			}
		});

		process.stderr?.on('data', (data) => {
			// Xem stderr để tìm lỗi
			console.error(`yt-dlp error: ${data}`);
		});

		process.on('close', (code) => {
			if (
				code === 0 ||
				(fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0)
			) {
				process.stdout.write('\n');
				console.log(`Tải thành công video vào ${outputPath} bằng lệnh yt-dlp`);
				resolve(outputPath);
			} else {
				// Nếu không tìm thấy file với tên chính xác, tìm file tương tự
				const dir = path.dirname(outputPath);
				const files = fs.readdirSync(dir);
				const filename = path.basename(outputPath);
				const similarFiles = files.filter(
					(f) =>
						f.startsWith(filename.slice(0, 8)) &&
						(f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'))
				);

				if (similarFiles.length > 0) {
					// Nếu tìm thấy file tương tự, di chuyển file đó sang tên mong muốn
					const similarFile = path.join(dir, similarFiles[0]);
					fs.copyFileSync(similarFile, outputPath);
					console.log(
						`Đã tìm thấy file tương tự: ${similarFiles[0]}, sao chép thành ${path.basename(outputPath)}`
					);
					resolve(outputPath);
				} else {
					// Thử cách khác: sử dụng lệnh CURL
					console.log('Thử tải bằng curl...');
					const curlCmd = `curl -L -o "${outputPath}" --referer "${new URL(url).origin}" "${url}"`;
					exec(curlCmd, (curlError, curlStdout, curlStderr) => {
						if (
							curlError ||
							!fs.existsSync(outputPath) ||
							fs.statSync(outputPath).size === 0
						) {
							reject(
								new Error(
									`yt-dlp và curl đều không tải được video (mã lỗi yt-dlp: ${code})`
								)
							);
						} else {
							console.log(`Tải thành công video vào ${outputPath} bằng curl`);
							resolve(outputPath);
						}
					});
				}
			}
		});
	});
}

/**
 * Tải video từ URL với timeout và retry
 * @param {string} url - URL của video cần tải
 * @param {string} fileName - Tên file để lưu
 * @param {number} maxRetries - Số lần thử lại tối đa
 * @returns {Promise<string>} - Đường dẫn đến file đã tải
 */
async function downloadVideo(url, fileName, maxRetries = 3) {
	let retries = 0;

	while (retries < maxRetries) {
		try {
			await fs.ensureDir(config.uploadPath);

			// Luôn sử dụng tên file an toàn, bỏ qua tham số fileName
			const safeFileName = generateSafeFileName(url);
			const filePath = path.join(config.uploadPath, safeFileName);

			// Kiểm tra nếu là URL m3u8 thì sử dụng phương thức tải m3u8
			if (isM3U8Url(url)) {
				// Bọc với timeout dài hơn - sử dụng cú pháp đúng cho p-timeout 4.1.0
				return await pTimeout(
					downloadM3U8Video(url, filePath),
					PROMISE_TIMEOUT,
					`Quá thời gian (${PROMISE_TIMEOUT / 1000} giây) khi tải video m3u8`
				);
			}

			console.log(`Đang tải video từ ${url} vào ${filePath}`);

			// Tùy chọn không giới hạn thời gian timeout
			const options = {
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
				},
			};

			const response = await pTimeout(
				fetch(url, options),
				PROMISE_TIMEOUT,
				`Quá thời gian (${PROMISE_TIMEOUT / 1000} giây) khi fetch video URL`
			);

			if (!response.ok) {
				throw new Error(`Failed to download video: ${response.statusText}`);
			}

			// Kiểm tra xem có phải là video không
			const contentType = response.headers.get('content-type');
			console.log(`Content-Type: ${contentType}`);

			if (
				contentType &&
				!contentType.includes('video') &&
				!contentType.includes('octet-stream')
			) {
				console.warn(
					`Cảnh báo: URL có thể không phải là video. Content-Type: ${contentType}`
				);
			}

			// Lấy kích thước file
			const contentLength = response.headers.get('content-length');
			const totalSize = contentLength
				? parseInt(contentLength, 10)
				: 'không xác định';
			console.log(`Kích thước file: ${totalSize} bytes`);

			// Tạo stream để ghi file
			const fileStream = fs.createWriteStream(filePath);

			let downloadedBytes = 0;

			// Theo dõi tiến trình tải
			response.body.on('data', (chunk) => {
				downloadedBytes += chunk.length;
				if (contentLength) {
					const progress = Math.round((downloadedBytes / totalSize) * 100);
					process.stdout.write(`\rĐã tải: ${progress}%`);
				}
			});

			// Pipe response vào file
			const streamPromise = new Promise((resolve, reject) => {
				response.body.pipe(fileStream);
				response.body.on('error', (error) => {
					console.error(`Lỗi khi tải: ${error.message}`);
					reject(error);
				});
				fileStream.on('finish', () => {
					process.stdout.write('\n');
					console.log(`Tải thành công video vào ${filePath}`);
					resolve();
				});
				fileStream.on('error', (error) => {
					console.error(`Lỗi khi ghi file: ${error.message}`);
					reject(error);
				});
			});

			// Thêm timeout cho quá trình pipe stream - sử dụng cú pháp đúng cho p-timeout 4.1.0
			await pTimeout(
				streamPromise,
				PROMISE_TIMEOUT,
				`Quá thời gian (${PROMISE_TIMEOUT / 1000} giây) khi lưu file video`
			);

			// Kiểm tra kích thước file
			const stats = await fs.stat(filePath);
			console.log(`Kích thước file đã tải: ${stats.size} bytes`);

			if (stats.size === 0) {
				throw new Error('File tải về có kích thước 0 bytes');
			}

			return filePath;
		} catch (error) {
			console.error(
				`Lần thử ${retries + 1}/${maxRetries} thất bại: ${error.message}`
			);
			retries++;

			if (retries >= maxRetries) {
				console.error('Đã vượt quá số lần thử lại tối đa');
				throw error;
			}

			// Chờ trước khi thử lại
			await new Promise((resolve) => setTimeout(resolve, 2000 * retries));
		}
	}
}

module.exports = {
	downloadVideo,
	isM3U8Url,
};
