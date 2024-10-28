const { exec } = require('child_process');
const { OpenAI } = require('openai');
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Carregar variáveis de ambiente
dotenv.config();

// Inicializa a API OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Configurações da API do ElevenLabs
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;

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

// Função para gerar áudio usando a API ElevenLabs em português do Brasil
async function generateAudioFromText(text) {
    try {
        const simplifiedText = text.replace(/[^\w\s.,?!]/g, '').substring(0, 300);
        console.log(`Gerando áudio com o texto: "${simplifiedText}"`);

        // Enviar a requisição para a API do ElevenLabs
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}`,
            {
                text: simplifiedText,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.8
                },
                // Garantindo que o idioma está configurado como português do Brasil
                language: "pt-BR", // Esta propriedade pode ou não ser suportada
                style: "default" // Ajustar caso você tenha estilos específicos
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'xi-api-key': elevenLabsApiKey
                },
                responseType: 'arraybuffer'
            }
        );

        const audioBuffer = Buffer.from(response.data, 'binary');
        const audioPath = path.join(__dirname, 'temp_audio', 'response.mp3');
        fs.writeFileSync(audioPath, audioBuffer);

        console.log(`Áudio gerado e salvo em: ${audioPath}`);
        return audioPath;
    } catch (error) {
        const errorMessage = error.response?.data?.detail?.message || error.message;
        console.error('Erro ao gerar áudio com ElevenLabs:', errorMessage);

        if (error.response) {
            console.log('Status Code:', error.response.status);
            console.log('Response Headers:', error.response.headers);
            console.log('Response Data:', error.response.data);
        }

        throw new Error('Erro ao gerar áudio.');
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
                content: `Você é Helovox, um assistente engraçado e inteligente criado por Raul Balestra e Higor Felipe. Responda de forma amigável e divertida ao seguinte texto em português: "${transcriptionText}".`
            }
        ],
        max_tokens: 500,
        temperature: 0.7
    });

    return response.choices[0].message.content.trim();
}

// Detecta e responde a mensagens
client.on('message', async (message) => {
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
            const audioPath = await generateAudioFromText(gptResponse);

            console.log('Enviando áudio gerado de volta ao usuário...');
            const audioMessage = MessageMedia.fromFilePath(audioPath);
            await client.sendMessage(message.from, audioMessage);

            saveConversation(message.from, message.author || message.from, transcription, gptResponse);
        } catch (error) {
            console.error('Erro ao transcrever o áudio:', error);
            await client.sendMessage(message.from, `Erro ao processar o áudio: ${error.message}`);
        } finally {
            await client.sendPresenceUnavailable();
        }
    }

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
