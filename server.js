// server.js
import Fastify from 'fastify';
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import 'colors';

// Import de tous les services depuis le dossier ./services
import { recordingService } from './services/recording-service.js';
import { StreamService } from './services/stream-service.js';
import { TranscriptionService } from './services/transcription-service.js';
import { TextToSpeechService } from './services/tts-service.js';
import { GptService } from './services/gpt-service.js';

config(); // Charge .env

const fastify = Fastify();
const PORT = process.env.PORT || 5050;

/**
 * Route Twilio: "A call comes in"
 * Retourne un TwiML <Connect><Stream> vers wss://<host>/media-stream
 */
fastify.all('/incoming-call', async (request, reply) => {
  const callSid = request.body.CallSid || 'UnknownCallSid';

  // Optionnel: démarrer un enregistrement Twilio si RECORDING_ENABLED === 'true'
  if (process.env.RECORDING_ENABLED === 'true') {
    await recordingService(null, callSid);
  }

  // TwiML de base renvoyant un <Connect><Stream>
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

// Création d'un serveur WebSocket pour gérer le flux Twilio Media Streams
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('Twilio a établi une connexion WS (pam_markII)'.green);

  // Instanciation des services
  const streamService = new StreamService(ws);
  const sttService = new TranscriptionService();
  const ttsService = new TextToSpeechService();
  const gptService = new GptService();

  // Lorsque GPT génère une réponse, on la transforme en audio (TTS)
  gptService.on('gptreply', (gptReply, interactionCount) => {
    ttsService.generate(gptReply, interactionCount);
  });

  // Lorsque TTS produit de l'audio, on l'envoie au flux Twilio
  ttsService.on('speech', (partialIndex, audioBase64, text, interactionCount) => {
    streamService.buffer(partialIndex, audioBase64);
  });

  // Lorsque STT produit une transcription finale, on l'envoie au GPT
  sttService.on('transcription', (text) => {
    console.log(`STT final text => ${text}`.yellow);
    gptService.completion(text, 0); 
  });

  // Écoute des messages WS depuis Twilio
  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    switch(data.event) {
      case 'start':
        console.log(`Media WS START: ${data.start.streamSid}`);
        streamService.setStreamSid(data.start.streamSid);
        break;
      case 'media':
        // data.media.payload = audio base64 (G.711)
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

// Upgrade HTTP => WS pour la route "/media-stream"
fastify.server.on('upgrade', (req, socket, head) => {
  if (req.url === '/media-stream') {
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  }
});

// Lancement du serveur
fastify.listen({ port: PORT }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`pam_markII server listening on ${address}`.cyan);
});
