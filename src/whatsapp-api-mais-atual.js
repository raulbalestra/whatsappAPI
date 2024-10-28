const { exec } = require('child_process');
const { OpenAI } = require('openai');
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { MongoClient } = require('mongodb');
const fs = require('fs');
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

// Conectar ao MongoDB
const uri = process.env.MONGODB_URI;
let db;

MongoClient.connect(uri, { useUnifiedTopology: true })
    .then(clientDB => {
        console.log("Conectado ao MongoDB com sucesso!");
        db = clientDB.db(); // Definir o banco de dados

        // Inicializa o cliente do WhatsApp após a conexão com o banco de dados
        client.initialize();
    })
    .catch(err => {
        console.error("Erro ao conectar ao MongoDB:", err.message);
        process.exit(1); // Encerra o processo em caso de falha de conexão com o banco de dados
    });

// Evento para gerar o QR Code e inicializar o WhatsApp
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Escaneie o QR code com o seu WhatsApp.');
});

// Evento para confirmar que o cliente do WhatsApp está pronto
client.on('ready', () => {
    console.log('Helovox está pronta para facilitar sua vida!');
});

// Função para salvar uma conversa no MongoDB
function saveConversation(chatId, userName, message, mediaType, botReply = null) {
    const collection = db.collection('conversations');
    collection.insertOne({
        chat_id: chatId,
        user_name: userName,
        user_message: message,
        media_type: mediaType,
        bot_reply: botReply,
        timestamp: new Date()
    })
    .then(() => console.log('Conversa salva com sucesso no MongoDB.'))
    .catch(err => console.error('Erro ao salvar conversa no MongoDB:', err.message));
}

// Função para identificar se a mensagem é de um grupo ou privada
function isGroupMessage(message) {
    return message.from.endsWith('@g.us');
}

// Função que trata o recebimento e processamento de mensagens no WhatsApp
client.on('message', async (message) => {
    const isGroup = isGroupMessage(message);
    const chatId = message.from;

    // Verifica se a mensagem contém uma imagem
    if (message.hasMedia && message.type === 'image') {
        const media = await message.downloadMedia();
        const tempImageDir = path.join(__dirname, 'temp_images');

        if (!fs.existsSync(tempImageDir)) {
            fs.mkdirSync(tempImageDir);
        }

        const imagePath = path.join(tempImageDir, 'image.jpg');
        fs.writeFileSync(imagePath, Buffer.from(media.data, 'base64'));

        try {
            const imageDescription = await processImage(imagePath);
            await client.sendMessage(chatId, imageDescription);
            saveConversation(chatId, message.author || message.from, "Imagem enviada", "image", imageDescription);
        } catch (error) {
            console.error('Erro ao descrever a imagem:', error);
            await client.sendMessage(chatId, 'Erro ao descrever a imagem.');
        }
    }

    // Verifica se a mensagem contém um áudio
    else if (message.hasMedia && message.type === 'ptt') {
        const media = await message.downloadMedia();
        const tempAudioDir = path.join(__dirname, 'temp_audio');

        if (!fs.existsSync(tempAudioDir)) {
            fs.mkdirSync(tempAudioDir);
        }

        const inputFilePath = path.join(tempAudioDir, 'audio.ogg');
        fs.writeFileSync(inputFilePath, Buffer.from(media.data, 'base64'));

        try {
            const transcription = await transcribeAudio(inputFilePath);
            const gptResponse = await generateChatGPTResponse(chatId, transcription);
            await client.sendMessage(chatId, gptResponse);
            saveConversation(chatId, message.author || message.from, transcription, "audio", gptResponse);
        } catch (error) {
            console.error('Erro ao transcrever o áudio:', error);
            await client.sendMessage(chatId, `Erro ao processar o áudio: ${error.message}`);
        }
    }

    // Verifica se é uma mensagem de grupo e se "Helovox" foi mencionada
    else if (isGroup && message.body.toLowerCase().includes('helovox')) {
        try {
            const userMessage = message.body;
            const gptResponse = await generateChatGPTResponse(chatId, userMessage);
            await client.sendMessage(chatId, gptResponse);
            saveConversation(chatId, message.author || message.from, userMessage, "text", gptResponse);
        } catch (error) {
            console.error('Erro ao processar a mensagem:', error);
            await client.sendMessage(chatId, 'Erro ao processar a mensagem.');
        }
    }

    // Se for uma conversa privada, responde automaticamente
    else if (!isGroup) {
        try {
            const userMessage = message.body;
            const gptResponse = await generateChatGPTResponse(chatId, userMessage);
            await client.sendMessage(chatId, gptResponse);
            saveConversation(chatId, message.author || message.from, userMessage, "text", gptResponse);
        } catch (error) {
            console.error('Erro ao processar a mensagem:', error);
            await client.sendMessage(chatId, 'Erro ao processar a mensagem.');
        }
    }

    // Salva todas as mensagens no banco de dados para contexto, independentemente de menção ou grupo
    else {
        saveConversation(chatId, message.author || message.from, message.body, "text");
        console.log('Mensagem armazenada no banco de dados.');
    }
});

