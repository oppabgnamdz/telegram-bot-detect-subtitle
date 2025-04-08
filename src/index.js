/**
 * Bot Tự Động Tạo Phụ Đề - Main File
 */

const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const config = require('./config');

// Import các handlers
const commandHandlers = require('./handlers/commandHandlers');
const actionHandlers = require('./handlers/actionHandlers');
const fileHandlers = require('./handlers/fileHandlers');
const messageHandlers = require('./handlers/messageHandlers');

// Import dịch vụ xử lý phụ đề
const { checkWhisperInstallation } = require('./services/subtitleProcessor');

// Kiểm tra cấu hình
if (!config.telegramToken) {
    console.error(
        'Lỗi: Token Telegram bot không được cấu hình. Vui lòng thêm TELEGRAM_BOT_TOKEN vào file .env.'
    );
    process.exit(1);
}

if (!config.openaiApiKey) {
    console.error(
        'Lỗi: OpenAI API key không được cấu hình. Vui lòng thêm OPENAI_API_KEY vào file .env.'
    );
    process.exit(1);
}

// Khởi tạo bot
const bot = new Telegraf(config.telegramToken);

// Tạo thư mục uploads nếu chưa tồn tại
fs.ensureDirSync(config.uploadPath);

// Xử lý lỗi
bot.catch((err, ctx) => {
    console.error('Bot error:', err);

    // Chỉ ghi log lỗi, không gửi thông báo lên Telegram
    if (err.message.includes('timeout')) {
        console.error(
            'Quá trình xử lý mất quá nhiều thời gian. Video có thể quá dài.'
        );
    } else if (err.message.includes('whisper')) {
        console.error('Không thể trích xuất phụ đề:', err.message);
    } else if (err.message.includes('download')) {
        console.error('Không thể tải video từ URL đã cung cấp.');
    } else {
        console.error('Lỗi không xác định:', err.message);
    }
});

// Các lệnh cơ bản
bot.start(commandHandlers.handleStartCommand);
bot.help(commandHandlers.handleHelpCommand);

// Xử lý các action
bot.action('start', commandHandlers.handleStartAction);
bot.action('help', commandHandlers.handleHelpAction);
bot.action('create_subtitle', actionHandlers.handleCreateSubtitleAction);
bot.action('cancel_subtitle', actionHandlers.handleCancelSubtitleAction);
bot.action('default_prompt', actionHandlers.handleDefaultPromptAction);
bot.action('output_option_1', actionHandlers.handleOutputOption1Action);
bot.action('output_option_2', actionHandlers.handleOutputOption2Action);
bot.action('output_option_3', actionHandlers.handleOutputOption3Action);

// Xử lý tin nhắn văn bản
bot.on('text', messageHandlers.handleTextMessage);

// Xử lý file được gửi đến
bot.on(['document', 'video'], fileHandlers.handleFileUpload);

// Khởi động bot
async function startBot() {
    try {
        // Kiểm tra cài đặt trước khi khởi động
        await checkWhisperInstallation();

        await bot.launch();
        console.log('Bot đã khởi động thành công!');
        console.log(`Sử dụng model Whisper: ${config.whisperModel}`);
    } catch (err) {
        console.error('Không thể khởi động bot:', err);
    }
}

startBot();

// Xử lý tắt bot một cách an toàn
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 