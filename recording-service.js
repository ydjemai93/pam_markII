// services/recording-service.js
import twilio from 'twilio';
import 'colors';

export async function recordingService(ttsService, callSid) {
  try {
    if (process.env.RECORDING_ENABLED === 'true') {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

      // ttsService.generate(...) si besoin d'avertir l'appelant qu'on enregistre
      const recording = await client.calls(callSid)
        .recordings
        .create({
          recordingChannels: 'dual'
        });
          
      console.log(`Recording Created: ${recording.sid}`.red);
    }
  } catch (err) {
    console.error('Error creating recording:'.red, err);
  }
}
