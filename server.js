// server.js
import Fastify from 'fastify';
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import 'colors';

// Import des services (fichiers ES modules) depuis le dossier "services"
import { RecordingService } from './services/recording-service.js';
import { StreamService } from './services/stream-service.js';
import { TranscriptionService } from './services/transcription-service.js';
import { TextToSpeechService } from './services/tts-service.js';
import { GptService } from './services/gpt-service.js';

config(); // Charge les variables d'environnement depuis .env

const fastify = Fastify();
const PORT = process.env.PORT || 5050;

/**
 * Route Twilio : "A call comes in"
 * Retourne un TwiML <Connect><Stream> qui pointe vers wss://<host>/media-stream
 */
fastify.all('/incoming-call', async (request, reply) => {
  const callSid = request.body.CallSid || 'UnknownCallSid';

  // Optionnel : démarrer l'enregistrement Twilio si RECORDING_ENABLED === 'true'
  if (process.env.RECORDING_ENABLED === 'true') {
    await recordingService(null, callSid);
  }

  // On renvoie un TwiML contenant <Connect><Stream>
  const twimlResponse = `
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Bonjour, je suis Pam Mark II, votre IA. Patientez svp.</Say>
      <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
      </Connect>
    </Response>
  `;

  reply.header('Content-Type', 'text/xml');
  reply.send(twimlResponse);
});

// Création d'un WebSocketServer pour gérer le flux Twilio Media Streams sur "/media-stream"
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('Twilio WebSocket (Media Streams) connecté à pam_markII'.green);

  // Instanciation des différents services
  const streamService = new StreamService(ws);
  const sttService = new TranscriptionService();
  const ttsService = new TextToSpeechService();
  const gptService = new GptService();

  // GPT => TTS (quand GPT émet une portion de texte)
  gptService.on('gptreply', (gptReply, interactionCount) => {
    ttsService.generate(gptReply, interactionCount);
  });

  // TTS => audio => StreamService (pour renvoyer à Twilio)
  ttsService.on('speech', (partialIndex, audioBase64, text, interactionCount) => {
    // On place l'audio dans le buffer du stream service
    streamService.buffer(partialIndex, audioBase64);
  });

  // STT => transcription => GPT
  sttService.on('transcription', (text) => {
    console.log(`STT final text => ${text}`.yellow);
    // Envoi vers le GPT
    gptService.completion(text, 0);
  });

  // Réception des messages depuis Twilio
  ws.on('message', (message) => {
    const data = JSON.parse(message);

    switch (data.event) {
      case 'start':
        console.log(`Media WS START: ${data.start.streamSid}`);
        streamService.setStreamSid(data.start.streamSid);
        break;

      case 'media':
        // data.media.payload = audio brut en base64
        sttService.send(data.media.payload);
        break;

      case 'stop':
        console.log('Media WS STOP');
        break;

      default:
        console.log(`Événement non géré : ${data.event}`.grey);
    }
  });

  ws.on('close', () => {
    console.log('Fermeture WebSocket pam_markII'.red);
  });
});

// Intercepte l'upgrade HTTP => WS pour la route "/media-stream"
fastify.server.on('upgrade', (req, socket, head) => {
  if (req.url === '/media-stream') {
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  }
});

// Lance le serveur Fastify
fastify.listen({ port: PORT }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`pam_markII server listening on ${address}`.cyan);
});
