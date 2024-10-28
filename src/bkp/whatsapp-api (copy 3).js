const { OpenAI } = require('openai'); // Importando corretamente a biblioteca OpenAI
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const sqlite3 = require('sqlite3').verbose();  // Biblioteca para trabalhar com SQLite
const path = require('path');
const fs = require('fs');

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

let lastImage = null; // Armazena a última imagem recebida

// Gera o QR Code
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code above with your WhatsApp mobile app.');
});

// Cliente pronto
client.on('ready', () => {
    console.log('Client is ready!');
});

// Função para processar imagem com GPT-4o Vision
async function processImageWithGPT4o(base64Image) {
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",  // Modelo que suporta visão
        messages: [
            {
                role: "user",
                content: [
                    {
                        "type": "text",
                        "text": "O que há nesta imagem?"
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": `data:image/jpeg;base64,${base64Image}`
                        }
                    }
                ]
            }
        ],
        max_tokens: 300
    });

    return response.choices[0].message.content; // Retorna a descrição gerada pelo GPT-4o
}

// Função para gerar uma resposta mais elaborada e inteligente
async function generateDetailedResponse(userMessage) {
    const prompt = `Com base na mensagem a seguir: "${userMessage}", forneça uma resposta detalhada e intelectual, incluindo contexto, análise, e estimativas baseadas em informações relevantes. Se possível, forneça cenários otimistas e conservadores, sempre explicando os fatores de risco e oportunidades.`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',  // Usando um modelo GPT-4o mais detalhado
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,  // Permite uma resposta mais longa e detalhada
        temperature: 0.3   // Temperatura baixa para garantir uma resposta precisa e focada
    });
    return response.choices[0].message.content.trim();
}

// Detecta e responde a mensagens
client.on('message', async (message) => {
    if (message.hasMedia && message.type === 'image') {
        const media = await message.downloadMedia();
        lastImage = media; // Armazena a imagem recebida
        await client.sendMessage(message.from, 'Imagem recebida. Digite "descrever" para obter a descrição.');
    } else if (message.body.toLowerCase() === 'descrever' && lastImage) {
        try {
            // Converte a imagem para base64
            const base64Image = lastImage.data;

            // Processa a imagem com GPT-4o Vision
            const imageDetails = await processImageWithGPT4o(base64Image);

            // Envia a descrição para o usuário
            await client.sendMessage(message.from, imageDetails);

            // Salva a conversa no banco de dados
            const insertQuery = `INSERT INTO conversations (group_id, user_message, bot_reply) VALUES (?, ?, ?)`;
            db.run(insertQuery, [message.from, "descrever", imageDetails], (err) => {
                if (err) {
                    console.error('Erro ao salvar conversa no banco de dados:', err.message);
                } else {
                    console.log('Conversa salva com sucesso.');
                }
            });

            lastImage = null; // Limpa a imagem após o processamento
        } catch (error) {
            console.error('Erro ao processar a imagem:', error);
            await client.sendMessage(message.from, 'Erro ao processar a imagem.');
        }
    } else if (message.body.toLowerCase().includes('helovox')) { // Verifica se a mensagem contém "Helovox"
        // Se for uma chamada à Helovox, gerar uma resposta mais elaborada
        const detailedResponse = await generateDetailedResponse(message.body);

        // Envia a resposta detalhada para o grupo
        await client.sendMessage(message.from, detailedResponse);
        console.log(`Sent detailed reply: ${detailedResponse}`);

        // Salva a conversa no banco de dados
        const insertQuery = `INSERT INTO conversations (group_id, user_message, bot_reply) VALUES (?, ?, ?)`;
        db.run(insertQuery, [message.from, message.body, detailedResponse], (err) => {
            if (err) {
                console.error('Erro ao salvar conversa no banco de dados:', err.message);
            } else {
                console.log('Conversa salva com sucesso.');
            }
        });
    } else {
        console.log('Ignoring message as it does not contain "Helovox"');
    }
});

// Inicializa o cliente
client.initialize();

