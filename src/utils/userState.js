/**
 * Quản lý trạng thái người dùng
 */

// Thiết lập trạng thái người dùng
const userStates = {};

/**
 * Lấy trạng thái hiện tại của người dùng
 * @param {number} userId - ID người dùng
 * @returns {object} - Trạng thái người dùng
 */
function getUserState(userId) {
	if (!userStates[userId]) {
		userStates[userId] = { state: 'idle' };
	}
	return userStates[userId];
}

/**
 * Cập nhật trạng thái người dùng
 * @param {number} userId - ID người dùng
 * @param {string} state - Trạng thái mới
 * @param {object} data - Dữ liệu bổ sung
 */
function updateUserState(userId, state, data = {}) {
	const currentState = getUserState(userId);
	userStates[userId] = {
		...currentState,
		state,
		...data,
	};
}

/**
 * Đặt lại trạng thái người dùng về mặc định
 * @param {number} userId - ID người dùng
 */
function resetUserState(userId) {
	userStates[userId] = { state: 'idle' };
}

/**
 * Xóa dữ liệu cụ thể của người dùng
 * @param {number} userId - ID người dùng
 * @param {string[]} keys - Các khóa cần xóa
 */
function clearUserData(userId, keys) {
	const state = getUserState(userId);
	keys.forEach((key) => {
		delete state[key];
	});
}

module.exports = {
	getUserState,
	updateUserState,
	resetUserState,
	clearUserData,
};
