// services/recording-service.js
import 'colors';
import twilio from 'twilio';

/**
 * recordingService:
 * - Vérifie si RECORDING_ENABLED est "true".
 * - Optionnellement, appelle ttsService pour annoncer la mise enregistrement.
 * - Lance l'enregistrement "dual" via Twilio si callSid est valide.
 */
export async function recordingService(ttsService, callSid) {
  try {
    if (process.env.RECORDING_ENABLED === 'true') {
      // Initialisation du client Twilio avec variables d'env
      const client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      // Optionnel: faire annoncer à l'IA "This call will be recorded."
      if (ttsService) {
        ttsService.generate(
          {
            partialResponseIndex: null,
            partialResponse: 'This call will be recorded.'
          },
          0
        );
      }

      // Création de l'enregistrement sur l'appel via Twilio
      const recording = await client.calls(callSid).recordings.create({
        recordingChannels: 'dual'
      });

      console.log(`Recording Created: ${recording.sid}`.red);
    }
  } catch (err) {
    console.error('Error in recordingService:'.red, err);
  }
}
