const { OpenAI } = require('openai'); // Importando corretamente a biblioteca OpenAI
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
const { Client, LocalAuth } = require('whatsapp-web.js');
const sqlite3 = require('sqlite3').verbose();  // Biblioteca para trabalhar com SQLite
const path = require('path');

// Carregar variáveis de ambiente
dotenv.config();

// Inicializa a API OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Inicializa o cliente do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth()
});

// Conecta ao banco de dados SQLite
const dbPath = path.resolve(__dirname, 'conversations.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
        db.run(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT,
                user_message TEXT,
                bot_reply TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
});

// Gera o QR Code
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code above with your WhatsApp mobile app.');
});

// Cliente pronto
client.on('ready', () => {
    console.log('Client is ready!');
});

// Detecta e responde a mensagens
client.on('message', async (message) => {
    // Verifica se a mensagem é de um grupo
    if (message.from.includes('@g.us')) {
        const prompt = `User: ${message.body}\nAI:`;
        try {
            const response = await openai.chat.completions.create({
                model: 'ft:gpt-4o-mini-2024-07-18:personal:helovox:AESbXANZ',
                messages: [{ role: 'user', content: message.body }],
                max_tokens: 200,
                temperature: 0.7
            });
            const reply = response.choices[0].message.content.trim();
            
            // Envia a resposta para o grupo
            await client.sendMessage(message.from, reply);
            console.log(`Sent reply in group: ${reply}`);

            // Salva a conversa no banco de dados
            const insertQuery = `INSERT INTO conversations (group_id, user_message, bot_reply) VALUES (?, ?, ?)`;
            db.run(insertQuery, [message.from, message.body, reply], (err) => {
                if (err) {
                    console.error('Erro ao salvar conversa no banco de dados:', err.message);
                } else {
                    console.log('Conversa salva com sucesso.');
                }
            });
        } catch (error) {
            console.error('Error communicating with OpenAI:', error);
        }
    } else {
        console.log('Ignoring private message');
    }
});

// Inicializa o cliente
client.initialize();
