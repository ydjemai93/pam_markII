// server.js
import Fastify from 'fastify';
import formBody from '@fastify/formbody';  // <-- le plugin formbody
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import 'colors';

import { recordingService } from './services/recording-service.js';
import { StreamService } from './services/stream-service.js';
import { TranscriptionService } from './services/transcription-service.js';
import { TextToSpeechService } from './services/tts-service.js';
import { GptService } from './services/gpt-service.js';

config(); // charge .env

const fastify = Fastify();

// Enregistrement du plugin pour parser application/x-www-form-urlencoded
fastify.register(formBody);

const PORT = process.env.PORT || 5050;

/**
 * Route Twilio : "A call comes in"
 */
fastify.all('/incoming-call', async (request, reply) => {
  // Twilio envoie par défaut un payload urlencoded -> request.body.CallSid
  const callSid = request.body?.CallSid || 'UnknownCallSid';

  if (process.env.RECORDING_ENABLED === 'true') {
    await recordingService(null, callSid);
  }

  // On renvoie un TwiML minimal
  const twimlResponse = `
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Bonjour, je suis Pam Mark II!</Say>
      <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
      </Connect>
    </Response>
  `;

  reply.header('Content-Type', 'text/xml');
  reply.send(twimlResponse);
});

// Création d'un WebSocketServer pour "/media-stream"
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('Twilio WS (Media Streams) connecté'.green);

  // Instanciation de nos services
  const streamService = new StreamService(ws);
  const sttService = new TranscriptionService();
  const ttsService = new TextToSpeechService();
  const gptService = new GptService();

  // GPT => TTS
  gptService.on('gptreply', (gptReply, interactionCount) => {
    ttsService.generate(gptReply, interactionCount);
  });

  // TTS => StreamService
  ttsService.on('speech', (partialIndex, audioBase64, text, interactionCount) => {
    streamService.buffer(partialIndex, audioBase64);
  });

  // STT => GPT
  sttService.on('transcription', (text) => {
    console.log(`STT text => ${text}`.yellow);
    gptService.completion(text, 0);
  });

  // Ecoute les paquets Twilio
  ws.on('message', (message) => {
    const data = JSON.parse(message);

    switch (data.event) {
      case 'start':
        console.log(`Media stream start: ${data.start.streamSid}`);
        streamService.setStreamSid(data.start.streamSid);
        break;
      case 'media':
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
    console.log('Fermeture WS pam_markII'.red);
  });
});

// Redirige le upgrade HTTP => WS sur "/media-stream"
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
