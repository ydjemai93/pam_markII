// server.js
import Fastify from 'fastify';
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import 'colors';

import { recordingService } from './services/recording-service.js';
import { StreamService } from './services/stream-service.js';
import { TranscriptionService } from './services/transcription-service.js';
import { TextToSpeechService } from './services/tts-service.js';
import { GptService } from './services/gpt-service.js';

config(); // Charge .env

const fastify = Fastify();
const PORT = process.env.PORT || 5050;

// Route Twilio "incoming-call" => renvoie TwiML <Connect><Stream>
fastify.all('/incoming-call', async (request, reply) => {
  const callSid = request.body.CallSid || 'UnknownCallSid';
  
  // Optionnel: si on souhaite lancer un enregistrement d'appel Twilio
  if (process.env.RECORDING_ENABLED === 'true') {
    await recordingService(null, callSid); 
  }

  const twimlResponse = `
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Bonjour, je suis Pam Mark II, votre IA. Veuillez patienter.</Say>
      <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
      </Connect>
    </Response>
  `;

  reply.header('Content-Type', 'text/xml');
  reply.send(twimlResponse);
});

// On va gérer le WebSocket sur le même server, route "/media-stream"
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('Twilio connected to pam_markII (Media Streams)'.green);

  // Instantiate our services
  const streamService = new StreamService(ws);
  const sttService = new TranscriptionService();
  const ttsService = new TextToSpeechService();
  const gptService = new GptService();

  // GPT => TTS
  gptService.on('gptreply', (gptReply, interactionCount) => {
    ttsService.generate(gptReply, interactionCount);
  });

  // TTS => audio => StreamService
  ttsService.on('speech', (partialIndex, audioBase64, text, interactionCount) => {
    streamService.buffer(partialIndex, audioBase64);
  });

  // STT => transcription => GPT
  sttService.on('transcription', (text) => {
    console.log(`STT final text => ${text}`.yellow);
    gptService.completion(text, 0); 
  });

  // Ecoute les messages Twilio
  ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    switch(data.event) {
      case 'start':
        console.log(`Media WS START: ${data.start.streamSid}`);
        streamService.setStreamSid(data.start.streamSid);
        break;
      case 'media':
        // envoi du payload audio au STT
        sttService.send(data.media.payload);
        break;
      case 'stop':
        console.log('Media WS STOP');
        break;
      default:
        console.log(`Unhandled event: ${data.event}`.grey);
    }
  });

  ws.on('close', () => {
    console.log('pam_markII Media Stream closed'.red);
  });
});

// Ecoute l'upgrade "HTTP => WS" pour "/media-stream"
fastify.server.on('upgrade', (req, socket, head) => {
  if (req.url === '/media-stream') {
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  }
});

// Lancement
fastify.listen({ port: PORT }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`pam_markII server listening on ${address}`.cyan);
});
