// server.js
import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import 'colors';

// Services
import { recordingService } from './services/recording-service.js';
import { StreamService } from './services/stream-service.js';
import { TranscriptionService } from './services/transcription-service.js';
import { TextToSpeechService } from './services/tts-service.js';
import { GptService } from './services/gpt-service.js';

config();

const fastify = Fastify();
fastify.register(formBody);
fastify.register(multipart);

const PORT = process.env.PORT || 5050;

/**
 * Route Twilio /incoming-call
 */
fastify.all('/incoming-call', async (request, reply) => {
  try {
    console.log(`[Twilio -> /incoming-call]`.cyan);
    const callSid = request.body?.CallSid || 'UnknownCallSid';
    console.log(`callSid: ${callSid}`.cyan);

    // On renvoie rapidement du TwiML
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Bonjour, c'est Pam Mark II.</Say>
  <Connect>
    <Stream url="wss://${request.headers.host}/media-stream" track="inbound" />
  </Connect>
</Response>`;


    reply.header('Content-Type', 'text/xml');
    reply.send(twimlResponse);
    console.log(`[TwiML envoyé]`.green);

    // Enregistrement en tâche de fond
    if (process.env.RECORDING_ENABLED === 'true') {
      console.log(`[Recording] Attempting to record callSid=${callSid}`.yellow);
      recordingService(null, callSid).catch((err) => {
        console.error('[RecordingService Error]', err);
      });
    }

  } catch (err) {
    console.error('[Error in /incoming-call]', err);
    reply.header('Content-Type', 'text/xml');
    reply.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Erreur interne</Say></Response>`);
  }
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('[WS] Twilio Media Streams connected'.green);

  const streamService = new StreamService(ws);
  const sttService = new TranscriptionService();
  const ttsService = new TextToSpeechService();
  const gptService = new GptService();

  // GPT => TTS
  gptService.on('gptreply', (gptReply, interactionCount) => {
    console.log(`[GPT -> TTS] partialIndex=${gptReply.partialResponseIndex}, text="${gptReply.partialResponse}"`.blue);
    ttsService.generate(gptReply, interactionCount);
  });

  // TTS => audio => StreamService
  ttsService.on('speech', (partialIndex, audioBase64, text, interactionCount) => {
    console.log(`[TTS -> Stream] partialIndex=${partialIndex}, text="${text}"`.magenta);
    streamService.buffer(partialIndex, audioBase64);
  });

  // STT => GPT
  sttService.on('transcription', (finalText) => {
    console.log(`[STT -> GPT] finalText="${finalText}"`.yellow);
    gptService.completion(finalText, 0);
  });

  // Events WS
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    switch (data.event) {
      case 'start':
        console.log(`[WS:START] streamSid=${data.start.streamSid}`.blue);
        streamService.setStreamSid(data.start.streamSid);
        break;

      case 'media':
        // audio base64
        sttService.send(data.media.payload);
        break;

      case 'stop':
        console.log('[WS:STOP] The media stream ended'.blue);
        break;

      default:
        console.log(`Unhandled WS event: ${data.event}`.grey);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Connection closed'.red);
  });
});

// Gère l'upgrade HTTP => WS
fastify.server.on('upgrade', (req, socket, head) => {
  if (req.url === '/media-stream') {
    console.log('[HTTP => WS upgrade on /media-stream]'.green);
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  }
});

// Lancement
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error('[Fatal] fastify.listen error:', err);
    process.exit(1);
  }
  console.log(`pam_markII server listening on ${address}`.cyan);
});
