/**
 * Các hằng số được sử dụng trong ứng dụng
 */

// Các prompt mặc định cho các trường hợp khác nhau
const DEFAULT_PROMPTS = {
	normal:
		'Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên',
	movie:
		'Dịch phụ đề phim sang tiếng Việt, giữ nguyên nghĩa gốc, phong cách từng nhân vật và các thuật ngữ đặc biệt nếu có',
	anime:
		'Dịch phụ đề anime sang tiếng Việt, giữ nguyên các thuật ngữ anime/manga, tên chiêu thức, tên riêng và các từ Nhật đặc trưng',
	conversation:
		'Dịch phụ đề sang tiếng Việt với phong cách hội thoại tự nhiên, phù hợp với cách nói chuyện hàng ngày',
	adult:
		'Dịch phụ đề sang tiếng Việt, giữ nguyên nghĩa gốc và sử dụng ngôn ngữ tự nhiên, phù hợp với các từ ngữ nhạy cảm, bậy bạ, thô tục',
};

module.exports = {
	DEFAULT_PROMPTS,
};
