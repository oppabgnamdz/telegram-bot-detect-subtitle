const User = require('../models/User');

/**
 * Kiểm tra quyền truy cập của user
 * @param {object} ctx - Context Telegraf
 * @returns {Promise<boolean>} - true nếu user có quyền truy cập
 */
async function checkUserPermission(ctx) {
	const userId = ctx.from.id;
	const user = await User.findOne({ telegramId: userId.toString() });

	if (!user) {
		return false;
	}

	// Reset số lệnh đã dùng nếu là ngày mới
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	// Nếu chưa có lastCommandDate hoặc là ngày mới
	if (!user.lastCommandDate || user.lastCommandDate < today) {
		user.commandsUsed = 0;
		user.lastCommandDate = today;
		await user.save();
	}

	// Kiểm tra giới hạn số lệnh
	const MAX_COMMANDS_PER_DAY = 5; // Giới hạn 5 lệnh/ngày cho user default
	return user.commandsUsed < MAX_COMMANDS_PER_DAY;
}

/**
 * Kiểm tra xem user có phải là admin không
 * @param {object} ctx - Context Telegraf
 * @returns {Promise<boolean>} - true nếu user là admin
 */
async function isAdmin(ctx) {
	const userId = ctx.from.id;
	const user = await User.findOne({ telegramId: userId.toString() });
	return user && user.role === 'admin';
}

/**
 * Tăng số lệnh đã dùng của user
 * @param {object} ctx - Context Telegraf
 */
async function incrementUserCommand(ctx) {
	const userId = ctx.from.id;
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	// Sử dụng findOneAndUpdate để cập nhật đồng bộ
	await User.findOneAndUpdate(
		{
			telegramId: userId.toString(),
			$or: [{ lastCommandDate: { $lt: today } }, { lastCommandDate: null }],
		},
		{
			$set: {
				commandsUsed: 1,
				lastCommandDate: today,
			},
		},
		{ new: true }
	);

	// Nếu không phải ngày mới, tăng số lệnh đã dùng
	await User.findOneAndUpdate(
		{
			telegramId: userId.toString(),
			lastCommandDate: { $gte: today },
		},
		{ $inc: { commandsUsed: 1 } },
		{ new: true }
	);
}

/**
 * Cập nhật thông tin người dùng
 * @param {object} ctx - Context của Telegraf
 */
const updateUserInfo = async (ctx) => {
	try {
		const telegramId = ctx.from.id.toString();

		// Tìm người dùng hoặc tạo mới nếu chưa tồn tại
		await User.findOneAndUpdate(
			{ telegramId },
			{
				username: ctx.from.username,
				firstName: ctx.from.first_name,
				lastName: ctx.from.last_name,
			},
			{ upsert: true, new: true }
		);
	} catch (error) {
		console.error('Lỗi cập nhật thông tin người dùng:', error);
	}
};

/**
 * Thiết lập người dùng thành admin
 * @param {string} telegramId - ID Telegram của người dùng
 * @returns {Promise<boolean>} - Trả về true nếu thành công
 */
const setUserAsAdmin = async (telegramId) => {
	try {
		const result = await User.findOneAndUpdate(
			{ telegramId },
			{ role: 'admin' },
			{ new: true }
		);

		return !!result;
	} catch (error) {
		console.error('Lỗi khi thiết lập người dùng thành admin:', error);
		return false;
	}
};

module.exports = {
	checkUserPermission,
	isAdmin,
	incrementUserCommand,
	updateUserInfo,
	setUserAsAdmin,
};
