const mongoose = require('mongoose');

// Định nghĩa schema cho User
const userSchema = new mongoose.Schema({
	telegramId: {
		type: String,
		required: true,
		unique: true,
	},
	username: {
		type: String,
	},
	firstName: {
		type: String,
	},
	lastName: {
		type: String,
	},
	role: {
		type: String,
		enum: ['default', 'admin'],
		default: 'default',
	},
	commandsUsed: {
		type: Number,
		default: 0,
	},
	lastCommandDate: {
		type: Date,
		default: null,
	},
	createdAt: {
		type: Date,
		default: Date.now,
	},
});

// Tạo model từ schema
const User = mongoose.model('User', userSchema);

module.exports = User;
