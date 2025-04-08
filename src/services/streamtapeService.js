const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const config = require('../config');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');

/**
 * Nén video để giảm kích thước
 * @param {string} inputPath - Đường dẫn đến file video gốc
 * @returns {Promise<string>} - Đường dẫn đến file video đã nén
 */
async function compressVideo(inputPath) {
	const outputPath = inputPath.replace(/\.[^/.]+$/, '') + '_compressed.mp4';

	// Sử dụng ffmpeg để nén video với chất lượng thấp hơn
	const command = `ffmpeg -i "${inputPath}" -c:v libx264 -crf 28 -preset medium -c:a aac -b:a 128k "${outputPath}"`;

	try {
		await execPromise(command);
		return outputPath;
	} catch (error) {
		console.error('Lỗi khi nén video:', error);
		throw new Error('Không thể nén video: ' + error.message);
	}
}

/**
 * Lấy URL upload từ Streamtape API
 * @returns {Promise<string>} - URL để upload file
 */
async function getUploadUrl() {
	try {
		const response = await axios.get('https://api.streamtape.com/file/ul', {
			params: {
				login: process.env.STREAMTAPE_LOGIN,
				key: process.env.STREAMTAPE_KEY,
			},
		});

		if (response.data.status === 200) {
			return response.data.result.url;
		} else {
			throw new Error(`Không thể lấy URL upload: ${response.data.msg}`);
		}
	} catch (error) {
		console.error('Lỗi khi lấy URL upload:', error);
		throw error;
	}
}

/**
 * Upload video lên Streamtape
 * @param {string} videoPath - Đường dẫn đến file video
 * @returns {Promise<string>} - URL của video trên Streamtape
 */
async function uploadToStreamtape(videoPath) {
	let finalVideoPath = videoPath;
	try {
		// Kiểm tra kích thước file
		const stats = fs.statSync(videoPath);
		const fileSizeInMB = stats.size / (1024 * 1024);

		// Nếu file lớn hơn 100MB, thử nén trước
		if (fileSizeInMB > 100) {
			console.log(`File quá lớn (${fileSizeInMB.toFixed(2)}MB), đang nén...`);
			finalVideoPath = await compressVideo(videoPath);
			console.log(
				`Đã nén video thành công, kích thước mới: ${(fs.statSync(finalVideoPath).size / (1024 * 1024)).toFixed(2)}MB`
			);
		}

		// Bước 1: Lấy URL upload từ Streamtape API
		const uploadUrl = await getUploadUrl();
		console.log('Đã lấy URL upload:', uploadUrl);

		// Bước 2: Upload file lên URL đã lấy được
		const formData = new FormData();
		formData.append('file1', fs.createReadStream(finalVideoPath));

		// Upload file lên URL đã lấy được
		const response = await axios.post(uploadUrl, formData, {
			headers: {
				...formData.getHeaders(),
			},
			// Tăng timeout cho upload file lớn
			timeout: 300000, // 5 phút
		});

		// Kiểm tra kết quả upload
		if (response.data && response.data.status === 200) {
			// Lấy URL của video từ response
			const videoUrl = `${response.data.result.url}`;

			// Xóa file đã nén nếu có
			if (finalVideoPath !== videoPath && fs.existsSync(finalVideoPath)) {
				fs.unlinkSync(finalVideoPath);
			}

			return videoUrl;
		} else {
			throw new Error(
				`Upload failed: ${response.data ? response.data.msg : 'Unknown error'}`
			);
		}
	} catch (error) {
		console.error('Error uploading to Streamtape:', error);

		// Xóa file đã nén nếu có
		if (finalVideoPath !== videoPath && fs.existsSync(finalVideoPath)) {
			try {
				fs.unlinkSync(finalVideoPath);
				console.log('Đã xóa file nén do lỗi upload:', finalVideoPath);
			} catch (unlinkError) {
				console.error('Lỗi khi xóa file nén:', unlinkError);
			}
		}

		// Xử lý lỗi 413 (Request Entity Too Large)
		if (error.response && error.response.status === 413) {
			throw new Error(
				'Video quá lớn để upload lên Streamtape. Vui lòng thử lại với video nhỏ hơn hoặc sử dụng tùy chọn xuất file phụ đề.'
			);
		}

		throw error;
	}
}

module.exports = {
	uploadToStreamtape,
};
