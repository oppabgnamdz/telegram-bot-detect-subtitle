const mongoose = require('mongoose');
const config = require('../config');

// Kết nối đến MongoDB
const connectDB = async () => {
	try {
		await mongoose.connect(config.mongodbUri);
		console.log('Kết nối MongoDB thành công');
	} catch (error) {
		console.error('Lỗi kết nối MongoDB:', error.message);
		process.exit(1);
	}
};

module.exports = { connectDB };
