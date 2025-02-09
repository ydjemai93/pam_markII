// services/stream-service.js
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import 'colors';

export class StreamService extends EventEmitter {
  constructor(websocket) {
    super();
    this.ws = websocket;
    this.expectedAudioIndex = 0;
    this.audioBuffer = {};
    this.streamSid = '';
  }

  setStreamSid(streamSid) {
    this.streamSid = streamSid;
  }

  buffer(index, audio) {
    if (index === null) {
      this.sendAudio(audio);
    } else if (index === this.expectedAudioIndex) {
      this.sendAudio(audio);
      this.expectedAudioIndex++;
      while (this.audioBuffer[this.expectedAudioIndex]) {
        const nextAudio = this.audioBuffer[this.expectedAudioIndex];
        this.sendAudio(nextAudio);
        delete this.audioBuffer[this.expectedAudioIndex];
        this.expectedAudioIndex++;
      }
    } else {
      this.audioBuffer[index] = audio;
    }
  }

  sendAudio(audio) {
    this.ws.send(JSON.stringify({
      streamSid: this.streamSid,
      event: 'media',
      media: { payload: audio },
    }));

    const markLabel = uuidv4();
    this.ws.send(JSON.stringify({
      streamSid: this.streamSid,
      event: 'mark',
      mark: { name: markLabel }
    }));
    this.emit('audiosent', markLabel);
  }
}
