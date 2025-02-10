// server.js
import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import 'colors';

// Import de vos services
import { recordingService } from './services/recording-service.js';
import { StreamService } from './services/stream-service.js';
import { TranscriptionService } from './services/transcription-service.js';
import { TextToSpeechService } from './services/tts-service.js';
import { GptService } from './services/gpt-service.js';

// Charge les variables d'env (ex. OPENAI_API_KEY, TWILIO_ACCOUNT_SID, etc.)
config();

// Crée l'instance Fastify
const fastify = Fastify();

// Enregistre les plugins pour parser body
// - formBody pour x-www-form-urlencoded
// - multipart pour multipart/form-data
fastify.register(formBody);
fastify.register(multipart);

const PORT = process.env.PORT || 5050;

/**
 * Route Twilio: "A call comes in"
 * Twilio enverra une requête POST (x-www-form-urlencoded ou multipart/form-data selon config).
 * On renvoie un TwiML <Connect><Stream> pointant vers wss://.../media-stream
 */
fastify.all('/incoming-call', async (request, reply) => {
  // Twilio fields ex. request.body.CallSid
  const callSid = request.body?.CallSid || 'UnknownCallSid';

  // Optionnel : si RECORDING_ENABLED = 'true', on lance l'enregistrement Twilio
  if (process.env.RECORDING_ENABLED === 'true') {
    await recordingService(null, callSid);
  }

  // Retour TwiML
  const twimlResponse = `
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Bonjour, je suis Pam Mark II, votre IA. Merci de patienter.</Say>
      <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
      </Connect>
    </Response>
  `;

  reply.header('Content-Type', 'text/xml');
  reply.send(twimlResponse);
});

// Création d'un WebSocketServer pour gérer le flux Twilio (Media Streams) sur /media-stream
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('Twilio WebSocket (Media Streams) connecté à pam_markII'.green);

  // Instanciation des services
  const streamService = new StreamService(ws);
  const sttService = new TranscriptionService();
  const ttsService = new TextToSpeechService();
  const gptService = new GptService();

  // GPT => TTS
  gptService.on('gptreply', (gptReply, interactionCount) => {
    ttsService.generate(gptReply, interactionCount);
  });

  // TTS => audio => streamService => Twilio
  ttsService.on('speech', (partialIndex, audioBase64, text, interactionCount) => {
    streamService.buffer(partialIndex, audioBase64);
  });

  // STT => transcript => GPT
  sttService.on('transcription', (text) => {
    console.log(`STT text => ${text}`.yellow);
    gptService.completion(text, 0);
  });

  // Écoute les événements depuis Twilio
  ws.on('message', (message) => {
    const data = JSON.parse(message);

    switch (data.event) {
      case 'start':
        console.log(`Media stream start: ${data.start.streamSid}`);
        streamService.setStreamSid(data.start.streamSid);
        break;

      case 'media':
        // data.media.payload = audio brut base64
        sttService.send(data.media.payload);
        break;

      case 'stop':
        console.log('Media stream stop');
        break;

      default:
        console.log(`Événement non géré: ${data.event}`.grey);
    }
  });

  ws.on('close', () => {
    console.log('Fermeture WebSocket pam_markII'.red);
  });
});

// Intercepte l'upgrade HTTP => WS sur /media-stream
fastify.server.on('upgrade', (req, socket, head) => {
  if (req.url === '/media-stream') {
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  }
});

// Lancement du serveur en écoutant sur 0.0.0.0
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`pam_markII server listening on ${address}`.cyan);
});
