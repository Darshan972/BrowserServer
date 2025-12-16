// test-wss-simple.js - Direct WSS connection test
import WebSocket from 'ws';

const WSS_URL = 'wss://browser.scrapingdog.com:8001/devtools/browser/0b5f8537-e546-4a5f-9817-0d39f2404939';

console.log('🔗 Testing WSS:', WSS_URL);

const ws = new WebSocket(WSS_URL, {
  timeout: 10000,
  perMessageDeflate: false
});

ws.on('open', () => {
  console.log('✅ WSS CONNECTED!');
  console.log('📡 Sending CDP commands...');

  // Enable CDP domains
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.enable'
  }));

  ws.send(JSON.stringify({
    id: 2,
    method: 'Page.enable'
  }));

  ws.send(JSON.stringify({
    id: 3,
    method: 'Runtime.evaluate',
    params: {
      expression: 'document.title'
    }
  }));
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log('📨 CDP Response:', JSON.stringify(msg, null, 2));
    
    if (msg.id === 3) {
      console.log('🎉 PAGE TITLE:', msg.result.result.value);
      ws.close();
    }
  } catch (e) {
    console.log('📨 Raw:', data.toString().slice(0, 200));
  }
});

ws.on('error', (error) => {
  console.error('💥 WSS ERROR:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`🔌 WSS CLOSED: code=${code}, reason=${reason}`);
});
