const User = require('../models/User');

/**
 * Kiểm tra quyền người dùng
 * @param {object} ctx - Context của Telegraf
 * @returns {Promise<boolean>} - Trả về true nếu người dùng có quyền sử dụng lệnh
 */
const checkUserPermission = async (ctx) => {
	try {
		const telegramId = ctx.from.id.toString();
		const currentDate = new Date();
		currentDate.setHours(0, 0, 0, 0); // Đặt về 00:00:00 của ngày hiện tại

		// Tìm người dùng hoặc tạo mới nếu chưa tồn tại
		let user = await User.findOne({ telegramId });

		if (!user) {
			user = new User({
				telegramId,
				username: ctx.from.username,
				firstName: ctx.from.first_name,
				lastName: ctx.from.last_name,
				role: 'default',
				commandsUsed: 0,
				lastCommandDate: null,
			});
		}

		// Nếu là admin, luôn cho phép
		if (user.role === 'admin') {
			return true;
		}

		// Kiểm tra người dùng đã sử dụng lệnh trong ngày hôm nay chưa
		const lastCommandDate = user.lastCommandDate;

		// Nếu chưa sử dụng lệnh hôm nay hoặc chưa từng sử dụng lệnh
		if (
			!lastCommandDate ||
			new Date(lastCommandDate).setHours(0, 0, 0, 0) < currentDate.getTime()
		) {
			user.commandsUsed = 1;
			user.lastCommandDate = new Date();
			await user.save();
			return true;
		}

		// Kiểm tra số lệnh đã sử dụng trong ngày
		if (user.commandsUsed < 1) {
			user.commandsUsed += 1;
			await user.save();
			return true;
		}

		return false;
	} catch (error) {
		console.error('Lỗi kiểm tra quyền người dùng:', error);
		return false;
	}
};

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
 * Đếm lệnh người dùng đã sử dụng
 * @param {object} ctx - Context của Telegraf
 */
const incrementUserCommand = async (ctx) => {
	try {
		const telegramId = ctx.from.id.toString();

		const user = await User.findOne({ telegramId });
		if (user && user.role !== 'admin') {
			user.commandsUsed += 1;
			user.lastCommandDate = new Date();
			await user.save();
		}
	} catch (error) {
		console.error('Lỗi đếm lệnh người dùng:', error);
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
	updateUserInfo,
	incrementUserCommand,
	setUserAsAdmin,
};