// Função que gera a resposta do ChatGPT com base na transcrição, no histórico e na descrição da imagem, se existir
async function generateChatGPTResponse(chatId, userMessage) {
    const relevantConversations = await retrieveRelevantConversations(chatId, userMessage);
    const existingImageDescription = await getImageDescription(chatId);

    let prompt;
    if (existingImageDescription) {
        prompt = `Você é Helovox, uma assistente virtual super gentil, profissional, e inteligente, criada por Raul Balestra e Higor Felipe. A última imagem descrita neste chat é: "${existingImageDescription}". Baseado nisso, responda ao seguinte texto: "${userMessage}".`;
    } else if (relevantConversations) {
        prompt = `Você é Helovox, uma assistente virtual super gentil, profissional, e inteligente, criada por Raul Balestra e Higor Felipe. As últimas interações relevantes neste contexto foram:\n${relevantConversations}\nBaseado nisso, responda ao seguinte texto: "${userMessage}".`;
    } else {
        prompt = `Você é Helovox, uma assistente virtual super gentil, profissional, e inteligente, criada por Raul Balestra e Higor Felipe. Não tenho informações anteriores sobre este contexto específico. Responda ao seguinte texto: "${userMessage}" da melhor forma possível.`;
    }

    const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
            {
                role: 'user',
                content: prompt
            }
        ],
        max_tokens: 3000,
        temperature: 0.5
    });

    return response.choices[0].message.content.trim();
}

// Função para recuperar conversas relevantes usando RAG
async function retrieveRelevantConversations(chatId, userMessage) {
    const collection = db.collection('conversations');
    const results = await collection.find({ chat_id: chatId }).sort({ timestamp: -1 }).limit(10).toArray();

    if (results.length > 0) {
        return results.map((conv) => `Usuário: ${conv.user_name} disse: "${conv.user_message}"`).join('\n');
    } else {
        return null;
    }
}

// Função para buscar a descrição da última imagem enviada no chat
async function getImageDescription(chatId) {
    const collection = db.collection('conversations');
    const result = await collection.findOne({ chat_id: chatId, media_type: "image" }, { sort: { timestamp: -1 } });

    if (result) {
        return result.bot_reply; // Retorna a descrição da imagem armazenada
    } else {
        return null;
    }
}

// Função para codificar a imagem em base64
function encodeImage(imagePath) {
    const image = fs.readFileSync(imagePath);
    return image.toString('base64');
}

// Função para processar uma imagem usando GPT-4 Vision
async function processImage(imagePath) {
    try {
        const base64Image = encodeImage(imagePath);

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            "type": "text",
                            "text": "Descreva a imagem a seguir de maneira detalhada."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": `data:image/jpeg;base64,${base64Image}`,
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            max_tokens: 300
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('Erro ao processar a imagem:', error);
        throw new Error('Erro ao processar a imagem.');
    }
}

// Função para converter o áudio para mp3 com ffmpeg
function convertAudioToMp3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        exec(`ffmpeg -y -i ${inputPath} -acodec libmp3lame ${outputPath}`, (error) => {
            if (error) {
                console.error(`Erro ao converter áudio: ${error.message}`);
                reject(error);
            } else {
                console.log(`Áudio convertido com sucesso: ${outputPath}`);
                resolve(outputPath);
            }
        });
    });
}

// Função para transcrever áudio usando a API Whisper
async function transcribeAudio(inputFilePath) {
    const outputFilePath = path.join(__dirname, 'temp_audio', 'audio.mp3');
    await convertAudioToMp3(inputFilePath, outputFilePath);

    const response = await openai.audio.transcriptions.create({
        file: fs.createReadStream(outputFilePath),
        model: 'whisper-1'
    });

    fs.unlinkSync(inputFilePath);
    fs.unlinkSync(outputFilePath);

    return response.text;
}
