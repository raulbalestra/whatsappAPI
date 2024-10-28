const { exec } = require('child_process');
const { OpenAI } = require('openai');
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const base64 = require('base64-js');

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
    .then(client => {
        console.log("Conectado ao MongoDB com sucesso!");
        db = client.db(); // Definir o banco de dados
    })
    .catch(err => {
        console.error("Erro ao conectar ao MongoDB:", err.message);
    });

let lastImage = null; // Armazena a última imagem recebida

// Gera o QR Code
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Escaneie o QR code com o seu WhatsApp.');
});

// Cliente pronto
client.on('ready', () => {
    console.log('Helovox está pronta para facilitar sua vida!');
});

// Função para salvar uma conversa no MongoDB
function saveConversation(groupId, userName, message, botReply = null) {
    const collection = db.collection('conversations');
    collection.insertOne({
        group_id: groupId,
        user_name: userName,
        user_message: message,
        bot_reply: botReply,
        timestamp: new Date()
    })
    .then(() => console.log('Conversa salva com sucesso no MongoDB.'))
    .catch(err => console.error('Erro ao salvar conversa no MongoDB:', err.message));
}

// Função para codificar a imagem em base64
function encodeImage(imagePath) {
    const image = fs.readFileSync(imagePath);
    return image.toString('base64');  // Converte para base64
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
                    content: `O que há nesta imagem?`,
                    images: [
                        { image_url: `data:image/jpeg;base64,${base64Image}` }
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

// Função para enviar a transcrição para o ChatGPT e obter uma resposta
async function generateChatGPTResponse(transcriptionText) {
    const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
            {
                role: 'user',
                content: `Você é Helovox, um assistente engraçado e inteligente criado por Raul Balestra e Higor Felipe. Responda de forma amigável e divertida ao seguinte texto: "${transcriptionText}".`
            }
        ],
        max_tokens: 500,
        temperature: 0.7
    });

    return response.choices[0].message.content.trim();
}

// Detecta e responde a mensagens
client.on('message', async (message) => {
    // Verifica se a mensagem contém uma imagem
    if (message.hasMedia && message.type === 'image') {
        const media = await message.downloadMedia();
        const tempImageDir = path.join(__dirname, 'temp_images');

        if (!fs.existsSync(tempImageDir)) {
            fs.mkdirSync(tempImageDir);
        }

        const imagePath = path.join(tempImageDir, `image.jpg`);
        fs.writeFileSync(imagePath, Buffer.from(media.data, 'base64'));
        lastImage = imagePath;
        await client.sendMessage(message.from, 'Imagem recebida. Digite "descrever" para obter a descrição.');
    }

    // Processa a imagem quando o usuário digita "descrever"
    else if (message.body.toLowerCase().includes('descrever') && lastImage) {
        try {
            const imageDescription = await processImage(lastImage);
            await client.sendMessage(message.from, imageDescription);
            saveConversation(message.from, message.author || message.from, "descrever", imageDescription);
            lastImage = null;
        } catch (error) {
            console.error('Erro ao descrever a imagem:', error);
            await client.sendMessage(message.from, 'Erro ao descrever a imagem.');
        }
    }

    // Verifica se a mensagem contém um áudio
    else if (message.hasMedia && message.type === 'ptt') {
        const media = await message.downloadMedia();
        const tempAudioDir = path.join(__dirname, 'temp_audio');

        if (!fs.existsSync(tempAudioDir)) {
            fs.mkdirSync(tempAudioDir);
        }

        const inputFilePath = path.join(tempAudioDir, `audio.ogg`);
        fs.writeFileSync(inputFilePath, Buffer.from(media.data, 'base64'));

        try {
            await client.sendPresenceAvailable();
            const transcription = await transcribeAudio(inputFilePath);
            const gptResponse = await generateChatGPTResponse(transcription);
            await client.sendMessage(message.from, gptResponse);
            saveConversation(message.from, message.author || message.from, transcription, gptResponse);
        } catch (error) {
            console.error('Erro ao transcrever o áudio:', error);
            await client.sendMessage(message.from, `Erro ao processar o áudio: ${error.message}`);
        } finally {
            await client.sendPresenceUnavailable();
        }
    }

    // Responde a menções da Helovox
    else if (message.body.toLowerCase().includes('helovox')) {
        try {
            const userMessage = message.body;
            const gptResponse = await generateChatGPTResponse(userMessage);
            await client.sendMessage(message.from, gptResponse);
            saveConversation(message.from, message.author || message.from, userMessage, gptResponse);
        } catch (error) {
            console.error('Erro ao processar a mensagem:', error);
            await client.sendMessage(message.from, 'Erro ao processar a mensagem.');
        }
    } else {
        saveConversation(message.from, message.author || message.from, message.body);
        console.log('Mensagem armazenada no banco de dados.');
    }
});

// Inicializa o cliente
client.initialize();
