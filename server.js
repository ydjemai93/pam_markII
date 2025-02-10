// server.js
import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import 'colors';

// Import de vos fichiers de services
import { recordingService } from './services/recording-service.js';
import { StreamService } from './services/stream-service.js';
import { TranscriptionService } from './services/transcription-service.js';
import { TextToSpeechService } from './services/tts-service.js';
import { GptService } from './services/gpt-service.js';

// Charge .env (TWILIO_ACCOUNT_SID, OPENAI_API_KEY, etc.)
config();

const fastify = Fastify();
fastify.register(formBody);
fastify.register(multipart);

const PORT = process.env.PORT || 5050;

/**
 * Route Twilio : /incoming-call
 *  - Renvoyer le TwiML contenant <Connect><Stream> sans track.
 *  - Lancer l’enregistrement (optionnel) en asynchrone pour éviter timeouts.
 */
fastify.all('/incoming-call', async (request, reply) => {
  try {
    console.log(`[Twilio -> /incoming-call]`.cyan);

    // Récupérer CallSid
    const callSid = request.body?.CallSid || 'UnknownCallSid';
    console.log(`callSid: ${callSid}`.cyan);

    // TwiML minimal (sans track)
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Bonjour, je suis Pam Mark II, votre IA. Merci de patienter...</Say>
  <Connect>
    <Stream url="wss://${request.headers.host}/media-stream" />
  </Connect>
</Response>`;

    // Envoi TwiML immédiatement
    reply.header('Content-Type', 'text/xml');
    reply.send(twimlResponse);
    console.log(`[TwiML envoyé à Twilio].`.green);

    // Enregistrement en arrière-plan (si RECORDING_ENABLED === 'true')
    if (process.env.RECORDING_ENABLED === 'true') {
      console.log(`[Recording] Attempting to record callSid=${callSid}`.yellow);
      recordingService(null, callSid).catch((err) => {
        console.error('[RecordingService Error]', err);
      });
    }

  } catch (err) {
    console.error('[Error in /incoming-call]'.red, err);
    // On renvoie quand même un TwiML pour éviter l'erreur Twilio
    reply.header('Content-Type', 'text/xml');
    reply.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Erreur interne</Say></Response>`);
  }
});

// Création d'un WebSocketServer pour /media-stream
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('[WS] Twilio Media Streams connected (no track).'.green);

  // On instancie nos services
  const streamService = new StreamService(ws);
  const sttService = new TranscriptionService();
  const ttsService = new TextToSpeechService();
  const gptService = new GptService();

  // GPT => TTS
  gptService.on('gptreply', (gptReply, interactionCount) => {
    console.log(`[GPT -> TTS] text="${gptReply.partialResponse}" idx=${gptReply.partialResponseIndex}`.blue);
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

  // Écoute les messages WS venant de Twilio
  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    switch (data.event) {
      case 'start':
        console.log(`[WS:START] streamSid=${data.start.streamSid}`.green);
        streamService.setStreamSid(data.start.streamSid);
        break;

      case 'media':
        console.log(`[WS:MEDIA] Received audio data`.grey);
        // data.media.payload = audio brut en base64
        sttService.send(data.media.payload);
        break;

      case 'stop':
        console.log('[WS:STOP] The media stream ended'.gray);
        break;

      default:
        console.log(`Unhandled WS event: ${data.event}`.grey);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Connection closed'.red);
  });
});

// Intercepte l'upgrade HTTP => WS sur /media-stream
fastify.server.on('upgrade', (req, socket, head) => {
  if (req.url === '/media-stream') {
    console.log('[HTTP => WS upgrade /media-stream]'.cyan);
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  }
});

// Lancement du serveur sur 0.0.0.0
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error('[Fatal] fastify.listen error:'.red, err);
    process.exit(1);
  }
  console.log(`pam_markII server listening on ${address}`.cyan);
});
