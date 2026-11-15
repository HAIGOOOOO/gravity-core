import { shareToReplay } from './verify';

self.onmessage = (event: MessageEvent<string>) => {
  self.postMessage(shareToReplay(event.data));
};
