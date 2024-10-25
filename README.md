# Helovox

Helovox is an AI-powered WhatsApp bot using **whatsapp-web.js** and **GPT-4o-mini**, incorporating the RAG (Retrieval-Augmented Generation) concept for smart message retrieval. The app offers personalized interactions, enabling image descriptions and audio processing.

## Features

- **Smart Message Retrieval**: Utilizes RAG for efficient and accurate responses.
- **Image Description**: Analyzes and describes images sent via WhatsApp.
- **Audio Processing**: Converts audio messages to text and provides AI-generated responses.

## Installation

### Prerequisites
- Node.js (v14 or above)
- npm (v6 or above)
- A WhatsApp account for integration
- MongoDB (optional but recommended for storing message history)

### Setup Instructions
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/helovox.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   - Create a `.env` file in the root directory.
   - Add the following:
     ```
     MONGODB_URI=your_mongodb_uri (optional, if using MongoDB)
     SESSION_FILE_PATH=./whatsapp-session.json
     GPT_API_KEY=your_gpt_api_key
     ```
4. Start the app:
   ```bash
   npm start
   ```

## Usage

Once the app is running, scan the QR code displayed in the console using WhatsApp Web. The bot will connect and start processing messages.

- **Message Retrieval**: The bot uses RAG to find relevant information for intelligent responses.
- **Image Descriptions**: Send an image and type "describe image" to receive a detailed AI-generated description.
- **Audio Processing**: Send an audio message, and the bot will convert it to text and respond accordingly.

## Security Warning

> **Disclaimer**: Helovox integrates with WhatsApp using **whatsapp-web.js**, which is an unofficial method. It is not recommended for commercial purposes without implementing proper security and privacy measures. Users assume full responsibility and must ensure compliance with data protection regulations. Proceed at your own risk.

## Documentation

For more information on how the connection works, refer to the [whatsapp-web.js documentation](https://wwebjs.dev/).

## License

Helovox is licensed under the MIT License. See `LICENSE` for more information.
