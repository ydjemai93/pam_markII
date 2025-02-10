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

// Charge .env
config();

// Création du serveur Fastify
const fastify = Fastify();

// Enregistrement des plugins pour parser les body
fastify.register(formBody);     // gère x-www-form-urlencoded
fastify.register(multipart);    // gère multipart/form-data

const PORT = process.env.PORT || 5050;

/**
 * Route Twilio : "A call comes in"
 *  1) On renvoie aussitôt un TwiML <Connect><Stream>
 *  2) En arrière-plan, on lance l'enregistrement si RECORDING_ENABLED = 'true'
 */
fastify.all('/incoming-call', async (request, reply) => {
  const callSid = request.body?.CallSid || 'UnknownCallSid';

  // 1) Renvoyer le TwiML immédiatement
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Bonjour, je suis Pam Mark II, l'IA. Patientez</Say>
      <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
      </Connect>
    </Response>`;
  
  reply.header('Content-Type', 'text/xml');
  reply.send(twimlResponse);

  // 2) Lancer l'enregistrement en tâche de fond (après avoir déjà répondu)
  if (process.env.RECORDING_ENABLED === 'true') {
    // Ne bloque pas la réponse TwiML
    recordingService(null, callSid)
      .catch((err) => {
        console.error('Error while creating recording:', err);
      });
  }
});

// Création d'un WebSocketServer pour /media-stream
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('Twilio WebSocket (Media Streams) connecté à pam_markII'.green);

  // Instanciation des services
  const streamService = new StreamService(ws);
  const sttService = new TranscriptionService();
  const ttsService = new TextToSpeechService();
  const gptService = new GptService();

  // GPT -> TTS
  gptService.on('gptreply', (gptReply, interactionCount) => {
    ttsService.generate(gptReply, interactionCount);
  });

  // TTS -> audio -> StreamService
  ttsService.on('speech', (partialIndex, audioBase64, text, interactionCount) => {
    streamService.buffer(partialIndex, audioBase64);
  });

  // STT -> transcription -> GPT
  sttService.on('transcription', (text) => {
    console.log(`STT final text => ${text}`.yellow);
    gptService.completion(text, 0);
  });

  // Écoute les messages depuis Twilio
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

// Intercepte l'upgrade HTTP => WS sur "/media-stream"
fastify.server.on('upgrade', (req, socket, head) => {
  if (req.url === '/media-stream') {
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  }
});

// Lancement sur 0.0.0.0
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`pam_markII server listening on ${address}`.cyan);
});
