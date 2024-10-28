const { exec } = require('child_process');
const { OpenAI } = require('openai');
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Carregar variáveis de ambiente
dotenv.config();

// Inicializa a API OpenAI com GPT-4 Vision
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
let lastAudio = null; // Armazena o último áudio recebido

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
function saveConversation(groupId, userName, message) {
    const collection = db.collection('conversations');
    collection.insertOne({
        group_id: groupId,
        user_name: userName,
        user_message: message,
        timestamp: new Date()
    })
    .then(() => console.log('Conversa salva com sucesso no MongoDB.'))
    .catch(err => console.error('Erro ao salvar conversa no MongoDB:', err.message));
}

// Função para descrever uma imagem usando GPT-4 Vision
async function describeImage(imagePath) {
    try {
        // Lê a imagem da pasta local
        const image = fs.readFileSync(imagePath);

        // Faz a chamada para o GPT-4 Vision com a imagem
        const response = await openai.images.generate({
            model: 'gpt-4-vision',  // Use GPT-4 Vision model aqui
            file: image  // Passa o arquivo de imagem
        });

        return response.data.choices[0].text.trim();  // Retorna a descrição gerada
    } catch (error) {
        console.error('Erro ao descrever a imagem:', error);
        throw new Error('Erro ao descrever a imagem.');
    }
}

// Função para converter o áudio para mp3 com ffmpeg
function convertAudioToMp3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        exec(`ffmpeg -i ${inputPath} -acodec libmp3lame ${outputPath}`, (error, stdout, stderr) => {
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
async function transcribeAudio(inputFilePath, mimeType) {
    const tempAudioDir = path.join(__dirname, 'temp_audio');
    const outputFilePath = path.join(tempAudioDir, 'audio.mp3');

    // Converte o áudio para MP3 antes de enviar à API Whisper
    await convertAudioToMp3(inputFilePath, outputFilePath);

    // Envia o arquivo MP3 para a API Whisper
    const response = await openai.audio.transcriptions.create({
        file: fs.createReadStream(outputFilePath),  // Enviar o arquivo de áudio como stream
        model: 'whisper-1'
    });

    // Limpa os arquivos temporários
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
        const imagePath = path.join(tempImageDir, `image.jpg`);

        // Salva a imagem localmente
        fs.writeFileSync(imagePath, Buffer.from(media.data, 'base64'));
        lastImage = imagePath; // Armazena o caminho da imagem
        await client.sendMessage(message.from, 'Imagem recebida! Deseja que eu descreva? Se sim, escreva "descrever".');
    }

    // Processa a imagem quando o usuário digita "descrever"
    else if (message.body.toLowerCase() === 'descrever' && lastImage) {
        try {
            // Mostra "presença ativa" enquanto a imagem está sendo descrita
            await client.sendPresenceAvailable();

            const imageDescription = await describeImage(lastImage); // Descreve a imagem usando GPT-4 Vision

            await client.sendMessage(message.from, imageDescription);
            lastImage = null; // Limpa a imagem após descrição
        } catch (error) {
            console.error('Erro ao descrever a imagem:', error);
            await client.sendMessage(message.from, 'Erro ao descrever a imagem.');
        } finally {
            await client.sendPresenceUnavailable();
        }
    }

    // Verifica se a mensagem contém um áudio
    else if (message.hasMedia && message.type === 'ptt') { // `ptt` é para mensagens de voz
        const media = await message.downloadMedia(); // Baixa o áudio
        const tempAudioDir = path.join(__dirname, 'temp_audio');
        const inputFilePath = path.join(tempAudioDir, `audio.ogg`);

        // Salva o áudio baixado
        fs.writeFileSync(inputFilePath, Buffer.from(media.data, 'base64'));

        try {
            // Mostra "presença ativa" enquanto o áudio está sendo processado
            await client.sendPresenceAvailable();

            // Transcreve o áudio automaticamente
            const transcription = await transcribeAudio(inputFilePath);

            // Envia a transcrição para o ChatGPT e gera uma resposta
            const gptResponse = await generateChatGPTResponse(transcription);

            // Envia a resposta do ChatGPT para o usuário como Helovox
            await client.sendMessage(message.from, gptResponse);

        } catch (error) {
            console.error('Erro ao transcrever o áudio:', error);
            await client.sendMessage(message.from, `Erro ao processar o áudio: ${error.message}`);
        } finally {
            await client.sendPresenceUnavailable();
        }
    }

    // Responde a mensagens com menção à Helovox
    else if (message.body.toLowerCase().includes('helovox')) {
        const groupId = message.from;
        const userQuery = message.body;

        try {
            // Mostra "presença ativa" enquanto o ChatGPT está processando
            await client.sendPresenceAvailable();

            // Salva a conversa no MongoDB
            saveConversation(groupId, message.author || message.from, userQuery);

            // Envia a mensagem ao ChatGPT para gerar a resposta
            const gptResponse = await generateChatGPTResponse(userQuery);

            // Envia a resposta para o usuário
            await client.sendMessage(message.from, gptResponse);
        } catch (error) {
            console.error('Erro ao processar a mensagem:', error);
        } finally {
            await client.sendPresenceUnavailable();
        }
    } else {
        // Salva qualquer outra mensagem no banco de dados
        saveConversation(message.from, message.author || message.from, message.body);
        console.log('Mensagem armazenada no banco de dados.');
    }
});

// Inicializa o cliente
client.initialize();

